import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
VOICE_LINES_PATH = DATA_DIR / "voice_lines.json"

# Default voice lines for agents
DEFAULT_VOICE_LINES = {
    "Astra": {
        "ultimate_ally_line": "",
        "ultimate_enemy_line": "",
    },
}


def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def load_voice_lines():
    """Load voice lines from database. Returns dict with agent names as keys."""
    _ensure_data_dir()
    if VOICE_LINES_PATH.exists():
        with VOICE_LINES_PATH.open("r", encoding="utf-8") as file:
            return json.load(file)
    return dict(DEFAULT_VOICE_LINES)


def save_voice_lines(voice_lines):
    """Save voice lines to database."""
    _ensure_data_dir()
    with VOICE_LINES_PATH.open("w", encoding="utf-8") as file:
        json.dump(voice_lines, file, indent=2, ensure_ascii=True)


def get_voice_line(agent_name, line_type):
    """Get a specific voice line for an agent. line_type is 'ultimate_ally_line' or 'ultimate_enemy_line'."""
    voice_lines = load_voice_lines()
    agent_lines = voice_lines.get(agent_name, {})
    return agent_lines.get(line_type, "")


def set_voice_line(agent_name, line_type, text):
    """Set a voice line for an agent."""
    voice_lines = load_voice_lines()
    if agent_name not in voice_lines:
        voice_lines[agent_name] = {}
    voice_lines[agent_name][line_type] = text
    save_voice_lines(voice_lines)


def delete_voice_lines(agent_name):
    """Delete all voice lines for an agent."""
    voice_lines = load_voice_lines()
    voice_lines.pop(agent_name, None)
    save_voice_lines(voice_lines)
