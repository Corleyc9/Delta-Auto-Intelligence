"""Parse Tekmetric's Tech Board data (GET /api/shop/<id>/tech-board, loaded by the /tech-board page).

Read-only. The payload has `repairOrders` (WIP ROs) and `technicianBoards` (one lane per tech plus
id 0 "Unassigned"); each lane has roCards with jobs {id, name, laborTime, completed, loggedTime, laborData[]}.
A job in the Unassigned lane has no tech — exactly Tekmetric's "No Tech Assigned / Unassigned Jobs".
"""
from __future__ import annotations

import re


def _initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", str(name or "").strip()) if p]
    return (parts[0][0] + parts[-1][0]).upper() if len(parts) >= 2 else ""


def parse_tech_board(payload: dict) -> dict[str, list[dict]]:
    """RO number -> jobs [{jobId, name, technician, techInitials, hours, order, completed, loggedSeconds}]."""
    ros = {r.get("id"): r for r in (payload or {}).get("repairOrders") or [] if isinstance(r, dict)}
    jobs: dict[str, dict[str, dict]] = {}
    for lane in (payload or {}).get("technicianBoards") or []:
        unassigned = not lane.get("id")
        lane_name = None if unassigned else str(lane.get("fullName") or "").strip() or None
        for card in lane.get("roCards") or []:
            ro = ros.get(card.get("repairOrderId")) or {}
            number = str(ro.get("repairOrderNumber") or "")
            if not number:
                continue
            for job in card.get("jobs") or []:
                job_id = str(job.get("id") or "")
                if not job_id:
                    continue
                labor_tech = next((row.get("technicianFullName") for row in job.get("laborData") or [] if row.get("technicianFullName")), None)
                tech = lane_name or labor_tech
                entry = jobs.setdefault(number, {}).get(job_id)
                if entry and entry["technician"]:
                    continue  # already placed in a tech lane
                logged = job.get("loggedTime")
                jobs[number][job_id] = {
                    "jobId": job_id,
                    "name": str(job.get("name") or "")[:80],
                    "technician": None if unassigned else tech,
                    "techInitials": None if unassigned else (_initials(tech or "") or None),
                    "hours": float(job.get("laborTime") or 0),
                    "completed": bool(job.get("completed")),
                    "loggedSeconds": int(logged) if isinstance(logged, (int, float)) else None,
                    # Tekmetric's Tech Board lists approved (authorized) jobs only.
                    "authorized": True,
                }
    result: dict[str, list[dict]] = {}
    for number, by_id in jobs.items():
        ordered = sorted(by_id.values(), key=lambda job: int(job["jobId"]) if job["jobId"].isdigit() else 0)
        for index, job in enumerate(ordered, 1):
            job["order"] = index
        result[number] = ordered
    return result


def unassigned_summary(payload: dict) -> dict:
    """Counts for Tekmetric's Unassigned lane (cards, open jobs, open hours)."""
    lane = next((lane for lane in (payload or {}).get("technicianBoards") or [] if not lane.get("id")), None) or {}
    cards = lane.get("roCards") or []
    open_jobs = [job for card in cards for job in card.get("jobs") or [] if not job.get("completed")]
    return {"repairOrders": len(cards), "jobs": len(open_jobs), "hours": round(sum(float(card.get("incompleteLaborTime") or 0) for card in cards), 2)}
