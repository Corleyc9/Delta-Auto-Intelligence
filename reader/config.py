from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, fields
from datetime import datetime
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
# Shop-PC cadence. Old installs saved sync_minutes=1 but the loop ignored it
# and still woke about every 60 seconds. New defaults are used unless the
# JSON already has a slower custom value.
DEFAULT_SYNC_MINUTES = 8
DEFAULT_FULL_REPORT_MINUTES = 20
DEFAULT_WIP_AUDIT_MINUTES = 60
DEFAULT_VEHICLE_HISTORY_MODE = "overnight"
VEHICLE_HISTORY_BATCH_MINUTES = 20
OVERNIGHT_START_HOUR = 22  # 10:00 PM America/Chicago
OVERNIGHT_END_HOUR = 6  # 6:00 AM America/Chicago
LEGACY_FAST_SYNC_MINUTES = 1
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
    sync_minutes: int = DEFAULT_SYNC_MINUTES
    full_report_minutes: int = DEFAULT_FULL_REPORT_MINUTES
    wip_audit_minutes: int = DEFAULT_WIP_AUDIT_MINUTES
    vehicle_history_mode: str = DEFAULT_VEHICLE_HISTORY_MODE


def save_config(config: Config) -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")


def normalize_vehicle_history_mode(value: str | None) -> str:
    mode = str(value or DEFAULT_VEHICLE_HISTORY_MODE).strip().lower()
    if mode in {"off", "paused", "disabled", "false", "0", "no"}:
        return "off"
    if mode in {"always", "on", "daytime", "true", "1"}:
        return "always"
    return "overnight"


def vehicle_history_allowed(mode: str, now: datetime | None = None) -> bool:
    """Vehicle-history crawl: off, overnight Central, or always."""
    normalized = normalize_vehicle_history_mode(mode)
    if normalized == "off":
        return False
    if normalized == "always":
        return True
    current = now or datetime.now(CENTRAL_TIME)
    if current.tzinfo is None:
        current = current.replace(tzinfo=CENTRAL_TIME)
    else:
        current = current.astimezone(CENTRAL_TIME)
    hour = current.hour
    return hour >= OVERNIGHT_START_HOUR or hour < OVERNIGHT_END_HOUR


def upgrade_loaded_config(raw: dict) -> dict:
    data = dict(raw)
    try:
        sync = int(data.get("sync_minutes", DEFAULT_SYNC_MINUTES))
    except (TypeError, ValueError):
        sync = DEFAULT_SYNC_MINUTES
    if sync <= LEGACY_FAST_SYNC_MINUTES:
        sync = DEFAULT_SYNC_MINUTES
    data["sync_minutes"] = max(1, sync)
    for key, default in (
        ("full_report_minutes", DEFAULT_FULL_REPORT_MINUTES),
        ("wip_audit_minutes", DEFAULT_WIP_AUDIT_MINUTES),
    ):
        try:
            minutes = int(data.get(key, default))
        except (TypeError, ValueError):
            minutes = default
        data[key] = max(1, minutes)
    data["vehicle_history_mode"] = normalize_vehicle_history_mode(
        data.get("vehicle_history_mode")
    )
    return data


def config_from_dict(raw: dict) -> Config:
    upgraded = upgrade_loaded_config(raw)
    allowed = {item.name for item in fields(Config)}
    return Config(**{key: upgraded[key] for key in allowed if key in upgraded})
