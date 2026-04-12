import random
from typing import Dict, List, Optional

from agents_db import AGENTS

ATTRIBUTES = ["gender", "specialty", "role", "nationality", "color_palette"]
ATTRIBUTE_LABELS = {
    "gender": "Gender",
    "specialty": "Specialty",
    "role": "Role",
    "nationality": "Nationality",
    "color_palette": "Color Palette",
}

PARTIAL_ATTRIBUTE_RULES = {
    "specialty": lambda guess, actual: any(
        token.strip().lower() in actual.lower() for token in guess.split(",") if token.strip()
    ),
    "color_palette": lambda guess, actual: any(
        token.strip().lower() in actual.lower() for token in guess.split("and") if token.strip()
    ),
}


def pick_random_agent() -> Dict[str, str]:
    return random.choice(AGENTS)


def find_agent(name: str) -> Optional[Dict[str, str]]:
    normalized = name.strip().lower()
    return next((agent for agent in AGENTS if agent["name"].lower() == normalized), None)


def build_feedback(guess_agent: Dict[str, str], secret_agent: Dict[str, str]) -> List[Dict[str, str]]:
    feedback = []
    for attribute in ATTRIBUTES:
        guessed_value = guess_agent[attribute]
        actual_value = secret_agent[attribute]
        status = "miss"

        if guessed_value == actual_value:
            status = "match"
        elif attribute in PARTIAL_ATTRIBUTE_RULES and PARTIAL_ATTRIBUTE_RULES[attribute](guessed_value, actual_value):
            status = "partial"

        feedback.append(
            {
                "key": attribute,
                "label": ATTRIBUTE_LABELS[attribute],
                "guess": guessed_value,
                "actual": actual_value,
                "status": status,
            }
        )
    return feedback


def create_round_state(streak: int = 0) -> Dict[str, object]:
    secret_agent = pick_random_agent()
    return {
        "secret_name": secret_agent["name"],
        "attempts_left": 5,
        "streak": streak,
        "status": "playing",
        "guesses": [],
    }


def serialize_public_agent(agent: Dict[str, str]) -> Dict[str, str]:
    return {
        "name": agent["name"],
        "gender": agent["gender"],
        "specialty": agent["specialty"],
        "role": agent["role"],
        "nationality": agent["nationality"],
        "color_palette": agent["color_palette"],
        "image": agent["image"],
    }
