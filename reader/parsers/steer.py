from __future__ import annotations

import hashlib
import re


def classify_customer(name: str) -> str:
    """Conservative first pass; uncertain records stay personal for review."""
    business_terms = re.compile(
        r"\b(LLC|INC|CORP|CO\.?|COMPANY|TOWING|ELECTRIC|PLUMBING|CONSTRUCTION|"
        r"COUNTY|CITY OF|POLICE|SHERIFF|SCHOOL|CHURCH|FARMS?|SERVICES?|TRUCKING|"
        r"LOGISTICS|LANDSCAPING|ROOFING|HVAC|ENTERPRISE|RENTAL)\b",
        re.IGNORECASE,
    )
    return "business" if business_terms.search(name) else "personal"


def parse_steer_row(text: str) -> dict | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return None
    phone_match = re.search(r"\(\d{3}\)\s*\d{3}-\d{4}", text)
    last_visit_match = re.search(r"Last Visit:\s*([^\n]+)", text, re.IGNORECASE)
    heat = len(re.findall(r"🔥", text))
    signals = [
        line for line in lines
        if any(token in line for token in ("Svc Due", "Last Appt", "Since Last Visit", "Maint. Svc"))
    ]
    ignored = re.compile(r"^(Call Guide|More \(\d+\)|Last Visit:|\(\d{3}\))", re.IGNORECASE)
    content = [line for line in lines if not ignored.search(line) and "🔥" not in line]
    if len(content) < 2:
        return None
    customer = content[0]
    vehicle = content[1]
    opportunity_key = hashlib.sha1(
        f"{customer}|{vehicle}|{phone_match.group(0) if phone_match else ''}".encode("utf-8")
    ).hexdigest()
    return {
        "key": opportunity_key,
        "customer": customer,
        "vehicle": vehicle,
        "phone": phone_match.group(0) if phone_match else "",
        "lastVisit": last_visit_match.group(1).strip() if last_visit_match else "",
        "heat": heat,
        "signals": signals[:6],
        "recommendedServices": [
            signal for signal in signals
            if "svc" in signal.lower() or "service" in signal.lower()
        ][:6],
        "customerType": classify_customer(customer),
    }
