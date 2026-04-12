import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ICONS_DIR = BASE_DIR / "icons"
DATA_DIR = BASE_DIR / "data"
SKILL_HINTS_PATH = DATA_DIR / "skill_hints.json"
VALID_KEYBINDS = {"C", "Q", "E", "X"}
IMAGE_EXTENSIONS = {".png", ".webp", ".jpg", ".jpeg"}

# Manual hint/type metadata for agents currently prepared for testing.
# keybind C/Q = Basic, E = Signature, X = Ultimate (default rule below).
DEFAULT_SKILL_HINT_OVERRIDES = {
    "Astra": {
        "C": {"name": "", "function": "Cripple, Displacement"},
        "Q": {"name": "", "function": "Concuss"},
        "E": {"name": "", "function": "Smoke"},
        "X": {"name": "", "function": "Wall"},
    },
    "Breach": {
        "C": {"name": "", "function": "Deterrent"},
        "Q": {"name": "", "function": "Flash"},
        "E": {"name": "", "function": "Concuss"},
        "X": {"name": "", "function": "Concuss, Displacement"},
    },
    "Brimstone": {
        "C": {"name": "", "function": "Buff"},
        "Q": {"name": "", "function": "Molotov"},
        "E": {"name": "", "function": "Smoke"},
        "X": {"name": "", "function": "Deterrent"},
    },
    "Chamber": {
        "C": {"name": "", "function": "Slow"},
        "Q": {"name": "", "function": "Weapon Equip"},
        "E": {"name": "", "function": "Teleport"},
        "X": {"name": "", "function": "Weapon Equip"},
    },
    "Clove": {
        "C": {"name": "", "function": "Heal"},
        "Q": {"name": "", "function": "Cripple"},
        "E": {"name": "", "function": "Smoke"},
        "X": {"name": "", "function": "Revive"},
    },
}


def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_skill_hint_entry(entry):
    if isinstance(entry, dict):
        return {
            "name": str(entry.get("name", "")).strip(),
            "function": str(entry.get("function", "")).strip(),
        }

    return {
        "name": "",
        "function": str(entry or "").strip(),
    }


def _normalize_skill_hint_overrides(overrides):
    normalized = {}
    for agent_name, agent_hints in (overrides or {}).items():
        if not isinstance(agent_hints, dict):
            continue

        normalized[agent_name] = {}
        for keybind in VALID_KEYBINDS:
            if keybind in agent_hints:
                normalized[agent_name][keybind] = _normalize_skill_hint_entry(agent_hints.get(keybind))

        for keybind, entry in agent_hints.items():
            if keybind not in normalized[agent_name]:
                normalized[agent_name][keybind] = _normalize_skill_hint_entry(entry)

    return normalized


def load_skill_hint_overrides():
    _ensure_data_dir()
    if SKILL_HINTS_PATH.exists():
        with SKILL_HINTS_PATH.open("r", encoding="utf-8") as file:
            overrides = _normalize_skill_hint_overrides(json.load(file))
            save_skill_hint_overrides(overrides)
            return overrides
    return _normalize_skill_hint_overrides(DEFAULT_SKILL_HINT_OVERRIDES)


def save_skill_hint_overrides(overrides):
    _ensure_data_dir()
    with SKILL_HINTS_PATH.open("w", encoding="utf-8") as file:
        json.dump(_normalize_skill_hint_overrides(overrides), file, indent=2, ensure_ascii=True)


def _skill_type_from_keybind(agent_name: str, keybind: str):
    if agent_name == "Reyna" and keybind in {"Q", "E"}:
        return "Signature"
    if keybind == "X":
        return "Ultimate"
    if keybind == "E":
        return "Signature"
    return "Basic"


def _parse_skill_filename(file_path: Path):
    stem = file_path.stem
    if "-" not in stem:
        return None

    skill_name_part, keybind_part = stem.rsplit("-", 1)
    keybind = keybind_part.strip().upper()
    if keybind not in VALID_KEYBINDS:
        return None

    skill_name = skill_name_part.replace("_", " ").strip()
    if not skill_name:
        return None

    return skill_name, keybind


def _build_skill_icon_db_from_folders(skill_hint_overrides):
    db = {}

    if not ICONS_DIR.exists():
        return db

    for agent_dir in ICONS_DIR.iterdir():
        if not agent_dir.is_dir():
            continue

        # Optional structure support:
        # - icons/<Agent>/Skill-<Keybind>.webp
        # - icons/<Agent>/skills/Skill-<Keybind>.webp
        skills_dir = agent_dir / "skills"
        source_dir = skills_dir if skills_dir.is_dir() else agent_dir

        entries = []
        for file_path in source_dir.iterdir():
            if not file_path.is_file() or file_path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue

            # Skip portrait files like Jett_icon.png and only keep skill files like Dash-E.webp
            if file_path.stem.lower().endswith("_icon"):
                continue

            parsed = _parse_skill_filename(file_path)
            if not parsed:
                continue

            skill_name, keybind = parsed
            hint_overrides = skill_hint_overrides.get(agent_dir.name, {})
            hint_data = hint_overrides.get(keybind, {})
            
            # Handle both old string format and new dict format for backward compatibility
            if isinstance(hint_data, dict):
                function_hint = hint_data.get("function", "")
                # Use the admin-entered skill name if available, otherwise use filename-parsed name
                admin_skill_name = hint_data.get("name", "").strip()
                final_skill_name = admin_skill_name or skill_name
            else:
                function_hint = str(hint_data)
                final_skill_name = skill_name
            
            entries.append(
                {
                    "skill_name": final_skill_name,
                    "keybind": keybind,
                    "function_hint": function_hint,
                    "skill_type": _skill_type_from_keybind(agent_dir.name, keybind),
                    "icon": file_path.relative_to(BASE_DIR).as_posix(),
                }
            )

        if entries:
            order = {"C": 0, "Q": 1, "E": 2, "X": 3}
            db[agent_dir.name] = sorted(entries, key=lambda item: order.get(item["keybind"], 99))

    return db


def get_skill_icon_db():
    hint_overrides = load_skill_hint_overrides()
    return _build_skill_icon_db_from_folders(hint_overrides)


# Auto-discovered from files in icons/<Agent>/Skill-<Keybind>.<ext>
SKILL_ICON_DB = get_skill_icon_db()
