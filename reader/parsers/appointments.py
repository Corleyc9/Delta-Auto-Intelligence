"""Parse Tekmetric's schedule (GET /api/shop/<id>/appointments/day-view, loaded by Appointments → Day - Employee).

Read-only. Each appointment has id, startTime/endTime (UTC ISO), resourceId (employee id, "-1" = Unassigned),
assignedEmployees[{id, fullName}], repairOrder{repairOrderNumber} and updatedDate.
"""
from __future__ import annotations


def _text(value) -> str:
    return " ".join(str(value).split()) if value not in (None, "", [], {}) else ""


def appointment_details(item: dict) -> dict:
    """Label → text for the appointment popup fields (vehicle, concern, notes, drop-off, phone, …). Empty fields are left out."""
    customer = item.get("customer") or {}
    vehicle = item.get("vehicle") or {}
    phones = [p for p in (customer.get("phone") or []) if isinstance(p, dict) and p.get("number")]
    phone = next((p for p in phones if p.get("primary")), phones[0] if phones else None)
    car = _text(vehicle.get("description")) or _text(" ".join(str(vehicle.get(k) or "") for k in ("year", "make", "model", "subModel")))
    def at(value):
        return str(value or "")
    fields = {
        "Title": _text(item.get("title")),
        "Concern / notes": _text(item.get("description")),
        "Vehicle": car,
        "Plate": _text(" ".join(x for x in [str(vehicle.get("licensePlate") or ""), str(vehicle.get("state") or "")] if x)),
        "VIN": _text(vehicle.get("vin")),
        "Vehicle notes": _text(vehicle.get("notes")),
        "Customer": _text(customer.get("fullName")) or _text(f"{customer.get('firstName') or ''} {customer.get('lastName') or ''}"),
        "Phone": _text((phone or {}).get("number")),
        "Customer notes": _text(customer.get("notes")),
        "Appointment type": _text((item.get("appointmentOption") or {}).get("name")),
        "Ride": _text((item.get("rideOption") or {}).get("name")) if _text((item.get("rideOption") or {}).get("code")) not in ("", "NONE") else "",
        "Drop-off": at(item.get("dropoffTime")),
        "Pick-up": at(item.get("pickupTime")),
        "Confirmation": _text(item.get("confirmationStatus")) if _text(item.get("confirmationStatus")) not in ("", "NONE") else "",
        "Booked by": _text((item.get("createdUser") or {}).get("fullName")),
        "Lead source": _text(item.get("leadSource") if not isinstance(item.get("leadSource"), dict) else (item.get("leadSource") or {}).get("name")),
    }
    return {k: v[:500] for k, v in fields.items() if v}


def parse_appointments(payload) -> list[dict]:
    items = payload if isinstance(payload, list) else (payload or {}).get("content") or []
    result: list[dict] = []
    for item in items:
        if not isinstance(item, dict) or not item.get("startTime") or not item.get("endTime"):
            continue
        ro = ((item.get("repairOrder") or {}).get("repairOrderNumber"))
        employees = [e for e in (item.get("assignedEmployees") or []) if isinstance(e, dict)]
        resource = str(item.get("resourceId") or "")
        employee = next((e for e in employees if str(e.get("id")) == resource), employees[0] if employees else None)
        unassigned = resource in ("", "-1", "0") and not employee
        result.append({
            "id": str(item.get("id") or ""),
            "roNumber": str(ro) if ro else "",
            "employeeId": None if unassigned else str((employee or {}).get("id") or resource),
            "employeeName": None if unassigned else str((employee or {}).get("fullName") or "").strip(),
            "start": str(item["startTime"]),
            "end": str(item["endTime"]),
            "updated": str(item.get("updatedDate") or ""),
            # 2.1.1: Tekmetric card color (yellow #FCB70D = customer coming at that time), customer and title for no-RO cards.
            "color": str(item.get("color") or ""),
            "customer": " ".join(str(part).strip() for part in [((item.get("customer") or {}).get("firstName") or ""), ((item.get("customer") or {}).get("lastName") or "")] if str(part).strip()),
            "title": str(item.get("title") or "").strip()[:120],
            "description": str(item.get("description") or "").strip()[:1000],
            # 2.1.2: everything Tekmetric shows on the appointment card/popup, as label → text (read-only copy).
            "details": appointment_details(item),
            # 2.1.3: VIN for job-board RO matching (Bay Scan).
            "vin": "".join(ch for ch in str((item.get("vehicle") or {}).get("vin") or "") if ch.isalnum()).upper()[:17],
        })
    return result
