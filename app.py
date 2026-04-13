import json
import os
import random
import re
import shutil
import hashlib
from functools import wraps
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import Flask, abort, jsonify, redirect, render_template, request, send_from_directory, session, url_for
from werkzeug.utils import secure_filename

from agents_db import AGENTS as DEFAULT_AGENTS
from game_logic import build_feedback, serialize_public_agent
from skill_icons_db import get_skill_icon_db, load_skill_hint_overrides, save_skill_hint_overrides
from voice_lines_db import load_voice_lines, save_voice_lines, delete_voice_lines, get_voice_line

BASE_DIR = Path(__file__).resolve().parent
ALLOWED_ASSET_PREFIXES = ("icons/", "audio/", "skill_icons/")
ICON_DIR = BASE_DIR / "icons"
AUDIO_DIR = BASE_DIR / "audio"
DATA_DIR = BASE_DIR / "data"
AGENTS_PATH = DATA_DIR / "agents.json"
VALID_KEYBINDS = ("C", "Q", "E", "X")
GAME_VARIANTS = {"endless", "daily"}
ADMIN_PASSWORD = os.environ.get("VALODLE_ADMIN_PASSWORD", "valodleadmin")
DAILY_TIMEZONE_NAME = os.environ.get("VALODLE_DAILY_TIMEZONE", "UTC")


def build_icon_filename_lookup():
    lookup = {}
    if not ICON_DIR.exists():
        return lookup

    for file_path in ICON_DIR.rglob("*"):
        if not file_path.is_file():
            continue
        key = file_path.name.lower()
        if key not in lookup:
            lookup[key] = file_path.relative_to(BASE_DIR).as_posix()
    return lookup


ICON_FILENAME_LOOKUP = build_icon_filename_lookup()


def ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_agents():
    ensure_data_dir()
    if not AGENTS_PATH.exists():
        with AGENTS_PATH.open("w", encoding="utf-8") as file:
            json.dump(DEFAULT_AGENTS, file, indent=2, ensure_ascii=True)
        return list(DEFAULT_AGENTS)

    with AGENTS_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_agents(agents):
    ensure_data_dir()
    with AGENTS_PATH.open("w", encoding="utf-8") as file:
        json.dump(agents, file, indent=2, ensure_ascii=True)


def find_agent_by_name(agents, name):
    normalized = str(name or "").strip().lower()
    return next((agent for agent in agents if agent.get("name", "").lower() == normalized), None)


def sanitize_skill_filename_part(value):
    safe = re.sub(r"[^A-Za-z0-9 _-]", "", str(value or "")).strip()
    safe = re.sub(r"\s+", "_", safe)
    return safe or "Skill"


def validate_agent_folder_name(name):
    return bool(re.fullmatch(r"[A-Za-z0-9 _-]+", str(name or "").strip()))


def get_agent_folder_path(agent_name):
    return ICON_DIR / str(agent_name).strip()


def get_agent_audio_folder_path(agent_name):
    return AUDIO_DIR / str(agent_name).strip()


def save_upload(file_storage, directory: Path, base_filename: str):
    if not file_storage or not file_storage.filename:
        return ""

    ext = Path(secure_filename(file_storage.filename)).suffix.lower()
    if not ext:
        ext = ".png"

    directory.mkdir(parents=True, exist_ok=True)
    filename = f"{base_filename}{ext}"
    destination = directory / filename
    file_storage.save(destination)
    return destination.relative_to(BASE_DIR).as_posix()

MODES = {
    "classic": {
        "label": "Classic Agent Guess",
        "short_label": "Classic",
        "tag": "Original",
        "icon": "icons/Classic_Mode.webp",
        "description": "Guess the agent with full clue feedback.",
        "hero_description": "Guess the agent.",
        "clue_type": "classic",
    },
    "skill-icon": {
        "label": "Skill Icon Guess",
        "short_label": "Skill Icon",
        "tag": "Challenge",
        "icon": "icons/Skill_Icon_Mode.webp",
        "description": "Guess the agent from a skill icon, then solve a bonus skill question.",
        "hero_description": "Guess the agent by skill icon, then answer the bonus skill question.",
        "clue_type": "image",
    },
    "voice-line": {
        "label": "Voice Line Guess",
        "short_label": "Voice Line",
        "tag": "Audio",
        "icon": "icons/Voice_Line_Mode.webp",
        "description": "Guess the agent from their voice line clue.",
        "hero_description": "Guess the agent by voice line.",
        "clue_type": "voice",
    },
}

