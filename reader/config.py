from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(os.environ.get("LOCALAPPDATA", ".")) / "DeltaAutoReader"
CONFIG_PATH = ROOT / "reader-config.json"
PROFILE_PATH = ROOT / "browser-profile"
LOG_PATH = ROOT / "reader.log"
ROSTER_PATH = ROOT / "technician-roster.json"
HISTORY_PROGRESS_PATH = ROOT / "vehicle-history-progress.json"
SHOP_REPORT_URL = "https://shop.tekmetric.com/admin/shop/4326/reports"
JOB_BOARD_URL = (
    "https://shop.tekmetric.com/admin/shop/4326/repair-orders"
    "?view=column&board=ACTIVE&page=0"
)
SCHEDULE_URL = "https://shop.tekmetric.com/admin/shop/4326/appointments"
STEER_HOT_LIST_URL = (
    "https://app.steercrm.com/tenant/ae9659c1-a1c8-4825-b9b1-5835f669fd05/"
    "shop/8c71b3aa-71b6-4f91-972f-73c206abad54/opportunity-hub/"
    "today's-hot-list?pageSize=100&page=1"
)
DEFAULT_TECHNICIANS = [
    "Mario Butler",
    "MIKE COOK",
    "Beau Corley",
    "Stacy Williams",
]
CENTRAL_TIME = ZoneInfo("America/Chicago")
SERVICE_WRITERS = {
    "AW": "Andrea Wilson",
    "DC": "Devin Corley",
    "KW": "Kody Whobrey",
    "PH": "Pat Hall",
    "SP": "Shop Parts",
}
SERVICE_WRITER_PRIORITY = ("AW", "KW", "PH", "SP", "DC")
JOB_BOARD_LABELS = (
    "Not Started", "Check-In Needed", "Check-In Complete", "Verify", "Verify Parts&Labor",
    "Requires Authorization", "Pending Authorization", "Declined All",
    "Waiting for Arrival", "Needs Estimate", "72HRS+", "Estimate Only",
    "Waiting for Parts", "Manager Assist/Approve", "Need Key (DeltaTowing)",
    "BIG DADDY (New)", "Attn. Service Writer", "No Show", "Work Not Started",
    "Waiting/Cust. or Unit", "Needs Diag.", "Verify Parts/Labor",
    "Waiting 4 approval", "Need to Order Parts", "Waiting on Parts", "Part Arrived",
    "Scheduled", "In-Progress", "Attn Technician", "Attn Service Writer",
    "Verified/Send Estimate", "Waiting on Sublet", "Tech Finished", "BIG DADDY",
    "Ext.Warranty/3rdParty", "Needs Check-In", "Mgr Assist or Approve",
    "Need Mileage /Insp", "Balance Due", "Credit Due", "Customer Contacted",
    "Ready to Post", "Waiting for PO#", "Payment Link Sent",
    "Needs Ext Warr Payment", "Need Warranty Pmt", "Need Warranty Payment", "Abandonment Process",
    "Documentation", "Start Labor Lien", "Send for Payment",
    "Mgr. Assist or Approve", "DO NOT TOUCH - SEE PAT", "Warranty Claim Done",
)


@dataclass
class Config:
    dashboard_url: str
    reader_api_key: str
    sites_machine_token: str
    sync_minutes: int = 1


def save_config(config: Config) -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")
