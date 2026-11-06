"""Parse the jobs on a Tekmetric RO's Work-In-Progress tab (/repair-orders/<id>/repairs).

Read-only. Built from real samples (reader/tests/fixtures/ro-wip-jobs-*.txt). Per job, Tekmetric shows:
  <job name>
  (<labor hours> Hours)
  <technician name>            (job-level assignee; absent when unassigned)
  hh:mm:ss                     (tech clock / logged time on the job)
  Completed | Mark Completed   ("Completed" = done; "Mark Completed" = not done)
followed by Labor/Technician rows, parts and comments. The page footer shows "<worked>/<sold> Hours", "<n>%".
"""
from __future__ import annotations

import re

HOURS_RE = re.compile(r"^\((\d+(?:\.\d+)?)\s*Hours?\)$", re.I)
CLOCK_RE = re.compile(r"^(\d{1,3}):(\d{2}):(\d{2})$")
SKIP = {"add comment", "no comments", "jobs", ""}


def _initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", name.strip()) if p]
    return (parts[0][0] + parts[-1][0]).upper() if len(parts) >= 2 else ""


def parse_ro_jobs(text: str) -> list[dict]:
    lines = [line.strip() for line in str(text or "").splitlines()]
    jobs: list[dict] = []
    for index, line in enumerate(lines):
        match = HOURS_RE.match(line)
        if not match:
            continue
        # Job name: nearest meaningful line above the "(N Hours)" line.
        name = ""
        for back in range(index - 1, max(-1, index - 6), -1):
            if lines[back].lower() not in SKIP:
                name = lines[back]
                break
        tech, logged, completed, status_seen = "", None, False, False
        for ahead in lines[index + 1:index + 12]:
            if not ahead:
                continue
            clock = CLOCK_RE.match(ahead)
            if clock:
                h, m, s = (int(x) for x in clock.groups())
                logged = h * 3600 + m * 60 + s
                continue
            lower = ahead.lower()
            if lower in ("completed", "mark completed"):
                completed = lower == "completed"
                status_seen = True
                break
            if lower.startswith("labor") or HOURS_RE.match(ahead):
                break
            if not tech and logged is None and not re.search(r"\d", ahead) and len(ahead) <= 60:
                tech = ahead
        if not name:
            continue
        jobs.append({
            "jobId": str(len(jobs) + 1),
            "name": name[:80],
            "technician": tech or None,
            "techInitials": _initials(tech) or None,
            "hours": float(match.group(1)),
            "order": len(jobs) + 1,
            "completed": completed if status_seen else False,
            "loggedSeconds": logged,
        })
    return jobs


def parse_ro_progress(text: str) -> dict | None:
    """RO footer: '6.68/9.32 Hours' then '72%'."""
    match = re.search(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*Hours\s*\n\s*(\d{1,3})%", str(text or ""), re.I)
    if not match:
        return None
    return {"workedHours": float(match.group(1)), "soldHours": float(match.group(2)), "percent": int(match.group(3))}


def repairs_url(detail_url: str) -> str:
    """Work-In-Progress tab URL for an RO detail link."""
    base = re.sub(r"[?#].*$", "", str(detail_url or "")).rstrip("/")
    match = re.match(r"^(https://shop\.tekmetric\.com/admin/shop/\d+/repair-orders/\d+)", base)
    return f"{match.group(1)}/repairs" if match else ""