RANK_ORDER = [
    "Unranked",
    "Iron",
    "Bronze",
    "Silver",
    "Gold",
    "Platinum",
    "Diamond",
    "Ascendant",
    "Immortal",
    "Radiant",
]
RANK_POINTS_PER_TIER = 100


def _default_rank_state():
    return {
        "index": 0,
        "rr": 0,
    }


def _rank_state_key():
    return "rank_state_endless"


def _normalize_rank_state(rank_state):
    if not isinstance(rank_state, dict):
        return _default_rank_state()

    raw_index = int(rank_state.get("index", 0) or 0)
    max_index = len(RANK_ORDER) - 1
    index = max(0, min(raw_index, max_index))

    raw_rr = int(rank_state.get("rr", 0) or 0)
    max_rr = 100 if index == max_index else 99
    rr = max(0, min(raw_rr, max_rr))

    return {"index": index, "rr": rr}


def get_endless_rank_state():
    state = _normalize_rank_state(session.get(_rank_state_key(), _default_rank_state()))
    session[_rank_state_key()] = state
    return state


def save_endless_rank_state(rank_state):
    session[_rank_state_key()] = _normalize_rank_state(rank_state)
    session.modified = True


def _rank_total_points(rank_state):
    normalized = _normalize_rank_state(rank_state)
    return normalized["index"] * RANK_POINTS_PER_TIER + normalized["rr"]


def _rank_from_total_points(total_points):
    max_index = len(RANK_ORDER) - 1
    max_total = max_index * RANK_POINTS_PER_TIER + 100
    clamped = max(0, min(int(total_points), max_total))

    index = min(max_index, clamped // RANK_POINTS_PER_TIER)
    rr = clamped - (index * RANK_POINTS_PER_TIER)
    if index < max_index:
        rr = min(rr, 99)

    return {"index": index, "rr": rr}


def apply_rank_result(rank_state, won):
    delta = 25 if won else -15
    updated = _rank_from_total_points(_rank_total_points(rank_state) + delta)
    return updated, delta


def build_rank_payload(rank_state, delta=0):
    normalized = _normalize_rank_state(rank_state)
    rank_name = RANK_ORDER[normalized["index"]]
    return {
        "name": rank_name,
        "index": normalized["index"],
        "rr": normalized["rr"],
        "delta": delta,
        "icon_url": asset_url(f"icons/Ranks/{rank_name}.webp"),
    }


def admin_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session.get("admin_authenticated"):
            return redirect(url_for("admin_panel"))
        return view_func(*args, **kwargs)

    return wrapper

app = Flask(__name__)
app.secret_key = "valodle-dev-secret"
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["TEMPLATES_AUTO_RELOAD"] = True


def normalize_asset_path(path_value):
    candidate = str(path_value or "").replace("\\", "/").strip("/")
    if not candidate:
        return ""

    if any(candidate.startswith(prefix) for prefix in ALLOWED_ASSET_PREFIXES):
        if (BASE_DIR / candidate).is_file():
            return candidate
        fallback = ICON_FILENAME_LOOKUP.get(Path(candidate).name.lower())
        if fallback:
            return fallback
        return candidate

    fallback = ICON_FILENAME_LOOKUP.get(Path(candidate).name.lower())
    if fallback:
        return fallback
    return f"icons/{Path(candidate).name}"


def asset_url(path_value):
    normalized = normalize_asset_path(path_value)
    return url_for("asset_file", filename=normalized) if normalized else ""


def split_specialties(specialty_value):
    return [part.strip() for part in str(specialty_value).split(",") if part.strip()]


def voice_fallback_line(agent):
    parts = split_specialties(agent.get("specialty", ""))
    if len(parts) >= 2:
        return f"I can {parts[0].lower()} and {parts[1].lower()} when it matters."
    if len(parts) == 1:
        return f"My specialty is {parts[0].lower()}."
    return f"I hold the role of {agent.get('role', 'agent')} in Valorant."


def normalize_variant(value):
    candidate = str(value or "endless").strip().lower()
    return candidate if candidate in GAME_VARIANTS else "endless"


def get_variant_from_request():
    return normalize_variant(request.args.get("variant", "endless"))


def get_daily_timezone():
    try:
        return ZoneInfo(DAILY_TIMEZONE_NAME)
    except Exception:
        return timezone.utc


def now_in_daily_timezone():
    return datetime.now(get_daily_timezone())


def get_daily_key():
    return now_in_daily_timezone().strftime("%Y-%m-%d")


def seconds_until_next_daily_reset():
    now = now_in_daily_timezone()
    next_day = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(0, int((next_day - now).total_seconds()))


def format_seconds_compact(total_seconds):
    seconds = max(0, int(total_seconds or 0))
    hours, rem = divmod(seconds, 3600)
    minutes, _ = divmod(rem, 60)
    if hours > 0:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def daily_complete_message(prefix="Daily puzzle complete"):
    return f"{prefix}. Next puzzle in {format_seconds_compact(seconds_until_next_daily_reset())}."


def deterministic_index(seed, length):
    if length <= 0:
        return 0
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest, 16) % length


