from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config import JOB_BOARD_LABELS, JOB_BOARD_URL
from parsers.tekmetric_label import (
    DEFAULT_TEKMETRIC_VERIFY_LABEL,
    is_repair_order_detail_url,
    is_tekmetric_signin_url,
    label_click_candidates,
    labels_match,
    repair_order_page_url,
    resolve_verify_label,
)


class TekmetricVerifyLabelTests(unittest.TestCase):
    def test_shop_job_board_uses_verified_send_estimate(self) -> None:
        self.assertIn("Verified/Send Estimate", JOB_BOARD_LABELS)
        self.assertEqual(DEFAULT_TEKMETRIC_VERIFY_LABEL, "Verified/Send Estimate")
        self.assertNotIn(" / ", DEFAULT_TEKMETRIC_VERIFY_LABEL)
        self.assertNotEqual(DEFAULT_TEKMETRIC_VERIFY_LABEL, "Verify")
        self.assertIn("board=ACTIVE", JOB_BOARD_URL)
        self.assertIn("view=column", JOB_BOARD_URL)
        self.assertIn("/admin/shop/4326/repair-orders", JOB_BOARD_URL)

    def test_devin_wording_matches_shop_chip(self) -> None:
        self.assertTrue(labels_match("verified/ send estimate", "Verified/Send Estimate"))
        self.assertTrue(labels_match("Verified / Send Estimate", DEFAULT_TEKMETRIC_VERIFY_LABEL))
        self.assertFalse(labels_match("Verify", DEFAULT_TEKMETRIC_VERIFY_LABEL))
        self.assertFalse(labels_match("Verify Parts&Labor", DEFAULT_TEKMETRIC_VERIFY_LABEL))
        self.assertFalse(labels_match("In-Progress", DEFAULT_TEKMETRIC_VERIFY_LABEL))

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

    def test_keeps_internal_repair_order_id_and_does_not_invent_from_ro_number(self) -> None:
        url = repair_order_page_url(
            "https://shop.tekmetric.com/admin/shop/4326/repair-orders/366529871/estimate",
            "4412",
        )
        self.assertEqual(
            url,
            "https://shop.tekmetric.com/admin/shop/4326/repair-orders/366529871",
        )
        self.assertEqual(repair_order_page_url("", "4412"), "")
        self.assertTrue(
            is_repair_order_detail_url(
                "https://shop.tekmetric.com/admin/shop/4326/repair-orders/366529871"
            )
        )
        self.assertFalse(
            is_repair_order_detail_url(
                "https://shop.tekmetric.com/admin/shop/4326/repair-orders?view=column&board=ACTIVE"
            )
        )

    def test_session_expired_signin_urls(self) -> None:
        self.assertTrue(is_tekmetric_signin_url("https://shop.tekmetric.com/login"))
        self.assertTrue(is_tekmetric_signin_url("https://shop.tekmetric.com/signin"))
        self.assertFalse(
            is_tekmetric_signin_url(
                "https://shop.tekmetric.com/admin/shop/4326/repair-orders/366529871"
            )
        )
        self.assertFalse(
            is_tekmetric_signin_url(
                "https://shop.tekmetric.com/admin/shop/4326/repair-orders?view=column&board=ACTIVE&page=0"
            )
        )

    def test_click_candidates_prefer_exact_slash_no_spaces(self) -> None:
        candidates = label_click_candidates("Verified/Send Estimate")
        self.assertEqual(candidates[0], "Verified/Send Estimate")
        self.assertIn("Verified / Send Estimate", candidates)


if __name__ == "__main__":
    unittest.main()
