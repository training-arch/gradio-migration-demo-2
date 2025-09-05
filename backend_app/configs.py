from __future__ import annotations
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List


@dataclass
class SavedConfig:
    name: str
    description: str
    updated_at: str
    targets_config: Dict[str, Any]


def _slugify(name: str) -> str:
    s = re.sub(r"\s+", "-", name.strip())
    s = re.sub(r"[^A-Za-z0-9_-]", "", s)
    return s.lower() or "config"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_store_dir(base_dir: Path) -> Path:
    d = base_dir / "configs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def list_configs(base_dir: Path) -> List[SavedConfig]:
    out: List[SavedConfig] = []
    for p in sorted(get_store_dir(base_dir).glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            out.append(
                SavedConfig(
                    name=str(data.get("name") or p.stem),
                    description=str(data.get("description") or ""),
                    updated_at=str(data.get("updated_at") or ""),
                    targets_config=dict(data.get("targets_config") or {}),
                )
            )
        except Exception:
            continue
    return out


def get_config(base_dir: Path, name: str) -> SavedConfig | None:
    path = get_store_dir(base_dir) / f"{_slugify(name)}.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return SavedConfig(
            name=str(data.get("name") or name),
            description=str(data.get("description") or ""),
            updated_at=str(data.get("updated_at") or ""),
            targets_config=dict(data.get("targets_config") or {}),
        )
    except Exception:
        return None


def save_config(base_dir: Path, name: str, description: str, targets_config: Dict[str, Any]) -> SavedConfig:
    data = {
        "name": name,
        "description": description or "",
        "updated_at": _now_iso(),
        "targets_config": dict(targets_config or {}),
    }
    path = get_store_dir(base_dir) / f"{_slugify(name)}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return SavedConfig(**data)  # type: ignore[arg-type]


def delete_config(base_dir: Path, name: str) -> bool:
    path = get_store_dir(base_dir) / f"{_slugify(name)}.json"
    if path.exists():
        path.unlink()
        return True
    return False