def choose_agent(candidates, seed=None):
    if not candidates:
        return None
    if seed:
        ordered = sorted(candidates, key=lambda item: item.get("name", "").lower())
        return ordered[deterministic_index(seed, len(ordered))]
    return random.choice(candidates)


def get_state_key(mode, variant="endless", daily_key=None):
    if variant == "daily":
        day = daily_key or get_daily_key()
        return f"game_state_{mode}_{variant}_{day}"
    return f"game_state_{mode}_{variant}"


def get_skill_icon_hints_for_state(state):
    if state.get("mode") != "skill-icon":
        return []

    hints = state.get("hints", {})
    guesses_count = len(state.get("guesses", []))
    active_hints = []

    function_hint = str(hints.get("function", "")).strip()
    type_hint = str(hints.get("skill_type", "")).strip()

    if guesses_count >= 2 and function_hint:
        active_hints.append({"label": "Function Hint", "value": function_hint})

    if guesses_count >= 4 and type_hint:
        active_hints.append({"label": "Type Hint", "value": type_hint})

    return active_hints


def get_voice_line_hints_for_state(state):
    if state.get("mode") != "voice-line":
        return []

    hints = state.get("hints", {})
    guesses_count = len(state.get("guesses", []))
    active_hints = []

    cast_hint = str(hints.get("cast_hint", "")).strip()
    audio_url = str(hints.get("audio_url", "")).strip()

    if guesses_count >= 2 and cast_hint:
        active_hints.append({"label": "Cast Hint", "value": cast_hint})

    if guesses_count >= 4 and audio_url:
        active_hints.append({"label": "Audio Hint", "value": audio_url})

    return active_hints


