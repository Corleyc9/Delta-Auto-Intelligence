from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from parsers.appointments import parse_appointments  # noqa: E402


class AppointmentsTest(unittest.TestCase):
    def test_assigned_and_unassigned(self):
        rows = parse_appointments([
            {"id": 1, "startTime": "2026-11-03T13:00:00Z", "endTime": "2026-11-03T13:30:00Z", "resourceId": "72853",
             "assignedEmployees": [{"id": 72853, "fullName": "MIKE COOK"}], "repairOrder": {"repairOrderNumber": 37513}, "updatedDate": "u"},
            {"id": 2, "startTime": "2026-11-03T12:00:00Z", "endTime": "2026-11-03T13:00:00Z", "resourceId": "-1",
             "assignedEmployees": [], "repairOrder": {"repairOrderNumber": 38530}},
            {"id": 3, "startTime": None, "endTime": None},
        ])
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["roNumber"], "37513")
        self.assertEqual(rows[0]["employeeName"], "MIKE COOK")
        self.assertIsNone(rows[1]["employeeId"])




class AppointmentColorTest(unittest.TestCase):
    def test_color_customer_title_captured(self):
        rows = parse_appointments([{"id": 5, "startTime": "2026-11-04T14:00:00Z", "endTime": "2026-11-04T14:45:00Z", "color": "#FCB70D",
                                    "customer": {"firstName": "Tim", "lastName": "Lindsay"}, "title": "", "description": "oil change",
                                    "assignedEmployees": [{"id": 9, "fullName": "Mario Butler"}], "resourceId": 9}])
        self.assertEqual(rows[0]["color"], "#FCB70D")
        self.assertEqual(rows[0]["customer"], "Tim Lindsay")
        self.assertEqual(rows[0]["roNumber"], "")
        self.assertEqual(rows[0]["description"], "oil change")


class AppointmentDetailsTest(unittest.TestCase):
    def test_popup_fields_captured(self):
        rows = parse_appointments([{"id": 1, "startTime": "2026-11-04T14:00:00Z", "endTime": "2026-11-04T14:45:00Z", "color": "#FCB70D",
            "description": "oil change and check brakes", "appointmentOption": {"name": "Drop-off Vehicle"}, "rideOption": {"code": "NONE", "name": "None"},
            "dropoffTime": "2026-11-04T14:00:00Z", "createdUser": {"fullName": "Devin Corley"},
            "customer": {"firstName": "Tim", "lastName": "Lindsay", "fullName": "Tim Lindsay", "phone": [{"number": "6015550100", "primary": True}]},
            "vehicle": {"description": "1998 GMC C1500 Sierra SL"}}])
        d = rows[0]["details"]
        self.assertEqual(d["Concern / notes"], "oil change and check brakes")
        self.assertEqual(d["Vehicle"], "1998 GMC C1500 Sierra SL")
        self.assertEqual(d["Phone"], "6015550100")
        self.assertEqual(d["Appointment type"], "Drop-off Vehicle")
        self.assertNotIn("Ride", d)


if __name__ == "__main__":
    unittest.main()
