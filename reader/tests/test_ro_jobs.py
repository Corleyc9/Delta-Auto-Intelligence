from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from parsers.ro_jobs import parse_ro_jobs, parse_ro_progress, repairs_url  # noqa: E402

FIX = ROOT / "tests" / "fixtures"


def load(n: int) -> str:
    return (FIX / f"ro-wip-jobs-{n}.txt").read_text(encoding="utf-8")


class RoJobsTest(unittest.TestCase):
    def test_multi_tech_ro_all_completed(self):
        jobs = parse_ro_jobs(load(1))
        self.assertEqual(len(jobs), 8)
        first = jobs[0]
        self.assertEqual(first["name"], "Diagnostic Test/ SES LIGHT COMING ON")
        self.assertEqual(first["technician"], "Beau Corley")
        self.assertEqual(first["techInitials"], "BC")
        self.assertEqual(first["hours"], 1.0)
        self.assertEqual(first["order"], 1)
        self.assertTrue(first["completed"])
        self.assertEqual(first["loggedSeconds"], 0)
        names = {job["technician"] for job in jobs}
        self.assertTrue({"Beau Corley", "MIKE COOK", "Mario Butler", "Stacy Williams"} <= names)
        head = next(job for job in jobs if job["name"].startswith("Remove & Replace Cylinder Head"))
        self.assertEqual(head["hours"], 11.16)
        self.assertEqual([job["order"] for job in jobs], list(range(1, 9)))

    def test_mixed_done_and_not_done(self):
        jobs = parse_ro_jobs(load(3))
        self.assertEqual(len(jobs), 4)
        self.assertEqual([job["completed"] for job in jobs], [True, True, False, False])
        self.assertTrue(jobs[2]["name"].startswith("REMOVE AND REPLACE ALTERNATOR"))
        self.assertEqual(jobs[2]["hours"], 2.88)
        self.assertEqual(jobs[3]["name"], "DOT Inspection")
        self.assertEqual(parse_ro_progress(load(3)), {"workedHours": 6.68, "soldHours": 9.32, "percent": 72})

    def test_second_sample_and_names_not_comment_buttons(self):
        jobs = parse_ro_jobs(load(2))
        self.assertEqual(len(jobs), 9)
        for job in jobs:
            self.assertNotIn(job["name"].lower(), {"add comment", "no comments"})
            self.assertTrue(job["technician"])

    def test_logged_time_and_unassigned(self):
        text = "Jobs\nBrake job\n \n(2.5 Hours)\n \n 01:30:15 \nMark Completed\nLabor\tTechnician\n"
        [job] = parse_ro_jobs(text)
        self.assertIsNone(job["technician"]); self.assertEqual(job["loggedSeconds"], 5415); self.assertFalse(job["completed"])

    def test_repairs_url(self):
        self.assertEqual(repairs_url("https://shop.tekmetric.com/admin/shop/4326/repair-orders/371672364?tab=1"),
                         "https://shop.tekmetric.com/admin/shop/4326/repair-orders/371672364/repairs")
        self.assertEqual(repairs_url("https://example.com/x"), "")


if __name__ == "__main__":
    unittest.main()
