from __future__ import annotations

import sys
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from config import (
    DEFAULT_FULL_REPORT_MINUTES,
    DEFAULT_SYNC_MINUTES,
    DEFAULT_VEHICLE_HISTORY_MODE,
    DEFAULT_WIP_AUDIT_MINUTES,
    OVERNIGHT_END_HOUR,
    OVERNIGHT_START_HOUR,
    Config,
    config_from_dict,
    normalize_vehicle_history_mode,
    upgrade_loaded_config,
    vehicle_history_allowed,
)


class CadenceDefaultTests(unittest.TestCase):
    def test_defaults_are_materially_slower(self) -> None:
        self.assertGreaterEqual(DEFAULT_SYNC_MINUTES, 5)
        self.assertLessEqual(DEFAULT_SYNC_MINUTES, 10)
        self.assertGreater(DEFAULT_FULL_REPORT_MINUTES, 5)
        self.assertGreater(DEFAULT_WIP_AUDIT_MINUTES, 20)
        self.assertEqual(DEFAULT_VEHICLE_HISTORY_MODE, "overnight")
        self.assertEqual(OVERNIGHT_START_HOUR, 22)
        self.assertEqual(OVERNIGHT_END_HOUR, 6)

    def test_legacy_one_minute_config_is_upgraded(self) -> None:
        upgraded = upgrade_loaded_config({
            "dashboard_url": "https://example.test",
            "reader_api_key": "key",
            "sites_machine_token": "token",
            "sync_minutes": 1,
        })
        self.assertEqual(upgraded["sync_minutes"], DEFAULT_SYNC_MINUTES)
        self.assertEqual(upgraded["full_report_minutes"], DEFAULT_FULL_REPORT_MINUTES)
        self.assertEqual(upgraded["wip_audit_minutes"], DEFAULT_WIP_AUDIT_MINUTES)
        self.assertEqual(upgraded["vehicle_history_mode"], "overnight")

    def test_custom_slower_sync_is_kept(self) -> None:
        upgraded = upgrade_loaded_config({
            "dashboard_url": "https://example.test",
            "reader_api_key": "key",
            "sites_machine_token": "token",
            "sync_minutes": 12,
            "full_report_minutes": 30,
            "vehicle_history_mode": "off",
        })
        self.assertEqual(upgraded["sync_minutes"], 12)
        self.assertEqual(upgraded["full_report_minutes"], 30)
        self.assertEqual(upgraded["vehicle_history_mode"], "off")

    def test_config_from_dict_fills_dataclass(self) -> None:
        config = config_from_dict({
            "dashboard_url": "https://example.test",
            "reader_api_key": "key",
            "sites_machine_token": "token",
        })
        self.assertIsInstance(config, Config)
        self.assertEqual(config.sync_minutes, DEFAULT_SYNC_MINUTES)
        self.assertEqual(config.vehicle_history_mode, "overnight")


class VehicleHistoryWindowTests(unittest.TestCase):
    def test_mode_aliases(self) -> None:
        self.assertEqual(normalize_vehicle_history_mode("paused"), "off")
        self.assertEqual(normalize_vehicle_history_mode("always"), "always")
        self.assertEqual(normalize_vehicle_history_mode(None), "overnight")

    def test_off_never_runs(self) -> None:
        night = datetime(2026, 9, 16, 23, 0, tzinfo=__import__("config").CENTRAL_TIME)
        self.assertFalse(vehicle_history_allowed("off", night))

    def test_always_runs_in_daytime(self) -> None:
        afternoon = datetime(2026, 9, 16, 14, 0, tzinfo=__import__("config").CENTRAL_TIME)
        self.assertTrue(vehicle_history_allowed("always", afternoon))

    def test_overnight_window(self) -> None:
        from config import CENTRAL_TIME
        self.assertFalse(vehicle_history_allowed("overnight", datetime(2026, 9, 16, 14, 0, tzinfo=CENTRAL_TIME)))
        self.assertTrue(vehicle_history_allowed("overnight", datetime(2026, 9, 16, 22, 0, tzinfo=CENTRAL_TIME)))
        self.assertTrue(vehicle_history_allowed("overnight", datetime(2026, 9, 16, 5, 59, tzinfo=CENTRAL_TIME)))
        self.assertFalse(vehicle_history_allowed("overnight", datetime(2026, 9, 16, 6, 0, tzinfo=CENTRAL_TIME)))


if __name__ == "__main__":
    unittest.main()