def create_mode_round_state(mode, streak=0, variant="endless", daily_key=None):
    agents = get_agents()
    if not agents:
        raise ValueError("No agents available in the database.")

    variant = normalize_variant(variant)
    if variant == "daily":
        daily_key = daily_key or get_daily_key()

    mode_seed = f"{daily_key}:{mode}" if variant == "daily" else ""

    if mode == "skill-icon":
        skill_icon_db = get_skill_icon_db()
        candidates = [agent for agent in agents if skill_icon_db.get(agent["name"])]
        if candidates:
            agent = choose_agent(candidates, mode_seed)
        else:
            agent = choose_agent(agents, mode_seed)
    elif mode == "voice-line":
        voice_lines = load_voice_lines()
        candidates = []
        for agent in agents:
            lines = voice_lines.get(agent.get("name", ""), {})
            ally_line = str(lines.get("ultimate_ally_line", "")).strip()
            enemy_line = str(lines.get("ultimate_enemy_line", "")).strip()
            ally_audio = str(lines.get("ultimate_ally_audio", "")).strip()
            enemy_audio = str(lines.get("ultimate_enemy_audio", "")).strip()
            if ally_line or enemy_line or ally_audio or enemy_audio:
                candidates.append(agent)
        if candidates:
            agent = choose_agent(candidates, mode_seed)
        else:
            agent = choose_agent(agents, mode_seed)
    else:
        agent = choose_agent(agents, mode_seed)

    state = {
        "mode": mode,
        "variant": variant,
        "daily_key": daily_key if variant == "daily" else "",
        "secret_name": agent["name"],
        "attempts_left": 5,
        "streak": streak,
        "status": "playing",
        "guesses": [],
        "bonus": {"enabled": False, "status": "off", "answer": ""},
    }

    if mode == "skill-icon":
        skill_icon_db = get_skill_icon_db()
        skill_entries = skill_icon_db.get(agent["name"], [])
        if variant == "daily":
            skill_entries = sorted(
                skill_entries,
                key=lambda item: (
                    str(item.get("keybind", "")).upper(),
                    str(item.get("icon", "")).lower(),
                ),
            )
        if skill_entries:
            if variant == "daily":
                index = deterministic_index(f"{mode_seed}:{agent['name']}:skill", len(skill_entries))
                selected_skill = skill_entries[index]
            else:
                selected_skill = random.choice(skill_entries)
        else:
            selected_skill = None

        if selected_skill:
            skill_icon_path = selected_skill.get("icon") or agent.get("image", "")
            bonus_answer = str(selected_skill.get("keybind", "")).upper()
            skill_name = str(selected_skill.get("skill_name", "")).strip()
            function_hint = str(selected_skill.get("function_hint", "")).strip()
            skill_type = str(selected_skill.get("skill_type", "")).strip()
        else:
            # Fallback so the mode still works even if skill data is incomplete.
            specialties = split_specialties(agent.get("specialty", ""))
            if specialties and variant == "daily":
                bonus_answer = specialties[deterministic_index(f"{mode_seed}:{agent['name']}:fallback", len(specialties))]
            else:
                bonus_answer = random.choice(specialties) if specialties else "Unknown"
            skill_name = ""
            function_hint = ""
            skill_type = ""
            skill_icon_path = agent.get("skill_icon", agent.get("image", ""))

        state["clue"] = {
            "type": "image",
            "body": "Guess the agent from this skill icon.",
            "image_url": asset_url(skill_icon_path),
        }
        state["hints"] = {
            "skill_name": skill_name,
            "function": function_hint,
            "skill_type": skill_type,
        }
        state["bonus"] = {
            "enabled": True,
            "status": "pending",
            "answer": bonus_answer,
            "options": ["C", "Q", "E", "X"],
        }
        return state

    if mode == "voice-line":
        ally_line = get_voice_line(agent["name"], "ultimate_ally_line")
        enemy_line = get_voice_line(agent["name"], "ultimate_enemy_line")
        ally_audio = get_voice_line(agent["name"], "ultimate_ally_audio")
        enemy_audio = get_voice_line(agent["name"], "ultimate_enemy_audio")
        cast_options = []
        if ally_line or ally_audio:
            cast_options.append(("Ally Cast", ally_line, ally_audio))
        if enemy_line or enemy_audio:
            cast_options.append(("Enemy Cast", enemy_line, enemy_audio))

        if cast_options:
            if variant == "daily":
                idx = deterministic_index(f"{mode_seed}:{agent['name']}:cast", len(cast_options))
                cast_label, voice_line, voice_audio = cast_options[idx]
            else:
                cast_label, voice_line, voice_audio = random.choice(cast_options)
            body = "Guess the agent from this ultimate voice line."
        else:
            voice_line = ""
            voice_audio = ""
            cast_label = ""
            body = "No voice line configured for this agent yet."

        state["clue"] = {
            "type": "voice",
            "body": body,
            "audio_url": asset_url(voice_audio),
            "voice_text": voice_line,
        }
        state["hints"] = {
            "cast_hint": cast_label,
            "audio_url": asset_url(voice_audio),
        }
        return state

    state["clue"] = {
        "type": "classic",
        "body": "Guess the agent.",
    }
    return state


def get_mode_state(mode, variant="endless"):
    variant = normalize_variant(variant)
    daily_key = get_daily_key() if variant == "daily" else ""
    state_key = get_state_key(mode, variant, daily_key)
    state = session.get(state_key)
    if not state or state.get("mode") != mode or state.get("variant", "endless") != variant:
        state = create_mode_round_state(mode, variant=variant, daily_key=daily_key)
        session[state_key] = state
    return state


def save_mode_state(mode, state, variant="endless"):
    variant = normalize_variant(variant)
    daily_key = state.get("daily_key") if variant == "daily" else ""
    session[get_state_key(mode, variant, daily_key)] = state
    session.modified = True


def build_mode_page_state(mode, variant="endless"):
    variant = normalize_variant(variant)
    state = get_mode_state(mode, variant)
    agents = get_agents()
    secret_agent = find_agent_by_name(agents, state["secret_name"])
    reveal_agent = None

    if state["status"] != "playing" and secret_agent:
        reveal_agent = serialize_public_agent(secret_agent)
        reveal_agent["image_url"] = asset_url(secret_agent["image"])

    agent_options = [
        {
            "name": agent["name"],
            "image_url": asset_url(agent["image"]),
        }
        for agent in agents
    ]

    page_state = {
        "mode": mode,
        "variant": variant,
        "daily_key": state.get("daily_key", ""),
        "daily_seconds_remaining": seconds_until_next_daily_reset() if variant == "daily" else 0,
        "attempts_left": state["attempts_left"],
        "streak": state["streak"],
        "status": state["status"],
        "guesses": state["guesses"],
        "reveal_agent": reveal_agent,
        "agent_options": agent_options,
        "clue": state.get("clue", {}),
        "bonus": {
            "enabled": state.get("bonus", {}).get("enabled", False),
            "status": state.get("bonus", {}).get("status", "off"),
            "options": state.get("bonus", {}).get("options", ["C", "Q", "E", "X"]),
        },
        "hints": state.get("hints", {}),
        "active_hints": get_skill_icon_hints_for_state(state) if mode == "skill-icon" else get_voice_line_hints_for_state(state),
    }

    if variant == "endless":
        page_state["rank"] = build_rank_payload(get_endless_rank_state())

    return page_state


