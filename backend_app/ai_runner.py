from __future__ import annotations
import hashlib
import json
import os
import time
from pathlib import Path
import logging
from typing import List, Dict, Any, Tuple


CACHE_DIR = Path(__file__).resolve().parent.parent / "results" / ".ai_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

log = logging.getLogger("ai_runner")


def _env_bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


def _hash_key(model: str, prompt: str) -> str:
    h = hashlib.sha256()
    h.update((model + "|" + prompt).encode("utf-8", errors="ignore"))
    return h.hexdigest()


def _cache_get(model: str, prompt: str) -> str | None:
    key = _hash_key(model, prompt)
    fp = CACHE_DIR / f"{key}.json"
    if fp.exists():
        try:
            log.debug("ai_cache hit model=%s key=%s len=%d", model, key[:8], len(prompt))
            return fp.read_text(encoding="utf-8")
        except Exception:
            return None
    return None


def _cache_set(model: str, prompt: str, content: str) -> None:
    try:
        key = _hash_key(model, prompt)
        fp = CACHE_DIR / f"{key}.json"
        fp.write_text(content, encoding="utf-8")
        log.debug("ai_cache write model=%s key=%s resp_len=%d", model, key[:8], len(content))
    except Exception:
        pass


def parse_ai(content: str) -> Dict[str, Any]:
    """
    Normalize assorted JSON-ish responses into a common shape:
      { "trigger": bool, "message": str, "confidence"?: float }
    Supports either {"trigger":...} or {"result": "not detailed"|"incorrect"|...; "justification"|"reason"}
    """
    trigger = False
    message = ""
    confidence: float | None = None

    # First, try strict JSON
    try:
        data = json.loads(content)
        if isinstance(data, dict):
            if "trigger" in data:
                trigger = bool(data.get("trigger"))
                message = str(data.get("message") or "").strip()
                c = data.get("confidence")
                if isinstance(c, (int, float)):
                    confidence = float(c)
            elif "result" in data:
                res = str(data.get("result") or "").lower().strip()
                if res in ("not detailed", "incorrect"):
                    trigger = True
                    message = str(data.get("justification") or data.get("reason") or "").strip()
                elif res in ("detailed", "correct"):
                    trigger = False
                c = data.get("confidence")
                if isinstance(c, (int, float)):
                    confidence = float(c)
            return {"trigger": trigger, "message": message, **({"confidence": confidence} if confidence is not None else {})}
    except Exception:
        # Parsing failed; log small snippet at DEBUG for diagnostics (safe)
        try:
            snippet = (content or "")[:80].replace("\n", " ")
            log.debug("ai_parse json failed; snippet='%s'", snippet)
        except Exception:
            pass

    # Fallback: light regex-like extraction
    lower = content.lower()
    if '"result"' in lower:
        if "not detailed" in lower or "incorrect" in lower:
            trigger = True
        elif "detailed" in lower or "correct" in lower:
            trigger = False
    # crude message capture
    for k in ("justification", "reason", "message"):
        idx = lower.find(f'"{k}"')
        if idx != -1:
            # take a short window after the key
            snippet = content[idx: idx + 200]
            # naive quote extraction
            try:
                first = snippet.index('"', snippet.index(':') + 1)
                second = snippet.index('"', first + 1)
                message = snippet[first + 1: second].strip()
                break
            except Exception:
                pass

    # If no trigger and message empty, emit a short DEBUG snippet for observability
    try:
        if not trigger and not (message or "").strip():
            snippet = (content or "")[:80].replace("\n", " ")
            if snippet:
                log.debug("ai_parse non-trigger; snippet='%s'", snippet)
    except Exception:
        pass

    return {"trigger": trigger, "message": message}


def run_batch(prompts: List[str], *, model: str, max_tokens: int = 80, temperature: float = 0.0, use_cache: bool = True) -> List[Dict[str, Any]]:
    """
    Run a batch of prompts via OpenAI Chat Completions. Returns a list of dicts:
      { "content": str, "cached": bool, "error"?: str }
    If AI is disabled or key missing, returns neutral responses with error notes for logging.
    """
    ai_enabled = _env_bool("AI_ENABLED", False)
    api_key = os.getenv("OPENAI_API_KEY")
    if not ai_enabled or not api_key:
        # Return neutral results; engine will interpret as no trigger
        out: List[Dict[str, Any]] = []
        note = None if ai_enabled else "AI_ENABLED is false"
        if ai_enabled and not api_key:
            note = "OPENAI_API_KEY missing"
        log.warning("ai_runner disabled: %s", note or "unknown reason")
        for _ in prompts:
            out.append({"content": "{}", "cached": False, **({"error": note} if note else {})})
        return out

    # Lazy import to avoid hard dependency when disabled
    try:
        import openai  # type: ignore
        client = openai.OpenAI(api_key=api_key)  # type: ignore[attr-defined]
    except Exception as e:
        log.error("ai_runner init failed: %s", e)
        return [{"content": "{}", "cached": False, "error": f"OpenAI init failed: {e}"} for _ in prompts]

    results: List[Dict[str, Any]] = []
    log.info("ai_runner run: count=%d model=%s max_tokens=%s temp=%s cache=%s", len(prompts), model, max_tokens, temperature, use_cache)
    for prompt in prompts:
        # Cache
        if use_cache:
            cached = _cache_get(model, prompt)
            if cached is not None:
                results.append({"content": cached, "cached": True})
                continue
        # Call API
        try:
            t0 = time.time()
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max(1, int(max_tokens)),
                temperature=float(temperature or 0.0),
            )
            content = (resp.choices[0].message.content or "").strip()  # type: ignore[attr-defined]
            if use_cache:
                _cache_set(model, prompt, content)
            dt = time.time() - t0
            log.info("ai_runner call ok: latency=%.2fs resp_len=%d", dt, len(content))
            results.append({"content": content, "cached": False, "latency": dt})
        except Exception as e:
            log.error("ai_runner call failed: %s", e)
            results.append({"content": "{}", "cached": False, "error": str(e)})

    return results
