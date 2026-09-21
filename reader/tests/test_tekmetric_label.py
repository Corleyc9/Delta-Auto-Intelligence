from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config import JOB_BOARD_LABELS
from parsers.tekmetric_label import (
    DEFAULT_TEKMETRIC_VERIFY_LABEL,
    label_click_candidates,
    labels_match,
    repair_order_page_url,
    resolve_verify_label,
)


class TekmetricVerifyLabelTests(unittest.TestCase):
    def test_shop_job_board_uses_verified_send_estimate(self) -> None:
        self.assertIn("Verified/Send Estimate", JOB_BOARD_LABELS)
        self.assertEqual(DEFAULT_TEKMETRIC_VERIFY_LABEL, "Verified/Send Estimate")
        self.assertNotEqual(DEFAULT_TEKMETRIC_VERIFY_LABEL, "Verify")

    def test_devin_wording_matches_shop_chip(self) -> None:
        self.assertTrue(labels_match("verified/ send estimate", "Verified/Send Estimate"))
        self.assertTrue(labels_match("Verified / Send Estimate", DEFAULT_TEKMETRIC_VERIFY_LABEL))
        self.assertFalse(labels_match("Verify", DEFAULT_TEKMETRIC_VERIFY_LABEL))
        self.assertFalse(labels_match("Verify Parts&Labor", DEFAULT_TEKMETRIC_VERIFY_LABEL))

    def test_job_target_wins_over_env(self) -> None:
        self.assertEqual(
            resolve_verify_label("Needs Estimate", {"TEKMETRIC_VERIFY_LABEL": "Other"}),
            "Needs Estimate",
        )
        self.assertEqual(
            resolve_verify_label("", {"TEKMETRIC_VERIFY_LABEL": "Verified / Send Estimate"}),
            "Verified / Send Estimate",
        )
        self.assertEqual(resolve_verify_label("", {}), DEFAULT_TEKMETRIC_VERIFY_LABEL)

    def test_estimate_subpage_is_stripped(self) -> None:
        url = repair_order_page_url(
            "https://shop.tekmetric.com/admin/shop/4326/repair-orders/44521/estimate",
            "44521",
        )
        self.assertEqual(url, "https://shop.tekmetric.com/admin/shop/4326/repair-orders/44521")
        self.assertEqual(
            repair_order_page_url("", "44521"),
            "https://shop.tekmetric.com/admin/shop/4326/repair-orders/44521",
        )

    def test_click_candidates_include_spacing_variants(self) -> None:
        candidates = label_click_candidates("Verified/Send Estimate")
        self.assertEqual(candidates[0], "Verified/Send Estimate")
        self.assertIn("Verified / Send Estimate", candidates)


if __name__ == "__main__":
    unittest.main()