def ensure_mode_or_404(mode):
    if mode not in MODES:
        abort(404)


@app.route("/")
def home():
    return render_template("landing.html")


@app.route("/modes/<variant>")
def mode_home(variant):
    variant = normalize_variant(variant)
    variant_label = "Classic Daily" if variant == "daily" else "Endless Mode"
    variant_subtitle = (
        "Guess the agent of today. One shared puzzle per day in each mode."
        if variant == "daily"
        else "Play unlimited rounds. Keep your streak going as long as you can."
    )

    mode_cards = []
    for key, info in MODES.items():
        mode_cards.append(
            {
                "key": key,
                "label": info["label"],
                "short_label": info["short_label"],
                "description": info["description"],
                "tag": info["tag"],
                "icon": info.get("icon", ""),
            }
        )
    return render_template(
        "home.html",
        modes=mode_cards,
        variant=variant,
        variant_label=variant_label,
        variant_subtitle=variant_subtitle,
    )


@app.route("/admin")
def admin_panel():
    if session.get("admin_authenticated"):
        return render_template("admin_home.html", message=request.args.get("msg", ""))
    return render_template("admin_login.html", message=request.args.get("msg", ""))


@app.route("/admin/login", methods=["POST"])
def admin_login():
    password = str(request.form.get("password", "")).strip()
    if password and password == ADMIN_PASSWORD:
        session["admin_authenticated"] = True
        session.modified = True
        return redirect(url_for("admin_panel", msg="Welcome+back"))

    return redirect(url_for("admin_panel", msg="Wrong+password"))


@app.route("/admin/logout")
@admin_required
def admin_logout():
    session.pop("admin_authenticated", None)
    session.modified = True
    return redirect(url_for("home"))


@app.route("/admin/add")
@admin_required
def admin_add_agent_page():
    agents = sorted(get_agents(), key=lambda item: item.get("name", "").lower())
    return render_template("admin_add.html", agents=agents, message=request.args.get("msg", ""))


@app.route("/admin/add/save", methods=["POST"])
@admin_required
def admin_add_agent_save():
    agents = get_agents()
    name = str(request.form.get("name", "")).strip()
    if not name:
        return redirect(url_for("admin_add_agent_page", msg="Agent+name+is+required"))

    if not validate_agent_folder_name(name):
        return redirect(url_for("admin_add_agent_page", msg="Use+letters+numbers+spaces+underscore+or+dash+for+agent+name"))

    if find_agent_by_name(agents, name):
        return redirect(url_for("admin_add_agent_page", msg="Agent+already+exists.+Use+Edit+Agent+instead"))

    agent_folder = get_agent_folder_path(name)
    agent_folder.mkdir(parents=True, exist_ok=True)

    agent_icon_path = save_upload(request.files.get("agent_icon"), agent_folder, f"{name}_icon")
    if not agent_icon_path:
        return redirect(url_for("admin_add_agent_page", msg="Agent+icon+upload+is+required"))

    payload = {
        "name": name,
        "gender": str(request.form.get("gender", "")).strip() or "Unknown",
        "specialty": str(request.form.get("specialty", "")).strip() or "Unknown",
        "role": str(request.form.get("role", "")).strip() or "Unknown",
        "nationality": str(request.form.get("nationality", "")).strip() or "Unknown",
        "color_palette": str(request.form.get("color_palette", "")).strip() or "Unknown",
        "image": agent_icon_path,
    }

    agents.append(payload)
    save_agents(agents)

    # Save voice lines to separate database
    voice_lines = load_voice_lines()
    audio_folder = get_agent_audio_folder_path(name)
    ally_audio_path = save_upload(request.files.get("ultimate_ally_audio"), audio_folder, "ultimate_ally")
    enemy_audio_path = save_upload(request.files.get("ultimate_enemy_audio"), audio_folder, "ultimate_enemy")
    voice_lines[name] = {
        "ultimate_ally_line": str(request.form.get("ultimate_ally_line", "")).strip(),
        "ultimate_enemy_line": str(request.form.get("ultimate_enemy_line", "")).strip(),
        "ultimate_ally_audio": ally_audio_path,
        "ultimate_enemy_audio": enemy_audio_path,
    }
    save_voice_lines(voice_lines)

    skill_hints = load_skill_hint_overrides()
    skill_hints.setdefault(name, {})

    for keybind in VALID_KEYBINDS:
        skill_name = str(request.form.get(f"skill_name_{keybind}", "")).strip()
        skill_function = str(request.form.get(f"skill_function_{keybind}", "")).strip()
        skill_icon_file = request.files.get(f"skill_icon_{keybind}")

        if not skill_name and skill_icon_file and skill_icon_file.filename:
            return redirect(url_for("admin_add_agent_page", msg=f"Provide+skill+name+for+{keybind}"))

        if skill_name or skill_function:
            safe_skill = sanitize_skill_filename_part(skill_name or f"Skill_{keybind}")
            save_upload(skill_icon_file, agent_folder, f"{safe_skill}-{keybind}")
            skill_hints[name][keybind] = {
                "name": skill_name,
                "function": skill_function,
            }

    if not skill_hints[name]:
        skill_hints.pop(name, None)
    save_skill_hint_overrides(skill_hints)

    return redirect(url_for("admin_add_agent_page", msg="Agent+added+with+folder+and+assets"))


