import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from parsers.vehicle import apply_vehicles, clean_vin, vehicle_from_text, vehicles_from_payloads, vin_from_text  # noqa: E402
from parsers.appointments import parse_appointments  # noqa: E402

FIX = Path(__file__).parent / "fixtures"


class VehicleTests(unittest.TestCase):
    def test_ro_header_text(self):
        info = vehicle_from_text((FIX / "ro-header-vin.txt").read_text(encoding="utf-8"))
        self.assertEqual(info, {"vin": "1GTR1VE05CZ123456", "year": "2012", "make": "GMC", "model": "Sierra 1500 SLE"})

    def test_vin_rules(self):
        self.assertEqual(clean_vin("1gtr1ve05cz123456"), "1GTR1VE05CZ123456")
        self.assertEqual(clean_vin("1GTR1VE05CZ12345O"), "")  # O not allowed
        self.assertEqual(clean_vin("12345678901234567"), "")  # digits only (phone/part numbers)
        self.assertEqual(vin_from_text("Part 12345678901234567\nVIN: 2FTRX18W1XCA01234"), "2FTRX18W1XCA01234")
        self.assertEqual(vin_from_text("no vin here"), "")

    def test_payloads(self):
        appts = [{"id": 1, "startTime": "a", "endTime": "b", "repairOrder": {"repairOrderNumber": 38307},
                  "vehicle": {"vin": "1gtr1ve05cz123456", "year": 2012, "make": "GMC", "model": "Sierra 1500"}},
                 {"id": 2, "repairOrder": {"repairOrderNumber": 38308}, "vehicle": {"vin": ""}}]
        board = json.loads((FIX / "tech-board.json").read_text(encoding="utf-8"))
        board["repairOrders"].append({"id": 9, "repairOrderNumber": 38400, "vehicle": {"vin": "2FTRX18W1XCA01234", "year": 1999, "make": "Ford", "model": "F-150"}})
        found = vehicles_from_payloads(appts, board)
        self.assertEqual(found["38307"]["vin"], "1GTR1VE05CZ123456")
        self.assertEqual(found["38400"]["make"], "Ford")
        self.assertNotIn("38308", found)
        ros = [{"roNumber": "38307", "vehicle": "2012 GMC Sierra 1500"}, {"roNumber": "38999", "vehicle": "2015 Honda Accord"}]
        self.assertEqual(apply_vehicles(ros, found), 1)
        self.assertEqual(ros[0]["vin"], "1GTR1VE05CZ123456")
        self.assertNotIn("vin", ros[1]); self.assertEqual(ros[1]["make"], "Honda")

    def test_appointments_keep_vehicle(self):
        [row] = parse_appointments([{"id": 1, "startTime": "a", "endTime": "b", "repairOrder": {"repairOrderNumber": 38307},
                                     "vehicle": {"vin": "1GTR1VE05CZ123456", "year": 2012, "make": "GMC", "model": "Sierra"}}])
        self.assertEqual(row["vin"], "1GTR1VE05CZ123456")


if __name__ == "__main__":
    unittest.main()
