"""2.1.3: VIN + year/make/model for job-board ROs. Read-only.

Sources (cheapest first):
  1. Tekmetric JSON the reader already loads: appointments day-view `vehicle{vin, year, make, model}` with
     `repairOrder.repairOrderNumber`, and Tech Board `repairOrders[]` when it carries `vehicle`.
  2. The RO page text (same header the warranty reader parses: "VIN\\n<17 chars>").
"""
from __future__ import annotations

import re

VIN_RE = re.compile(r"\b([A-HJ-NPR-Z0-9]{17})\b", re.I)
LABELED_VIN_RE = re.compile(r"\bVIN\s*[:#]?\s*\n?\s*([A-HJ-NPR-Z0-9]{17})\b", re.I)
YEAR_LINE_RE = re.compile(r"^((?:19|20)\d{2})\s+([A-Za-z][\w-]*(?:\s+Benz)?)\s+(.+)$")


def clean_vin(value) -> str:
    vin = re.sub(r"[^A-Za-z0-9]", "", str(value or "")).upper()
    # A real VIN has letters and digits; no I/O/Q.
    if re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", vin) and re.search(r"\d", vin) and re.search(r"[A-Z]", vin):
        return vin
    return ""


def vin_from_text(text: str) -> str:
    text = str(text or "")
    labeled = LABELED_VIN_RE.search(text)
    if labeled and clean_vin(labeled.group(1)):
        return clean_vin(labeled.group(1))
    for match in VIN_RE.finditer(text):
        vin = clean_vin(match.group(1))
        if vin:
            return vin
    return ""


def ymm_from_vehicle(vehicle: str) -> dict:
    match = YEAR_LINE_RE.match(str(vehicle or "").strip())
    if not match:
        return {}
    return {"year": match.group(1), "make": match.group(2), "model": match.group(3).strip()[:80]}


def vehicle_from_text(text: str) -> dict:
    """RO page body → {vin, year, make, model} (empty fields left out)."""
    out: dict = {}
    vin = vin_from_text(text)
    if vin:
        out["vin"] = vin
    for line in str(text or "").splitlines():
        ymm = ymm_from_vehicle(line)
        if ymm and len(line) < 80:
            out.update(ymm)
            break
    return out


def _vehicle_dict(vehicle) -> dict:
    if not isinstance(vehicle, dict):
        return {}
    out = {k: str(vehicle.get(k) or "").strip()[:80] for k in ("year", "make", "model") if vehicle.get(k)}
    vin = clean_vin(vehicle.get("vin"))
    if vin:
        out["vin"] = vin
    return out


def vehicles_from_payloads(appointments_payload=None, tech_board_payload=None) -> dict[str, dict]:
    """RO number → {vin, year, make, model} from Tekmetric JSON payloads the reader already reads."""
    result: dict[str, dict] = {}
    items = appointments_payload if isinstance(appointments_payload, list) else (appointments_payload or {}).get("content") or []
    for item in items:
        if not isinstance(item, dict):
            continue
        ro = str(((item.get("repairOrder") or {}).get("repairOrderNumber")) or "")
        found = _vehicle_dict(item.get("vehicle"))
        if ro and found.get("vin"):
            result[ro] = found
    for ro_row in (tech_board_payload or {}).get("repairOrders") or []:
        if not isinstance(ro_row, dict):
            continue
        ro = str(ro_row.get("repairOrderNumber") or "")
        found = _vehicle_dict(ro_row.get("vehicle")) or ({"vin": clean_vin(ro_row.get("vin"))} if clean_vin(ro_row.get("vin")) else {})
        if ro and found.get("vin") and ro not in result:
            result[ro] = found
    return result


def apply_vehicles(repair_orders: list[dict], found: dict[str, dict]) -> int:
    """Set vin/year/make/model on each job-board RO that has a known vehicle. Returns how many have a VIN."""
    count = 0
    for item in repair_orders:
        info = found.get(str(item.get("roNumber") or "")) or {}
        ymm = ymm_from_vehicle(item.get("vehicle") or "")
        for key in ("year", "make", "model"):
            value = info.get(key) or ymm.get(key)
            if value:
                item[key] = value
        if info.get("vin"):
            item["vin"] = info["vin"]
            count += 1
    return count
