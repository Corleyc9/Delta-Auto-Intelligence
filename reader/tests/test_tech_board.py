from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from parsers.tech_board import parse_tech_board, unassigned_summary  # noqa: E402

PAYLOAD = json.loads((ROOT / "tests" / "fixtures" / "tech-board.json").read_text(encoding="utf-8"))


class TechBoardTest(unittest.TestCase):
    def test_unassigned_lane_matches_tekmetric(self):
        self.assertEqual(unassigned_summary(PAYLOAD), {"repairOrders": 6, "jobs": 9, "hours": 16.38})
        jobs = parse_tech_board(PAYLOAD)
        self.assertEqual(len(jobs["38362"]), 4)
        self.assertTrue(all(job["technician"] is None and job["techInitials"] is None for job in jobs["38362"]))
        self.assertEqual([job["order"] for job in jobs["38362"]], [1, 2, 3, 4])

    def test_partly_unassigned_ro_keeps_assigned_job(self):
        jobs = {job["name"]: job for job in parse_tech_board(PAYLOAD)["38570"]}
        self.assertIsNone(jobs["Remove & Replace Automatic Transmission Shift Cable"]["technician"])

    def test_tech_lanes(self):
        jobs = parse_tech_board(PAYLOAD)
        techs = {job["technician"] for ro in jobs.values() for job in ro if job["technician"]}
        self.assertIn("Stacy Williams", techs)
        any_job = next(job for ro in jobs.values() for job in ro if job["technician"] == "Stacy Williams")
        self.assertEqual(any_job["techInitials"], "SW")
        self.assertIsInstance(any_job["completed"], bool)


if __name__ == "__main__":
    unittest.main()


class ApprovedFlagTest(unittest.TestCase):
    def test_tech_board_jobs_are_approved(self):
        jobs = [job for ro in parse_tech_board(PAYLOAD).values() for job in ro]
        self.assertTrue(jobs and all(job["authorized"] is True for job in jobs))