@app.route("/admin/edit")
@admin_required
def admin_edit_agent_page():
    agents = sorted(get_agents(), key=lambda item: item.get("name", "").lower())
    selected_name = str(request.args.get("agent", "")).strip()
    selected_agent = find_agent_by_name(agents, selected_name) if selected_name else (agents[0] if agents else None)
    skill_hints = load_skill_hint_overrides()
    selected_hints = skill_hints.get(selected_agent.get("name", ""), {}) if selected_agent else {}
    selected_hints = {
        keybind: {
            "name": str(value.get("name", "")).strip(),
            "function": str(value.get("function", "")).strip(),
        }
        for keybind, value in selected_hints.items()
        if isinstance(value, dict)
    }
    
    voice_lines = load_voice_lines()
    selected_voice_lines = voice_lines.get(selected_agent.get("name", ""), {}) if selected_agent else {}
    
    return render_template(
        "admin_edit.html",
        agents=agents,
        selected_agent=selected_agent,
        selected_hints=selected_hints,
        selected_voice_lines=selected_voice_lines,
        message=request.args.get("msg", ""),
    )


@app.route("/admin/edit/save", methods=["POST"])
@admin_required
def admin_edit_agent_save():
    agents = get_agents()
    agent_name = str(request.form.get("agent_name", "")).strip()
    agent = find_agent_by_name(agents, agent_name)
    if not agent:
        return redirect(url_for("admin_edit_agent_page", msg="Select+a+valid+agent"))

    agent_folder = get_agent_folder_path(agent_name)
    agent_folder.mkdir(parents=True, exist_ok=True)

    icon_path = save_upload(request.files.get("agent_icon"), agent_folder, f"{agent_name}_icon")
    if icon_path:
        agent["image"] = icon_path

    for field in ("gender", "specialty", "role", "nationality", "color_palette"):
        incoming = str(request.form.get(field, "")).strip()
        if incoming:
            agent[field] = incoming

    save_agents(agents)

    # Save voice lines to separate database
    voice_lines = load_voice_lines()
    if agent_name not in voice_lines:
        voice_lines[agent_name] = {}

    audio_folder = get_agent_audio_folder_path(agent_name)
    ally_audio_path = save_upload(request.files.get("ultimate_ally_audio"), audio_folder, "ultimate_ally")
    enemy_audio_path = save_upload(request.files.get("ultimate_enemy_audio"), audio_folder, "ultimate_enemy")

    voice_lines[agent_name]["ultimate_ally_line"] = str(request.form.get("ultimate_ally_line", "")).strip()
    voice_lines[agent_name]["ultimate_enemy_line"] = str(request.form.get("ultimate_enemy_line", "")).strip()
    if ally_audio_path:
        voice_lines[agent_name]["ultimate_ally_audio"] = ally_audio_path
    if enemy_audio_path:
        voice_lines[agent_name]["ultimate_enemy_audio"] = enemy_audio_path
    save_voice_lines(voice_lines)

    skill_hints = load_skill_hint_overrides()
    skill_hints.setdefault(agent_name, {})
    for keybind in VALID_KEYBINDS:
        skill_name = str(request.form.get(f"skill_name_{keybind}", "")).strip()
        skill_function = str(request.form.get(f"skill_function_{keybind}", "")).strip()
        skill_icon_file = request.files.get(f"skill_icon_{keybind}")

        if skill_name or skill_function:
            skill_hints[agent_name][keybind] = {
                "name": skill_name,
                "function": skill_function,
            }

        if skill_icon_file and skill_icon_file.filename:
            effective_name = skill_name or (skill_hints[agent_name].get(keybind, {}).get("name", "") if isinstance(skill_hints[agent_name].get(keybind), dict) else skill_hints[agent_name].get(keybind, "")) or f"Skill_{keybind}"
            safe_skill = sanitize_skill_filename_part(effective_name)
            save_upload(skill_icon_file, agent_folder, f"{safe_skill}-{keybind}")

    if not skill_hints[agent_name]:
        skill_hints.pop(agent_name, None)
    save_skill_hint_overrides(skill_hints)

    return redirect(url_for("admin_edit_agent_page", agent=agent_name, msg="Agent+updated"))


