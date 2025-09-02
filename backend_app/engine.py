"""
backend_app.engine
Core auditing engine extracted from the Gradio prototype, made framework-agnostic.
This module intentionally omits any UI code and external AI calls so it can run offline.

Usage example:
    from backend_app.engine import run_targets
    kept_df, out_path = run_targets("input.xlsx", {"Enquiry": {...}}, save_path="mistakes_only.xlsx")
"""
from __future__ import annotations
import re
from typing import Dict, Tuple, Any
import pandas as pd

# -----------------------------
# Helper utilities
# -----------------------------
def normalize_var_name(col_name: str) -> str:
    return re.sub(r"\W+", "_", str(col_name)).strip("_")

def template_variables_used(tpl: str) -> set[str]:
    return set(re.findall(r"{([A-Za-z0-9_]+)}", tpl or ""))

def render_prompt_allcols(tpl: str, row: pd.Series, field_name: str, field_value: Any) -> str:
    """Prepare a row-aware prompt string. (Kept for parity; not used in offline stub.)"""
    ctx: Dict[str, str] = {}
    for real in row.index:
        ctx[normalize_var_name(real)] = "" if pd.isna(row[real]) else str(row[real])
    ctx["Field_Name"] = field_name
    ctx["Field_Value"] = "" if field_value is None or (isinstance(field_value, float) and pd.isna(field_value)) else str(field_value)

    var_names = template_variables_used(tpl)

    def protect(m):  # protect named slots so we can escape other braces safely
        return f"__VAR_OPEN__{m.group(1)}__VAR_CLOSE__"

    tpl_protected = re.sub(r"\{([A-Za-z0-9_]+)\}", protect, tpl or "")
    tpl_escaped = tpl_protected.replace("{", "{{").replace("}", "}}")
    tpl_ready = tpl_escaped.replace("__VAR_OPEN__", "{").replace("__VAR_CLOSE__", "}")

    for v in var_names:
        ctx.setdefault(v, "")
    return tpl_ready.format(**ctx)

# -----------------------------
# Rule primitives
# -----------------------------
def word_count(s: str | None) -> int:
    return len(re.findall(r"\b\w+\b", str(s or "")))

def row_meets_value_filters(row: pd.Series, filters: Dict[str, list[str]], mode: str = "AND") -> bool:
    """
    filters: {df_column: [allowed values]}
    OR within a column; AND/OR across columns (mode).
    """
    if not filters:
        return True
    tests = []
    for col, allowed in (filters or {}).items():
        if not allowed:
            continue
        val_str = "" if (col not in row or pd.isna(row[col])) else str(row[col]).strip()
        tests.append(val_str in set(allowed))
    if not tests:
        return True
    mode = (mode or "AND").upper()
    return any(tests) if mode == "OR" else all(tests)

def value_meets_text_phrases(value, phrases: list[str] | None, mode: str = "ANY") -> bool:
    if not phrases:
        return True
    s = "" if value is None or (isinstance(value, float) and pd.isna(value)) else str(value)
    s_low = s.lower()
    checks = [(p or "").strip().lower() for p in (phrases or []) if (p or "").strip() != ""]
    if not checks:
        return True
    if (mode or "ANY").upper() == "ALL":
        return all(c in s_low for c in checks)
    return any(c in s_low for c in checks)

def row_meets_text_filters(row: pd.Series, text_filters: dict, across_mode: str = "AND") -> bool:
    """
    text_filters structure:
    {
      "SomeColumn": {"mode":"ANY"|"ALL","phrases":["foo","bar"],"include":true|false},
      ...
    }
    include=True  -> column passes if value_meets_text_phrases == True
    include=False -> column passes if value_meets_text_phrases == False  (exclude matches)
    Across columns combine with across_mode (AND/OR).
    """
    if not text_filters:
        return True
    tests = []
    for col, cfg in (text_filters or {}).items():
        if not cfg or "phrases" not in cfg:
            continue
        val = row[col] if col in row else None
        col_mode = str(cfg.get("mode", "ANY")).upper()
        include = bool(cfg.get("include", True))
        hit = value_meets_text_phrases(val, cfg.get("phrases") or [], mode=col_mode)
        tests.append(hit if include else (not hit))
    if not tests:
        return True
    across_mode = (across_mode or "AND").upper()
    return any(tests) if across_mode == "OR" else all(tests)

