from __future__ import annotations

import re

from config import JOB_BOARD_LABELS, SERVICE_WRITER_PRIORITY, SERVICE_WRITERS
from numeric import currency, number


def job_category(label: str) -> str:
    normalized = label.lower()
    groups = {
        "attention": ("attn", "assist", "big daddy", "72hrs", "documentation"),
        "authorization": ("authorization", "approval", "declined"),
        "parts": ("part", "arrival", "sublet", "po#"),
        "production": ("scheduled", "in-progress", "tech finished", "verify", "estimate"),
        "completed": ("balance due", "credit due", "customer contacted", "ready to post", "payment link"),
        "warranty": ("warranty", "3rdparty"),
        "exception": ("abandonment", "labor lien", "no show", "need key", "do not touch"),
    }
    for category, tokens in groups.items():
        if any(token in normalized for token in tokens):
            return category
    return "other"


def parse_age_days(text: str) -> int:
    match = re.search(r"Created\s+(\d+)\s*([mhdM])\s+ago", text)
    if not match:
        return 0
    amount = int(match.group(1))
    unit = match.group(2)
    if unit == "M":
        return amount * 30
    if unit == "d":
        return amount
    return 0


def parse_job_card(raw: dict) -> dict | None:
    text = str(raw.get("text") or "")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    ro_match = re.search(r"RO#(\d+)", text)
    phone_match = re.search(r"\(\d{3}\)\s*\d{3}-\d{4}", text)
    if not ro_match or not phone_match:
        return None
    known_labels = {item.casefold(): item for item in JOB_BOARD_LABELS}
    label = next(
        (known_labels[line.casefold()] for line in lines if line.casefold() in known_labels),
        "Unlabeled",
    )
    customer_line = next(
        (line for line in lines if phone_match.group(0) in line),
        "",
    )
    customer = re.sub(r"\(\d{3}\)\s*\d{3}-\d{4}", "", customer_line)
    customer = customer.replace("•", "").strip()
    phone_index = lines.index(customer_line) if customer_line in lines else -1
    if not customer and phone_index > 0:
        for candidate in reversed(lines[:phone_index]):
            cleaned = candidate.replace("•", "").strip(" ·")
            if (
                not cleaned
                or cleaned.casefold() in known_labels
                or re.fullmatch(r"[A-Z]{1,3}", cleaned)
                or re.fullmatch(r"RO#\d+", cleaned, re.IGNORECASE)
                or cleaned.startswith("Created ")
                or re.fullmatch(r"\d+\s*[mhdM]\s+ago(?:\s*-\s*Pending)?", cleaned)
            ):
                continue
            if re.search(r"[A-Za-z]", cleaned):
                customer = cleaned
                break
    vehicle = ""
    for candidate in lines[phone_index + 1:] if phone_index >= 0 else []:
        cleaned = candidate.replace("•", "").strip(" ·")
        if re.match(r"^\d{4}\s+\S", cleaned):
            vehicle = cleaned
            break
    initials = set(re.findall(r"(?<![A-Z])[A-Z]{2}(?![A-Z#])", text))
    writer_initial = next(
        (initial for initial in SERVICE_WRITER_PRIORITY if initial in initials),
        "",
    )
    section = str(raw.get("section") or "unknown")
    age_days = parse_age_days(text)
    money_values = re.findall(r"\$[\d,]+(?:\.\d{2})?", text)
    hour_progress = re.findall(
        r"(?<![\d.$])([0-9]{1,3}(?:\.[0-9]{1,2})?)\s*/\s*"
        r"([0-9]{1,3}(?:\.[0-9]{1,2})?)(?:\s*(?:hrs?|hours?))?(?![\d/])",
        text, re.I,
    )
    sold_hours = max((number(total) for _worked, total in hour_progress), default=0)
    activity_ages = re.findall(r"(\d+)\s*([mhdM])\s+ago", text)
    latest_activity_days = min(
        (
            int(value) * 30 if unit == "M" else int(value) if unit == "d" else 0
            for value, unit in activity_ages
        ),
        default=age_days,
    )
    return {
        "roNumber": ro_match.group(1),
        "section": section,
        "label": label,
        "category": job_category(label),
        "customer": customer,
        "phone": phone_match.group(0),
        "vehicle": vehicle,
        "serviceWriter": SERVICE_WRITERS.get(writer_initial, "Unassigned"),
        "serviceWriterInitials": writer_initial,
        "assignedInitials": sorted(initials),
        "ageDays": age_days,
        "daysSinceActivity": latest_activity_days,
        "amount": currency(money_values[-1]) if money_values else 0,
        "soldHours": round(sold_hours, 2),
        "balanceDue": "Balance Due" in text,
        "rawText": text[:2000],
        "detailUrl": str(raw.get("href") or ""),
    }
