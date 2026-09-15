from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from parsers.job_board import parse_job_card
from parsers.steer import classify_customer, parse_steer_row


FIXTURES = Path(__file__).resolve().parent / "fixtures"


def fixture_text(name: str) -> str:
    raw = (FIXTURES / name).read_text(encoding="utf-8")
    lines = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("<!--") or stripped.startswith("<"):
            continue
        lines.append(stripped)
    return "\n".join(lines)


class JobBoardParserTests(unittest.TestCase):
    def test_parses_hours_with_unit(self) -> None:
        parsed = parse_job_card({
            "text": fixture_text("job-board-hrs.html"),
            "section": "work-in-progress",
            "href": "https://shop.tekmetric.com/admin/shop/4326/repair-orders/44521",
        })
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed["roNumber"], "44521")
        self.assertEqual(parsed["label"], "Needs Diag.")
        self.assertEqual(parsed["customer"], "Alex Rivera")
        self.assertEqual(parsed["vehicle"], "2019 Chevrolet Silverado")
        self.assertEqual(parsed["soldHours"], 2.0)
        self.assertEqual(parsed["serviceWriterInitials"], "AW")
        self.assertEqual(parsed["section"], "work-in-progress")

    def test_parses_unit_free_hours(self) -> None:
        parsed = parse_job_card({
            "text": fixture_text("job-board-unitfree.html"),
            "section": "work-in-progress",
            "href": "https://shop.tekmetric.com/admin/shop/4326/repair-orders/44522",
        })
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed["roNumber"], "44522")
        self.assertEqual(parsed["soldHours"], 2.0)
        self.assertEqual(parsed["label"], "In-Progress")
        self.assertEqual(parsed["serviceWriterInitials"], "KW")


class SteerParserTests(unittest.TestCase):
    def test_parses_business_row(self) -> None:
        parsed = parse_steer_row(fixture_text("steer-row.html"))
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed["customer"], "Canton Logistics LLC")
        self.assertEqual(parsed["vehicle"], "2018 Ford Transit")
        self.assertEqual(parsed["phone"], "(601) 555-0177")
        self.assertEqual(parsed["customerType"], "business")
        self.assertGreaterEqual(parsed["heat"], 2)
        self.assertTrue(any("Svc Due" in signal for signal in parsed["signals"]))

    def test_personal_names_stay_personal(self) -> None:
        self.assertEqual(classify_customer("Alex Rivera"), "personal")


if __name__ == "__main__":
    unittest.main()