def keyword_flag_messages(value, cfg_kw: dict | None) -> str:
    """
    cfg_kw: {"enabled":bool, "mode":"ANY"/"ALL", "phrases":[...]}
    Applies ONLY on the target column's value.
    """
    if not cfg_kw or not cfg_kw.get("enabled"):
        return "[]"
    phrases = cfg_kw.get("phrases") or []
    mode = str(cfg_kw.get("mode", "ANY")).upper()
    if not phrases:
        return "[]"
    val = "" if value is None or (isinstance(value, float) and pd.isna(value)) else str(value)
    s_low = val.lower()
    norm = [p.strip().lower() for p in phrases if p and p.strip()]
    if not norm:
        return "[]"
    hit = (all(p in s_low for p in norm) if mode == "ALL" else any(p in s_low for p in norm))
    return f"Keyword flag: {', '.join(phrases)}" if hit else "[]"

# -----------------------------
# Config defaults
# -----------------------------
def ensure_target_defaults(cfg_t: dict | None) -> dict:
    cfg_t = dict(cfg_t or {})
    cfg_t.setdefault("ai", False)  # offline stub
    cfg_t.setdefault("prompt", "")
    cfg_t.setdefault("wc", False)
    cfg_t.setdefault("wc_min", 7)
    cfg_t.setdefault("kw_flag", {"enabled": False, "mode": "ANY", "phrases": []})
    cfg_t.setdefault("vf_on", False)
    cfg_t.setdefault("filters", {})
    cfg_t.setdefault("filter_mode", "AND")
    cfg_t.setdefault("tf_on", False)
    cfg_t.setdefault("text_filters", {})
    return cfg_t

# -----------------------------
# Core engine
# -----------------------------
def run_targets(filepath: str, targets_config: Dict[str, dict], save_path: str | None = None) -> tuple[pd.DataFrame, str | None]:
    """
    Execute all configured targets against an Excel file and return (kept_df, out_path_or_None).
    - Writes Excel only if save_path is provided.
    - 'kept_df' contains only rows that triggered at least one rule across all targets.
    """
    df = pd.read_excel(filepath)
    out = df.copy()

    # Validate selected columns
    for tcol in targets_config.keys():
        if tcol not in df.columns:
            raise ValueError(f"Selected target column not found in Excel: {tcol}")

    for target_col, cfg_raw in (targets_config or {}).items():
        cfg = ensure_target_defaults(cfg_raw)
        wc_enabled = bool(cfg.get("wc"))
        wc_min = int(cfg.get("wc_min", 7))
        kw_cfg = dict(cfg.get("kw_flag") or {})
        vf_on = bool(cfg.get("vf_on"))
        tf_on = bool(cfg.get("tf_on"))
        filters = dict(cfg.get("filters") or {})
        text_filters = dict(cfg.get("text_filters") or {})
        filter_mode = str(cfg.get("filter_mode","AND")).upper()

        if wc_enabled and not (1 <= wc_min <= 20):
            raise ValueError(f"'{target_col}' word-count minimum must be between 1 and 20.")

        results = []
        for _, row in df.iterrows():
            # Pre-filters: only apply if toggles ON
            if vf_on and not row_meets_value_filters(row, filters, mode=filter_mode):
                results.append("[]"); continue
            if tf_on and not row_meets_text_filters(row, text_filters, across_mode=filter_mode):
                results.append("[]"); continue

            val = row[target_col]
            messages = []

            # Word count on TARGET
            if wc_enabled:
                if val is None or not str(val).strip():
                    messages.append("NULL VALUE")
                else:
                    if word_count(val) < wc_min:
                        messages.append(f"Too short (<{wc_min} words)")

            # Keyword flag on TARGET
            kw_msg = keyword_flag_messages(val, kw_cfg)
            if kw_msg != "[]":
                messages.append(kw_msg)

            # AI rule (stubbed offline; parity placeholder)
            if bool(cfg.get("ai")) and str(cfg.get("prompt","")):
                # In production, call LLM and parse response.
                pass

            results.append(" ; ".join(messages) if messages else "[]")

        out[f"{target_col} Mistakes"] = results

    # Keep rows with at least one mistake across targets
    if targets_config:
        mistake_cols = [f"{c} Mistakes" for c in targets_config.keys()]
        mask = None
        for col in mistake_cols:
            col_mask = out[col] != "[]"
            mask = col_mask if mask is None else (mask | col_mask)
        kept = out[mask].copy()
    else:
        raise ValueError("Please configure at least one target column.")

    out_path = None
    if save_path:
        kept.to_excel(save_path, index=False)
        out_path = save_path

    return kept, out_path