@app.route("/admin/delete", methods=["POST"])
@admin_required
def admin_delete_agent():
    agents = get_agents()
    agent_name = str(request.form.get("agent_name", "")).strip()
    agent = find_agent_by_name(agents, agent_name)
    if not agent:
        return redirect(url_for("admin_edit_agent_page", msg="Agent+not+found"))

    agents.remove(agent)
    save_agents(agents)

    agent_folder = get_agent_folder_path(agent_name)
    if agent_folder.exists():
        shutil.rmtree(agent_folder)

    audio_folder = get_agent_audio_folder_path(agent_name)
    if audio_folder.exists():
        shutil.rmtree(audio_folder)

    skill_hints = load_skill_hint_overrides()
    skill_hints.pop(agent_name, None)
    save_skill_hint_overrides(skill_hints)

    delete_voice_lines(agent_name)

    return redirect(url_for("admin_edit_agent_page", msg=f"Agent+{agent_name}+deleted"))


@app.route("/play/<mode>")
def play_mode(mode):
    ensure_mode_or_404(mode)
    variant = get_variant_from_request()
    mode_meta = MODES[mode]
    page_state = build_mode_page_state(mode, variant)
    return render_template(
        "game.html",
        mode_key=mode,
        variant=variant,
        mode_label=mode_meta["label"],
        mode_description=mode_meta["hero_description"],
        page_state=json.dumps(page_state),
    )


@app.route("/api/<mode>/guess", methods=["POST"])
def api_guess(mode):
    ensure_mode_or_404(mode)
    variant = get_variant_from_request()
    state = get_mode_state(mode, variant)
    agents = get_agents()

    if state["status"] != "playing":
        if variant == "daily":
            return jsonify({"ok": False, "message": daily_complete_message()}), 409
        return jsonify({"ok": False, "message": "Round finished. Continue or start a new game."}), 409

    payload = request.get_json(silent=True) or {}
    guess_name = str(payload.get("guess", "")).strip()

    if not guess_name:
        return jsonify({"ok": False, "message": "Enter an agent name."}), 400

    guessed_agent = find_agent_by_name(agents, guess_name)
    if not guessed_agent:
        return jsonify({"ok": False, "message": "Agent not recognized."}), 404

    secret_agent = find_agent_by_name(agents, state["secret_name"])
    if not secret_agent:
        state = create_mode_round_state(mode, state["streak"], variant, state.get("daily_key") or get_daily_key())
        save_mode_state(mode, state, variant)
        return jsonify({"ok": False, "message": "Round reset. Try again."}), 500

    feedback = build_feedback(guessed_agent, secret_agent)
    entry = {
        "guess": guessed_agent["name"],
        "image_url": asset_url(guessed_agent["image"]),
        "feedback": feedback,
        "is_correct": guessed_agent["name"].lower() == secret_agent["name"].lower(),
    }

    state["guesses"].append(entry)

    if entry["is_correct"]:
        state["status"] = "won"
        state["streak"] += 1
    else:
        state["attempts_left"] -= 1
        if state["attempts_left"] <= 0:
            state["status"] = "lost"
            state["streak"] = 0

    rank_payload = None
    if variant == "endless":
        current_rank = get_endless_rank_state()
        if state["status"] in {"won", "lost"}:
            updated_rank, rank_delta = apply_rank_result(current_rank, state["status"] == "won")
            save_endless_rank_state(updated_rank)
            rank_payload = build_rank_payload(updated_rank, rank_delta)
        else:
            rank_payload = build_rank_payload(current_rank)

    save_mode_state(mode, state, variant)

    response = {
        "ok": True,
        "status": state["status"],
        "attempts_left": state["attempts_left"],
        "streak": state["streak"],
        "guess": entry,
    }

    if mode == "skill-icon":
        response["active_hints"] = get_skill_icon_hints_for_state(state)
    elif mode == "voice-line":
        response["active_hints"] = get_voice_line_hints_for_state(state)

    if rank_payload:
        response["rank"] = rank_payload

    if state["status"] in {"won", "lost"}:
        response["reveal_agent"] = {
            **serialize_public_agent(secret_agent),
            "image_url": asset_url(secret_agent["image"]),
        }
        response["bonus_status"] = state.get("bonus", {}).get("status", "off")

    return jsonify(response)


