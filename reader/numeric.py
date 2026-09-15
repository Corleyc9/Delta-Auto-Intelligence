from __future__ import annotations

import re


def currency(value: str) -> float:
    cleaned = re.sub(r"[^0-9.\-]", "", value or "")
    return float(cleaned or 0)


def number(value: str) -> float:
    match = re.search(r"-?\d+(?:\.\d+)?", value or "")
    return float(match.group(0)) if match else 0