@app.route("/api/<mode>/new-game", methods=["POST"])
def api_new_game(mode):
    ensure_mode_or_404(mode)
    variant = get_variant_from_request()
    if variant == "daily":
        return jsonify({"ok": False, "message": daily_complete_message("Daily mode can only be played once per day")}), 409

    state = create_mode_round_state(mode, 0, variant)
    save_mode_state(mode, state, variant)
    response = {
            "ok": True,
            "attempts_left": state["attempts_left"],
            "streak": state["streak"],
            "status": state["status"],
            "clue": state.get("clue", {}),
            "hints": state.get("hints", {}),
            "bonus": {
                "enabled": state.get("bonus", {}).get("enabled", False),
                "status": state.get("bonus", {}).get("status", "off"),
                "options": state.get("bonus", {}).get("options", ["C", "Q", "E", "X"]),
            },
            "active_hints": get_skill_icon_hints_for_state(state) if mode == "skill-icon" else get_voice_line_hints_for_state(state),
    }

    if variant == "endless":
        response["rank"] = build_rank_payload(get_endless_rank_state())

    return jsonify(response)


@app.route("/api/<mode>/next-round", methods=["POST"])
def api_next_round(mode):
    ensure_mode_or_404(mode)
    variant = get_variant_from_request()
    if variant == "daily":
        return jsonify({"ok": False, "message": daily_complete_message("Daily mode can only be played once per day")}), 409

    current = get_mode_state(mode, variant)
    state = create_mode_round_state(mode, current["streak"], variant)
    save_mode_state(mode, state, variant)
    response = {
            "ok": True,
            "attempts_left": state["attempts_left"],
            "streak": state["streak"],
            "status": state["status"],
            "clue": state.get("clue", {}),
            "hints": state.get("hints", {}),
            "bonus": {
                "enabled": state.get("bonus", {}).get("enabled", False),
                "status": state.get("bonus", {}).get("status", "off"),
                "options": state.get("bonus", {}).get("options", ["C", "Q", "E", "X"]),
            },
            "active_hints": get_skill_icon_hints_for_state(state) if mode == "skill-icon" else get_voice_line_hints_for_state(state),
    }

    if variant == "endless":
        response["rank"] = build_rank_payload(get_endless_rank_state())

    return jsonify(response)


@app.route("/api/skill-icon/bonus", methods=["POST"])
def api_skill_bonus():
    mode = "skill-icon"
    variant = get_variant_from_request()
    state = get_mode_state(mode, variant)

    if state.get("status") != "won":
        return jsonify({"ok": False, "message": "Bonus is available only after a correct guess."}), 409

    if not state.get("bonus", {}).get("enabled"):
        return jsonify({"ok": False, "message": "No bonus available for this mode."}), 400

    payload = request.get_json(silent=True) or {}
    bonus_guess = str(payload.get("bonus", "")).strip().upper()
    answer = str(state.get("bonus", {}).get("answer", "")).strip().upper()

    if not bonus_guess:
        return jsonify({"ok": False, "message": "Pick a keybind."}), 400

    correct = bonus_guess == answer
    if correct:
        state["bonus"]["status"] = "solved"
        save_mode_state(mode, state, variant)

    return jsonify({"ok": True, "correct": correct, "status": state["bonus"]["status"]})


@app.route("/assets/<path:filename>")
def asset_file(filename):
    normalized = str(filename).replace("\\", "/").strip("/")
    if not any(normalized.startswith(prefix) for prefix in ALLOWED_ASSET_PREFIXES):
        abort(404)
    return send_from_directory(BASE_DIR, normalized)


if __name__ == "__main__":
    app.run(debug=True)
