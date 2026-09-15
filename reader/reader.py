from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from requests.adapters import HTTPAdapter
from playwright.sync_api import Page, sync_playwright
from urllib3.util.retry import Retry

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
HTTP = requests.Session()
HTTP.mount("https://", HTTPAdapter(max_retries=Retry(
    total=3,
    connect=3,
    read=3,
    status=3,
    backoff_factor=1,
    status_forcelist=(429, 500, 502, 503, 504),
    allowed_methods=frozenset({"GET", "POST"}),
    raise_on_status=False,
)))
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


def log(message: str) -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    line = f"{datetime.now().isoformat(timespec='seconds')}  {message}"
    print(line, flush=True)
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


class NeedsSignInError(RuntimeError):
    """Raised when a site's session has expired and a human must sign back
    in on the shop computer. This must never be handled by blocking on
    input() — nobody but the person physically at that computer can see a
    terminal prompt, so a blocking wait just freezes every sync (Tekmetric,
    Steer, job board, ticket audits) indefinitely with no visibility for
    anyone checking the dashboard remotely. Instead we leave the browser
    window sitting on the real login page (visible to anyone who walks by
    the shop computer), report the situation to the dashboard so it shows
    up as a banner, and let the sync loop retry on its normal interval —
    the very next cycle succeeds automatically once someone signs in.
    """

    def __init__(self, site: str, detail: str = ""):
        self.site = site
        self.detail = detail or f"{site} needs sign-in on the shop computer."
        super().__init__(self.detail)


def configure() -> Config:
    print("\nThe two keys are created for this computer only.")
    dashboard = input("Dashboard URL: ").strip().rstrip("/")
    reader_key = input("Reader key: ").strip()
    sites_token = input("Machine access token: ").strip()
    config = Config(dashboard, reader_key, sites_token)
    ROOT.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")
    print(f"\nConfiguration saved to {CONFIG_PATH}")
    return config


def load_config() -> Config:
    if not CONFIG_PATH.exists():
        return configure()
    return Config(**json.loads(CONFIG_PATH.read_text(encoding="utf-8")))


def currency(value: str) -> float:
    cleaned = re.sub(r"[^0-9.\-]", "", value or "")
    return float(cleaned or 0)


def number(value: str) -> float:
    match = re.search(r"-?\d+(?:\.\d+)?", value or "")
    return float(match.group(0)) if match else 0


def click_text(page: Page, label: str) -> None:
    target = page.get_by_text(label, exact=True)
    if target.count() == 0:
        raise RuntimeError(f"Could not find '{label}'")
    target.first.click()


def click_visible_text(page: Page, label: str) -> None:
    target = page.get_by_text(label, exact=True)
    # Menus and dialogs are appended after the underlying toolbar in
    # Tekmetric's DOM. Search backward so an open menu option wins over the
    # identically named button behind its modal backdrop.
    for index in range(target.count() - 1, -1, -1):
        item = target.nth(index)
        if item.is_visible():
            item.click()
            return
    raise RuntimeError(f"Could not find visible '{label}'")


def visible_text_exists(page: Page, label: str) -> bool:
    target = page.get_by_text(label, exact=True)
    return any(target.nth(index).is_visible() for index in range(target.count()))


def dismiss_tekmetric_pendo(page: Page) -> None:
    """Remove Tekmetric's optional Pendo tours when they cover report links.

    Pendo is an onboarding/help layer, not part of any report data.  Its text
    and backdrop can be inserted after the Reports page has already loaded,
    so this helper is intentionally safe to call immediately before a click.
    """
    page.evaluate(
        """() => {
          const selectors = [
            '#pendo-base',
            '#pendo-guide-container',
            '[id^="pendo-guide-"]',
            '[class*="pendo-backdrop"]',
            '[class*="pendo-overlay"]',
            '._pendo-step-container'
          ];
          document.querySelectorAll(selectors.join(',')).forEach(element => {
            const root = element.closest('#pendo-base, [role="dialog"], ._pendo-step-container') || element;
            root.remove();
          });
        }"""
    )


def report_hub_is_visible(page: Page) -> bool:
    heading = page.get_by_text(
        re.compile(r"^Favorite reports(?:\s*\(\d+\))?$", re.IGNORECASE)
    )
    return any(heading.nth(index).is_visible() for index in range(heading.count()))


def open_report_hub(page: Page) -> None:
    """Open the redesigned Tekmetric Reports page for the Delta Auto shop."""
    page.goto(SHOP_REPORT_URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1600)
    dismiss_tekmetric_pendo(page)

    # Tekmetric can occasionally return to its account-level shop selector.
    if not report_hub_is_visible(page):
        shop = page.get_by_text("Delta Auto", exact=True)
        for index in range(shop.count()):
            item = shop.nth(index)
            if item.is_visible():
                item.click()
                page.wait_for_timeout(1200)
                page.goto(SHOP_REPORT_URL, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(1600)
                dismiss_tekmetric_pendo(page)
                break

    if not report_hub_is_visible(page):
        # Do not block on input() here. Nobody may be sitting at this
        # computer, and a blocked input() call would freeze every remaining
        # sync (Tekmetric, Steer, job board, ticket audits) with no way for
        # anyone to know from the dashboard. The browser window is left open
        # on the real Tekmetric page (visible to anyone walking by), and the
        # caller reports this to the dashboard and retries next cycle.
        raise NeedsSignInError(
            "Tekmetric",
            "Tekmetric's Reports page did not load the Favorite reports "
            "section. The shop computer likely needs someone to sign back "
            "into Tekmetric in the open browser window.",
        )


def open_favorite_report(
    page: Page, report_names: tuple[str, ...], ready_text: str
) -> None:
    if visible_text_exists(page, ready_text):
        return
    open_report_hub(page)
    for report_name in report_names:
        target = page.get_by_text(report_name, exact=True)
        for index in range(target.count()):
            item = target.nth(index)
            if not item.is_visible():
                continue
            # A Pendo guide can appear between locating the favorite and
            # clicking it. Remove it at the last possible moment, then retry
            # with a forced click if another guide races the normal click.
            dismiss_tekmetric_pendo(page)
            try:
                item.click(timeout=5000)
            except Exception:
                dismiss_tekmetric_pendo(page)
                item.click(force=True, timeout=5000)
            page.wait_for_timeout(1800)
            if visible_text_exists(page, ready_text):
                return
            # The report shell sometimes loads before its heading/table.
            try:
                page.get_by_text(ready_text, exact=True).first.wait_for(
                    state="visible", timeout=12000
                )
                return
            except Exception:
                pass
    raise RuntimeError(
        f"Could not open favorite Tekmetric report '{report_names[0]}'."
    )


def open_end_of_day(page: Page) -> None:
    open_favorite_report(
        page,
        ("End of Day", "End of Day Report"),
        "Profit Summary",
    )


def open_report_period_menu(page: Page) -> None:
    preset_pattern = re.compile(
        r"^(Custom|Today|Yesterday|This week|Last week|This month|Last month|Year to date)\b",
        re.IGNORECASE,
    )
    buttons = page.get_by_role("button", name=preset_pattern)
    for index in range(buttons.count() - 1, -1, -1):
        button = buttons.nth(index)
        if button.is_visible():
            button.click()
            page.wait_for_timeout(250)
            return
    fallback = page.locator("button, [role='button']").filter(has_text=preset_pattern)
    for index in range(fallback.count() - 1, -1, -1):
        button = fallback.nth(index)
        if button.is_visible():
            button.click()
            page.wait_for_timeout(250)
            return
    raise RuntimeError("Could not open the Tekmetric report date menu.")


def select_report_period(page: Page, label: str) -> None:
    open_report_period_menu(page)
    click_visible_text(page, label)
    page.wait_for_timeout(1500)


def select_custom_range(page: Page, start_date, end_date) -> None:
    open_report_period_menu(page)
    click_visible_text(page, "Custom")
    dialog = page.get_by_role("dialog")
    dialog.wait_for(state="visible", timeout=10000)
    inputs = dialog.locator("input")
    if inputs.count() < 2:
        raise RuntimeError("Tekmetric's Custom date fields could not be found.")
    for field, value in (
        (inputs.nth(0), start_date.strftime("%m/%d/%Y")),
        (inputs.nth(1), end_date.strftime("%m/%d/%Y")),
    ):
        field.click()
        field.press("Control+A")
        field.fill(value)
        field.press("Tab")
    apply_button = dialog.get_by_role(
        "button", name=re.compile(r"^apply$", re.IGNORECASE)
    )
    apply_button.click()
    page.wait_for_timeout(1800)


def open_reports(page: Page) -> None:
    open_report_hub(page)


def all_tables(page: Page) -> list[list[list[str]]]:
    return page.locator("table, [role='table'], [role='grid']").evaluate_all(
        """tables => {
          const cellValue = cell => {
            const direct = [
              cell.innerText,
              cell.textContent,
              cell.getAttribute("aria-label"),
              cell.getAttribute("data-value"),
              cell.getAttribute("value"),
              cell.getAttribute("title"),
              cell.querySelector("input")?.value,
              cell.querySelector("[aria-label]")?.getAttribute("aria-label"),
              cell.querySelector("[data-value]")?.getAttribute("data-value"),
              cell.querySelector("[value]")?.getAttribute("value"),
            ];
            const shadow = Array.from(cell.querySelectorAll("*"))
              .map(el => el.shadowRoot?.textContent || "")
              .join(" ");
            const before = getComputedStyle(cell, "::before").content;
            const after = getComputedStyle(cell, "::after").content;
            const value = [...direct, shadow, before, after]
              .find(value => value && value.trim() && value !== "none" && value !== '""') || "";
            return value.replace(/^["']|["']$/g, "").trim();
          };
          return tables.map(table =>
            Array.from(table.querySelectorAll("tr, [role='row']")).map(row =>
              Array.from(row.querySelectorAll(
                "th,td,[role='columnheader'],[role='cell'],[role='gridcell']"
              )).map(cellValue)
            )
          );
        }"""
    )


def value_after_label(lines: list[str], label: str, money: bool = False) -> float:
    for index, line in enumerate(lines):
        cells = [cell.strip() for cell in line.split("\t") if cell.strip()]
        if not cells or cells[0] != label:
            continue
        window = " ".join(lines[index : index + 4])
        pattern = (
            r"(?:-\s*\$|\$\s*-?\s*)[\d,]+(?:\.\d{2})?"
            if money
            else r"\d+(?:\.\d+)?"
        )
        matches = re.findall(pattern, window)
        if matches:
            return currency(matches[0]) if money else number(matches[0])
    return 0.0


def extract_end_of_day(page: Page) -> dict:
    open_end_of_day(page)
    page.get_by_text("Profit Summary", exact=True).wait_for(
        state="visible", timeout=20000
    )
    # The report shell appears before Tekmetric finishes filling in its API
    # results. Do not capture the page while the headings are visible but all
    # report cells are still blank.
    try:
        page.wait_for_function(
            """() => {
              const candidates = Array.from(
                document.querySelectorAll("table td, table th, table input, [data-value], [aria-label]")
              ).flatMap(el => [
                el.innerText,
                el.textContent,
                el.value,
                el.getAttribute?.("data-value"),
                el.getAttribute?.("aria-label"),
                getComputedStyle(el, "::before").content,
                getComputedStyle(el, "::after").content,
              ]).filter(Boolean).join(" ");
              const money = candidates.match(/-?\\$\\s*-?\\s*[\\d,]+\\.\\d{2}/g) || [];
              return money.length >= 5;
            }""",
            timeout=30000,
        )
    except Exception as exc:
        raise RuntimeError(
            "The End of Day report opened, but Tekmetric did not finish loading its values within 30 seconds."
        ) from exc
    page.wait_for_timeout(500)

    # Read the visible Profit Summary only. Using a generic table scan can
    # accidentally select a subtotal from a different End of Day section.
    body_text = page.locator("body").inner_text()
    (ROOT / "end-of-day-debug.txt").write_text(body_text, encoding="utf-8")
    lines = [line.strip() for line in body_text.splitlines() if line.strip()]
    total_sales = gross_profit = labor_sales = 0.0
    found_profit_total = False

    # Tekmetric currently renders Profit Summary as a table. Read by column
    # name so spacing or screen-size changes do not affect the result.
    for rows in all_tables(page):
        header_index = next(
            (
                index
                for index, row in enumerate(rows)
                if "Net Sales" in row and "Profit $" in row and "Profit %" in row
            ),
            None,
        )
        if header_index is None:
            continue
        headers = rows[header_index]
        net_sales_index = headers.index("Net Sales")
        profit_index = headers.index("Profit $")
        data_rows = [
            row
            for row in rows[header_index + 1 :]
            if len(row) > max(net_sales_index, profit_index)
        ]
        labor_row = next(
            (row for row in data_rows if row and row[0].strip() == "Labor"),
            None,
        )
        total_row = next(
            (row for row in reversed(data_rows) if row and row[0].strip() == "Total"),
            None,
        )
        if labor_row:
            labor_sales = currency(labor_row[net_sales_index])
        if total_row:
            total_sales = currency(total_row[net_sales_index])
            gross_profit = currency(total_row[profit_index])
            found_profit_total = True
        if found_profit_total:
            break

    # Fallback for any Tekmetric layout that exposes the report as plain text
    # instead of an HTML table.
    if found_profit_total:
        profit_start = -1
    else:
        try:
            profit_start = lines.index("Profit Summary")
        except ValueError:
            profit_start = -1

    if profit_start >= 0:
        profit_lines = lines[profit_start:]
        money_pattern = r"-?\s*\$?\s*\d[\d,]*\.\d{2}(?!\s*%)"
        for index, line in enumerate(profit_lines):
            cells = [cell.strip() for cell in line.split("\t") if cell.strip()]
            if not cells:
                continue
            label = cells[0].lower()
            value_window = " ".join(profit_lines[index : index + 12])
            amounts = re.findall(money_pattern, value_window)
            if label == "labor" and not labor_sales and len(amounts) >= 5:
                labor_sales = currency(amounts[2])
            elif label == "total" and len(amounts) >= 5:
                # Final Profit Summary Total: Sales, Discounts, Net Sales,
                # Cost, Profit $. Later Total rows overwrite earlier subtotals.
                total_sales = currency(amounts[2])
                gross_profit = currency(amounts[4])
                found_profit_total = True

    if not found_profit_total:
        cell_debug = page.locator("table").evaluate_all(
            """tables => tables.map(table => ({
              text: table.textContent,
              html: table.outerHTML,
              cells: Array.from(table.querySelectorAll("th,td")).map(cell => ({
                text: cell.textContent,
                innerText: cell.innerText,
                aria: cell.getAttribute("aria-label"),
                dataValue: cell.getAttribute("data-value"),
                value: cell.getAttribute("value"),
                title: cell.getAttribute("title"),
                inputValue: cell.querySelector("input")?.value,
                before: getComputedStyle(cell, "::before").content,
                after: getComputedStyle(cell, "::after").content
              }))
            }))"""
        )
        (ROOT / "end-of-day-cells.json").write_text(
            json.dumps(cell_debug, indent=2), encoding="utf-8"
        )
        raise RuntimeError(
            "The End of Day Profit Summary was visible, but its Total row could not be read."
        )
    return {
        "totalSales": total_sales,
        "grossProfit": gross_profit,
        "laborSales": labor_sales,
        "lessAR": next(
            (
                value
                for label in ("Posted to A/R", "Posted to AR", "Less A/R", "Less AR", "Less Accounts Receivable")
                if (value := value_after_label(lines, label, money=True)) != 0
            ),
            0.0,
        ),
        "clearedFromAR": next(
            (
                value
                for label in ("Cleared from A/R", "Cleared From A/R", "Cleared from AR", "Cleared A/R", "Cleared AR")
                if (value := value_after_label(lines, label, money=True)) != 0
            ),
            0.0,
        ),
        "totalROs": value_after_label(lines, "Total RO's"),
        "hoursSold": value_after_label(lines, "Hours Sold"),
        "aro": value_after_label(lines, "Avg. RO (Sales)", money=True),
    }


def extract_technicians(page: Page, start_date, end_date) -> tuple[list[dict], float]:
    open_favorite_report(page, ("Technician Hours",), "Billed Time")

    # Tekmetric stores a date range independently for each report. Opening the
    # Technician Hours favorite can therefore restore an older weekly range
    # even when End of Day was set to Today. Always apply the exact range again
    # on the Technician Hours report before reading billed hours.
    select_custom_range(page, start_date, end_date)
    page.get_by_text("Billed Time", exact=True).first.wait_for(
        state="visible", timeout=20000
    )
    page.wait_for_timeout(1000)

    technicians: list[dict] = []
    for rows in all_tables(page):
        header_index = next(
            (index for index, row in enumerate(rows) if "Billed Time" in row and "Labor Sales" in row),
            None,
        )
        if header_index is None:
            continue
        headers = rows[header_index]
        billed_index = headers.index("Billed Time")
        labor_index = headers.index("Labor Sales")
        for row in rows[header_index + 1 :]:
            if len(row) <= max(billed_index, labor_index) or not row[0]:
                continue
            name = row[0].strip()
            if name.lower() in {"total", "unassigned"}:
                continue
            technicians.append(
                {
                    "name": name,
                    "billedHours": number(row[billed_index]),
                    "laborSales": currency(row[labor_index]),
                }
            )
    tech_body = page.locator("body").inner_text()
    tech_lines = [line.strip() for line in tech_body.splitlines() if line.strip()]
    car_count = value_after_label(tech_lines, "Car Count")
    # Keep the four regular production technicians visible even before they
    # bill their first job of the week. Devin remains conditional because he
    # is a helper technician and is only shown when Tekmetric reports hours.
    present_names = {item["name"].casefold() for item in technicians}
    for name in DEFAULT_TECHNICIANS:
        if name.casefold() not in present_names:
            technicians.append(
                {"name": name, "billedHours": 0.0, "laborSales": 0.0}
            )
    if technicians:
        ROSTER_PATH.write_text(
            json.dumps([item["name"] for item in technicians], indent=2),
            encoding="utf-8",
        )
    else:
        # A new reporting week can legitimately contain no technician rows
        # before the first job is billed. Keep the known roster visible at 0.
        names = DEFAULT_TECHNICIANS
        if ROSTER_PATH.exists():
            try:
                saved = json.loads(ROSTER_PATH.read_text(encoding="utf-8"))
                if isinstance(saved, list) and saved:
                    names = [str(name) for name in saved if "devin" not in str(name).lower()]
            except (OSError, json.JSONDecodeError):
                pass
        technicians = [
            {"name": name, "billedHours": 0.0, "laborSales": 0.0}
            for name in names
        ]
    return technicians, car_count


def money_and_count(value: str) -> tuple[float, int]:
    money_match = re.search(r"-?\s*\$[\d,]+(?:\.\d{2})?", value or "")
    values = re.findall(r"(?<![\d.])\d+(?![\d.])", value or "")
    return (
        currency(money_match.group(0)) if money_match else 0.0,
        int(values[-1]) if values else 0,
    )


def extract_service_writers(page: Page) -> list[dict]:
    open_favorite_report(
        page,
        ("Realtime Service Writer",),
        "Total Written",
    )

    # Score completed work only. Job Board + Posted includes open estimates
    # and can substantially inflate a writer's totals.
    source_button = page.get_by_role(
        "button",
        name=re.compile(r"^(Job Board|Job Board \+ Posted|Jobs Created|Posted)$", re.IGNORECASE),
    )
    selected_source = None
    for index in range(source_button.count()):
        candidate = source_button.nth(index)
        if candidate.is_visible():
            selected_source = candidate
            break
    if selected_source is None:
        raise RuntimeError("Could not find the Service Writer report source selector.")
    if selected_source.inner_text().strip().lower() != "posted":
        selected_source.click()
        page.wait_for_timeout(250)
        click_visible_text(page, "Posted")
        page.wait_for_timeout(2200)
    else:
        page.wait_for_timeout(1200)

    (ROOT / "service-writer-debug.txt").write_text(
        page.locator("body").inner_text(), encoding="utf-8"
    )
    writers: list[dict] = []
    required = ("Total Sold", "Total Written", "Close Ratio", "Car Count", "ARO", "AWRO")
    for rows in all_tables(page):
        header_index = next(
            (index for index, row in enumerate(rows) if all(label in row for label in required)),
            None,
        )
        if header_index is None:
            continue
        headers = rows[header_index]
        indexes = {label: headers.index(label) for label in required}
        status_indexes = {
            label: headers.index(label)
            for label in ("Unchecked", "Pending", "Declined", "In-progress", "Completed", "Posted")
            if label in headers
        }
        for row in rows[header_index + 1 :]:
            if len(row) <= max(indexes.values()) or not row[0].strip():
                continue
            name = row[0].replace("Deactivated", "").strip()
            lowered = row[0].lower()
            if (
                "deactivated" in lowered
                or lowered in {"total", "lobby tv", "towing josh"}
                or not re.search(r"[a-z]", lowered)
            ):
                continue
            statuses = {}
            for label, index in status_indexes.items():
                amount, count = money_and_count(row[index] if index < len(row) else "")
                statuses[label] = {"amount": amount, "count": count}
            sold_amount, sold_count = money_and_count(row[indexes["Total Sold"]])
            written_amount, written_count = money_and_count(row[indexes["Total Written"]])
            writers.append({
                "name": name,
                "totalSold": sold_amount,
                "soldCount": sold_count,
                "totalWritten": written_amount,
                "writtenCount": written_count,
                "closeRatio": number(row[indexes["Close Ratio"]]),
                "carCount": int(number(row[indexes["Car Count"]])),
                "aro": currency(row[indexes["ARO"]]),
                "awro": currency(row[indexes["AWRO"]]),
                "statuses": statuses,
            })
        if writers:
            break
    if not writers:
        grid_debug = page.locator("table, [role='table'], [role='grid']").evaluate_all(
            """items => items.map(item => ({
              tag: item.tagName,
              role: item.getAttribute("role"),
              text: item.innerText,
              html: item.outerHTML
            }))"""
        )
        (ROOT / "service-writer-cells.json").write_text(
            json.dumps(grid_debug, indent=2), encoding="utf-8"
        )
        # A fresh Wednesday-through-Tuesday period or an early morning Today
        # report can legitimately have no Posted writer rows.
        body = page.locator("body").inner_text()
        if "Realtime Service Writer Report" in body and "Employee" in body:
            return []
        raise RuntimeError("The Realtime Service Writer table could not be read.")
    return writers


def post_snapshot(config: Config, payload: dict) -> None:
    response = HTTP.post(
        f"{config.dashboard_url}/api/snapshot",
        json=payload,
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        },
        timeout=30,
    )
    if not response.ok:
        detail = response.text.strip()
        raise RuntimeError(
            f"Dashboard rejected the {payload.get('period', 'unknown')} snapshot "
            f"({response.status_code}): {detail or 'No explanation returned.'}"
        )


def post_reader_status(config: Config, status: str, detail: str = "") -> None:
    """Best-effort status ping so the dashboard can show a banner instead of
    silently waiting. Never allowed to raise — a status report failing must
    not stop the rest of the sync from proceeding."""
    try:
        response = HTTP.post(
            f"{config.dashboard_url}/api/reader-status",
            json={"status": status, "detail": detail},
            headers={
                "x-reader-key": config.reader_api_key,
                "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
            },
            timeout=15,
        )
        response.raise_for_status()
    except Exception as exc:
        log(f"Could not report reader status '{status}' to the dashboard: {exc}")


def post_opportunities(config: Config, opportunities: list[dict]) -> None:
    response = HTTP.post(
        f"{config.dashboard_url}/api/opportunities",
        json={
            "opportunities": opportunities,
            "listDate": datetime.now(CENTRAL_TIME).date().isoformat(),
            "capturedAt": datetime.now(timezone.utc).isoformat(),
        },
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        },
        timeout=60,
    )
    response.raise_for_status()


def post_service_writers(config: Config, period: str, start_date, end_date, writers: list[dict]) -> None:
    response = HTTP.post(
        f"{config.dashboard_url}/api/service-writers",
        json={
            "period": period,
            "startDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
            "writers": writers,
            "capturedAt": datetime.now(timezone.utc).isoformat(),
        },
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        },
        timeout=30,
    )
    response.raise_for_status()


def post_job_board(config: Config, repair_orders: list[dict]) -> None:
    response = HTTP.post(
        f"{config.dashboard_url}/api/job-board",
        json={
            "repairOrders": repair_orders,
            "capturedAt": datetime.now(timezone.utc).isoformat(),
        },
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        },
        timeout=60,
    )
    response.raise_for_status()


def post_schedule_snapshot(config: Config, payload: dict) -> None:
    response = HTTP.post(
        f"{config.dashboard_url}/api/schedule-history",
        json=payload,
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        },
        timeout=60,
    )
    response.raise_for_status()


def schedule_capture_requested(config: Config) -> bool:
    response = HTTP.get(
        f"{config.dashboard_url}/api/schedule-history",
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        }, timeout=30,
    )
    response.raise_for_status()
    return bool(response.json().get("captureRequested"))


def post_schedule_screenshot(config: Config, schedule_date: str, hour_key: str, image: bytes) -> None:
    response = HTTP.post(
        f"{config.dashboard_url}/api/schedule-history/image",
        params={"date": schedule_date, "hour": hour_key}, data=image,
        headers={
            "Content-Type": "image/png",
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        }, timeout=60,
    )
    response.raise_for_status()


def post_ticket_audits(config: Config, audits: list[dict]) -> None:
    response = HTTP.post(
        f"{config.dashboard_url}/api/ticket-audits",
        json={
            "reportDate": datetime.now(CENTRAL_TIME).date().isoformat(),
            "audits": audits,
            "capturedAt": datetime.now(timezone.utc).isoformat(),
        },
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        },
        timeout=90,
    )
    response.raise_for_status()


def post_delta_ai_estimates(config: Config, estimates: list[dict], active_ro_numbers: list[str]) -> dict:
    response = HTTP.post(
        f"{config.dashboard_url}/api/delta-ai-audits",
        json={"estimates": estimates, "activeRoNumbers": active_ro_numbers},
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        }, timeout=240,
    )
    if not response.ok:
        try:
            detail = response.json().get("error", response.text)
        except Exception:
            detail = response.text
        raise RuntimeError(f"Dashboard returned {response.status_code}: {str(detail)[:700]}")
    return response.json()


def post_warranty_claims(config: Config, claims: list[dict]) -> dict:
    response = HTTP.post(
        f"{config.dashboard_url}/api/warranty-claims",
        json={"claims": claims, "capturedAt": datetime.now(timezone.utc).isoformat()},
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        }, timeout=180,
    )
    if not response.ok:
        raise RuntimeError(f"Dashboard returned {response.status_code}: {response.text[:700]}")
    return response.json()


def get_warranty_overrides(config: Config) -> dict[str, str]:
    response = HTTP.get(
        f"{config.dashboard_url}/api/warranty-claims",
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        }, timeout=30,
    )
    response.raise_for_status()
    value = response.json().get("overrides", {})
    return {str(key): str(ro) for key, ro in value.items()} if isinstance(value, dict) else {}


def post_goal_miss(config: Config, start_date, end_date, tickets: list[dict]) -> None:
    response = HTTP.post(
        f"{config.dashboard_url}/api/goal-miss",
        json={
            "startDate": start_date.isoformat(), "endDate": end_date.isoformat(),
            "tickets": tickets, "capturedAt": datetime.now(timezone.utc).isoformat(),
        },
        headers={
            "x-reader-key": config.reader_api_key,
            "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}",
        }, timeout=90,
    )
    response.raise_for_status()


def post_vehicle_history(config: Config, payload: dict) -> None:
    response = HTTP.post(
        f"{config.dashboard_url}/api/vehicle-history", json=payload,
        headers={"x-reader-key": config.reader_api_key,
                 "OAI-Sites-Authorization": f"Bearer {config.sites_machine_token}"},
        timeout=120,
    )
    response.raise_for_status()


def history_progress() -> dict:
    if HISTORY_PROGRESS_PATH.exists():
        try:
            value = json.loads(HISTORY_PROGRESS_PATH.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                return value
        except Exception:
            pass
    return {"queue": [], "completed": [], "discoveryPage": 0}


def save_history_progress(value: dict) -> None:
    HISTORY_PROGRESS_PATH.write_text(json.dumps(value, indent=2), encoding="utf-8")


def customer_links(page: Page) -> list[dict]:
    return page.locator("a[href]").evaluate_all(r"""links => {
      const seen = new Set();
      return links.map(a => ({name:(a.innerText||'').trim(), url:a.href||''}))
        .filter(x => /\/(?:customers?|contacts?)(?:\/|\?|$)/i.test(x.url)
          && !/\/customers?(?:\?|$)/i.test(x.url)
          && x.name && !seen.has(x.url) && seen.add(x.url));
    }""")


def discover_customer_queue(context, progress: dict) -> int:
    page = context.new_page()
    try:
        page.goto(JOB_BOARD_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1400)
        nav = page.get_by_text("Customers", exact=True)
        target = next((nav.nth(i) for i in range(nav.count()) if nav.nth(i).is_visible()), None)
        if target is None:
            raise NeedsSignInError("Tekmetric", "The Customers navigation did not load.")
        target.click(); page.wait_for_timeout(1800)
        # Customer rows can be virtualized. Scroll the main page so every
        # currently loaded profile link has a chance to enter the DOM.
        for _ in range(20):
            before_height = page.evaluate("document.documentElement.scrollHeight")
            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            page.wait_for_timeout(150)
            after_height = page.evaluate("document.documentElement.scrollHeight")
            if after_height == before_height: break
        # Tekmetric defaults to 10 of 13,000+ customers. Use its rows-per-page
        # control so the background cursor can advance in practical batches.
        comboboxes = page.get_by_role("combobox")
        if comboboxes.count():
            try:
                comboboxes.last.click()
                hundred = page.get_by_text("100", exact=True)
                if hundred.count(): hundred.last.click(); page.wait_for_timeout(800)
            except Exception:
                page.keyboard.press("Escape")
        for _ in range(int(progress.get("discoveryPage", 0))):
            nxt = page.get_by_label(re.compile(r"next", re.I))
            if not nxt.count() or nxt.last.is_disabled(): break
            nxt.last.click(); page.wait_for_timeout(750)
        links = customer_links(page)
        if not links:
            # The current Tekmetric Customers grid uses JavaScript click
            # handlers on table rows instead of anchor elements. Open a small
            # slice of rows, record the resulting profile URL, then go back;
            # discoveryRow remembers the exact position across restarts.
            rows = page.locator("tbody tr")
            row_count = rows.count()
            start = min(int(progress.get("discoveryRow", 0)), row_count)
            stop = min(start + 10, row_count)
            for index in range(start, stop):
                row = page.locator("tbody tr").nth(index)
                row_lines = [x.strip() for x in row.inner_text().splitlines() if x.strip()]
                customer_name = row_lines[0] if row_lines else f"Customer row {index + 1}"
                list_url = page.url
                # Tekmetric only opens the profile from the Customer-name
                # cell; clicking the checkbox, phone, email, or blank row area
                # does nothing. This mirrors the shop's demonstrated workflow.
                cells = row.locator("td")
                name_cell = cells.nth(1) if cells.count() > 1 else row
                name_target = name_cell.get_by_text(customer_name, exact=True)
                if name_target.count(): name_target.first.click()
                else: name_cell.click()
                try:
                    page.wait_for_url(re.compile(r"/customers?/[^/?#]+", re.I), timeout=5000)
                except Exception:
                    pass
                page.wait_for_timeout(350)
                if page.url != list_url and re.search(r"/customers?/[^/?#]+", page.url, re.I):
                    links.append({"name": customer_name, "url": page.url})
                page.go_back(wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(650)
            progress["discoveryRow"] = stop
            if row_count and stop >= row_count:
                progress["discoveryPage"] = int(progress.get("discoveryPage", 0)) + 1
                progress["discoveryRow"] = 0
        if not links:
            debug = page.locator("a,button,[role='button'],[role='row']").evaluate_all(
                "items => items.slice(0,1000).map(x => ({tag:x.tagName, text:(x.innerText||'').trim(), href:x.href||'', role:x.getAttribute('role')||''}))"
            )
            (ROOT / "vehicle-history-discovery-debug.json").write_text(
                json.dumps({"url": page.url, "items": debug}, indent=2), encoding="utf-8"
            )
            page.screenshot(path=str(ROOT / "vehicle-history-discovery-debug.png"), full_page=True)
            progress["discoveryComplete"] = False
            save_history_progress(progress)
            log("Vehicle history discovery found 0 customer links; saved vehicle-history-discovery-debug.json and .png")
            return 0
        known = {str(x.get("url")) for x in progress.get("queue", [])}
        known.update(str(x) for x in progress.get("completed", []))
        for item in links:
            if item["url"] not in known:
                progress.setdefault("queue", []).append(item); known.add(item["url"])
        nxt = page.get_by_label(re.compile(r"next", re.I))
        if not (nxt.count() and not nxt.last.is_disabled()) and int(progress.get("discoveryRow", 0)) == 0:
            progress["discoveryComplete"] = True
        save_history_progress(progress)
        return len(links)
    finally:
        page.close()


def parse_customer_history(context, item: dict) -> dict:
    page, detail = context.new_page(), context.new_page()
    try:
        page.goto(str(item["url"]), wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1400)
        name = str(item.get("name") or "").strip()
        heading = page.locator("h1,h2").first
        if heading.count() and heading.is_visible(): name = heading.inner_text().strip() or name
        key = re.sub(r"[^a-z0-9]+", "-", str(item["url"]).lower()).strip("-")[-280:]
        vehicles = []
        for tab_name, archived in (("Current Vehicles", False), ("Archived Vehicles", True)):
            tab = page.get_by_text(tab_name, exact=True)
            if tab.count() and tab.first.is_visible(): tab.first.click(); page.wait_for_timeout(600)
            for row in page.locator("tr,[role='row']").all_inner_texts():
                lines = [x.strip() for x in row.splitlines() if x.strip()]
                description = next((x for x in lines if re.search(r"\b(?:19|20)\d{2}\b", x)), "")
                vin = next((m.group(0) for x in lines if (m := re.search(r"\b[A-HJ-NPR-Z0-9]{17}\b", x, re.I))), "")
                if description or vin: vehicles.append({"description":description,"vin":vin,"archived":archived,"raw":lines})
        paid = page.get_by_text("Paid", exact=True)
        if paid.count() and paid.first.is_visible(): paid.first.click(); page.wait_for_timeout(800)
        ro_links, seen_ro_urls = [], set()
        for _paid_page in range(500):
            page_links = page.locator("a").evaluate_all(r"""links => links.map(a => ({
              text:(a.innerText||'').trim(), url:a.href||'', row:(a.closest('tr,[role="row"]')?.innerText||'')
            })).filter(x => /^#?\d+$/.test(x.text) && x.url)""")
            for candidate in page_links:
                if candidate["url"] not in seen_ro_urls:
                    seen_ro_urls.add(candidate["url"]); ro_links.append(candidate)
            nxt = page.get_by_label(re.compile(r"next", re.I))
            if not nxt.count() or nxt.last.is_disabled(): break
            before = page.locator("body").inner_text()
            nxt.last.click(); page.wait_for_timeout(650)
            if page.locator("body").inner_text() == before: break
        repair_orders = []
        for raw in ro_links:
            lines = [x.strip() for x in str(raw.get("row") or "").splitlines() if x.strip()]
            number_value = re.sub(r"\D", "", str(raw.get("text") or ""))
            if not number_value: continue
            detail.goto(str(raw["url"]), wait_until="domcontentloaded", timeout=60000); detail.wait_for_timeout(900)
            raw_text = detail.locator("body").inner_text()
            amounts = re.findall(r"-?\$[\d,]+(?:\.\d{2})?", str(raw.get("row") or ""))
            repair_orders.append({"roNumber":number_value,"url":raw["url"],
              "postedDate":next((x for x in lines if re.search(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b",x)),""),
              "vehicle":next((x for x in lines if re.search(r"\b(?:19|20)\d{2}\b",x)),""),
              "odometerOut":next((x for x in lines if re.fullmatch(r"[\d,]+",x) and x.replace(",","") != number_value),""),
              "total":currency(amounts[-1]) if amounts else 0,"detail":{"rawText":raw_text[:60000]}})
        if not vehicles and not repair_orders:
            controls = page.locator("a,button,[role],tr,[class*='row'],[class*='Row']").evaluate_all(
                "items => items.slice(0,1500).map(x => ({tag:x.tagName,text:(x.innerText||'').trim(),href:x.href||'',role:x.getAttribute('role')||'',className:typeof x.className==='string'?x.className:''}))"
            )
            (ROOT / "vehicle-history-profile-debug.json").write_text(
                json.dumps({"url":page.url,"customer":name,"body":page.locator("body").inner_text(),"items":controls}, indent=2),
                encoding="utf-8",
            )
            page.screenshot(path=str(ROOT / "vehicle-history-profile-debug.png"), full_page=True)
            log("Vehicle history profile data was empty; saved vehicle-history-profile-debug.json and .png")
        return {"customerKey":key,"customerName":name,"customerUrl":item["url"],
                "vehicles":vehicles,"repairOrders":repair_orders,"capturedAt":datetime.now(timezone.utc).isoformat()}
    finally:
        detail.close(); page.close()


def sync_vehicle_history(context, config: Config, batch_size: int = 2) -> int:
    progress = history_progress()
    if progress.get("discoveryComplete") and not progress.get("completed") and not progress.get("queue"):
        progress["discoveryComplete"] = False
    if not progress.get("completed") and not progress.get("queue"):
        progress["discoveryPage"] = 0
        progress["discoveryRow"] = 0
    if not progress.get("queue") and not progress.get("discoveryComplete"):
        discover_customer_queue(context, progress)
    completed = set(map(str, progress.get("completed", [])))
    processed = 0
    while progress.get("queue") and processed < batch_size:
        item = progress["queue"].pop(0); url = str(item.get("url") or "")
        if not url or url in completed: continue
        payload = parse_customer_history(context, item)
        post_vehicle_history(config, payload)
        completed.add(url); progress["completed"] = sorted(completed)
        save_history_progress(progress); processed += 1
        log(f"Vehicle history: {payload['customerName']} — {len(payload['vehicles'])} vehicles, {len(payload['repairOrders'])} paid ROs")
    if len(progress.get("queue", [])) < batch_size and not progress.get("discoveryComplete"):
        discover_customer_queue(context, progress)
    return processed


def extract_profit_details_goal_tickets(context, report_page) -> list[dict]:
    """Build posted-RO Goal Miss rows from Tekmetric's real Profit Details report."""
    raw_rows = report_page.locator("a").evaluate_all(
        r"""links => links.filter(link => /^#\d+$/.test((link.textContent || '').trim())).map(link => {
          let row = link.closest('tr,[role="row"]') || link.parentElement;
          while (row && row.parentElement) {
            const text = row.innerText || '';
            const ros = text.match(/#\d+/g) || [];
            const money = text.match(/-?\$[\d,]+(?:\.\d{2})?/g) || [];
            if (ros.length === 1 && money.length >= 1) break;
            if (text.length > 1800 || ros.length > 1) break;
            row = row.parentElement;
          }
          return { href: link.href || '', text: row?.innerText || '' };
        })"""
    )
    tickets: list[dict] = []
    detail_page = context.new_page()
    try:
        for position, raw in enumerate(raw_rows, start=1):
            text = str(raw.get("text") or "")
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            ro_match = re.search(r"#(\d+)", text)
            money_values = re.findall(r"-?\s*\$[\d,]+(?:\.\d{2})?", text)
            percent_values = re.findall(r"-?\d+(?:\.\d+)?%", text)
            if not ro_match or not money_values or not percent_values:
                continue
            gross_profit = currency(money_values[-1])
            gross_profit_percent = number(percent_values[-1])
            sales = (
                gross_profit / (gross_profit_percent / 100)
                if gross_profit_percent > 0 and gross_profit != 0
                else 0.0
            )
            date_index = next((i for i, line in enumerate(lines)
                if re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", line)), -1)
            first_money_index = next((i for i, line in enumerate(lines) if "$" in line), len(lines))
            identity = [line for line in lines[date_index + 1:first_money_index]
                if not line.startswith("#")]
            customer = identity[0] if identity else ""
            vehicle = next((line for line in identity if re.match(r"^\d{4}\s+", line)), "")
            writer = identity[-1] if len(identity) > 1 else "Unassigned"
            href = str(raw.get("href") or "")
            gp_per_hour = 0.0
            hours = 0.0
            labor_gp = parts_gp = 0.0
            labor_sales = labor_profit = parts_sales = parts_cost = parts_profit = 0.0
            if href:
                try:
                    log(f"Reading posted RO#{ro_match.group(1)} for Goal Miss ({position}/{len(raw_rows)})")
                    detail_page.goto(href, wait_until="domcontentloaded", timeout=60000)
                    detail_page.wait_for_timeout(1500)
                    detail_text = detail_page.locator("body").inner_text()
                    profit_text = profitability_modal_text(detail_page)
                    labor_gp = parse_percent(profit_text, "Labor GP%")
                    parts_gp = parse_percent(profit_text, "Parts GP%")
                    labor_sales = parse_currency_metric(profit_text, "Labor Sales", "Labor Retail")
                    labor_profit = parse_currency_metric(profit_text, "Labor GP$", "Labor Profit")
                    parts_sales = parse_currency_metric(profit_text, "Parts Sales", "Parts Retail")
                    parts_cost = parse_currency_metric(profit_text, "Parts Cost")
                    parts_profit = parse_currency_metric(profit_text, "Parts GP$", "Parts Profit")
                    if not labor_sales and labor_profit and labor_gp:
                        labor_sales = labor_profit / (labor_gp / 100)
                    if not parts_sales and parts_profit and parts_gp:
                        parts_sales = parts_profit / (parts_gp / 100)
                    if not parts_cost and parts_sales:
                        parts_cost = parts_sales - parts_profit
                    gp_hour_values = [currency(value) for value in re.findall(
                        r"(?:GP\s*/?\s*(?:hr|hour)|gross profit per hour)[^$\d-]{0,30}(-?\s*\$[\d,]+(?:\.\d{2})?)|(-?\s*\$[\d,]+(?:\.\d{2})?)\s*/\s*(?:hr|hour)",
                        detail_text, re.I
                    ) for value in value if value]
                    if gp_hour_values:
                        gp_per_hour = gp_hour_values[-1]
                        if gp_per_hour > 0:
                            hours = gross_profit / gp_per_hour
                except Exception as detail_exc:
                    log(f"Goal Miss could not enrich RO#{ro_match.group(1)}: {detail_exc}")
            causes = []
            if gross_profit_percent < 60:
                causes.append("Low overall margin")
            if gp_per_hour and gp_per_hour < 170:
                causes.append("Low GP per billed hour")
            if sales and sales < 1000:
                causes.append("Low ARO ticket")
            if hours and hours < 3:
                causes.append("Too few sold hours")
            complete = sales > 0 and gp_per_hour > 0 and hours > 0
            tickets.append({
                "roNumber": ro_match.group(1), "customer": customer,
                "vehicle": vehicle, "serviceWriter": writer,
                "technicians": [], "detailUrl": href, "sales": round(sales, 2),
                "grossProfit": gross_profit, "hoursSold": round(hours, 2),
                "grossProfitPercent": gross_profit_percent,
                "grossProfitPerHour": gp_per_hour, "laborGpPercent": labor_gp,
                "partsGpPercent": parts_gp, "laborSales": round(labor_sales, 2),
                "laborProfit": round(labor_profit, 2), "partsSales": round(parts_sales, 2),
                "partsCost": round(parts_cost, 2), "partsProfit": round(parts_profit, 2),
                "unbilledParts": 0, "missedLabor": 0,
                "discount": 0, "rootCauses": causes, "exceptionType": "",
                "controllable": True, "dataComplete": complete,
                "notes": "" if complete else "Profit Details loaded; GP/hour or sold-hour detail still needs review.",
            })
    finally:
        detail_page.close()
    return tickets


def extract_goal_miss_tickets(context, config: Config, start_date, end_date) -> int:
    """Read the favorite ticket-level profitability report; never post partial/sample rows."""
    page = context.new_page()
    report_names = (
        "Profit Details",
        "Repair Order Profitability", "RO Profitability", "Repair Order Summary",
        "Repair Order History", "RO History",
    )
    try:
        open_report_hub(page)
        opened = False
        opened_name = ""
        for name in report_names:
            targets = page.get_by_text(name, exact=True)
            for index in range(targets.count()):
                if targets.nth(index).is_visible():
                    targets.nth(index).click()
                    page.wait_for_timeout(1800)
                    opened = True
                    opened_name = name
                    break
            if opened:
                break
        if not opened:
            log("Goal Miss skipped: favorite the Profit Details report in Tekmetric.")
            return 0
        select_custom_range(page, start_date, end_date)
        page.wait_for_timeout(1400)
        if opened_name == "Profit Details":
            tickets = extract_profit_details_goal_tickets(context, page)
            if not tickets:
                (ROOT / "goal-miss-debug.txt").write_text(
                    page.locator("body").inner_text(), encoding="utf-8"
                )
                log("Goal Miss skipped: Profit Details opened but no posted RO rows could be read.")
                return 0
            post_goal_miss(config, start_date, end_date, tickets)
            return len(tickets)
        aliases = {
            "ro": ("RO #", "RO#", "Repair Order", "RO Number"),
            "customer": ("Customer", "Customer Name"),
            "vehicle": ("Vehicle",),
            "writer": ("Service Writer", "Advisor"),
            "technician": ("Technician", "Technicians"),
            "sales": ("Net Sales", "Total Sales", "Sales"),
            "gp": ("Profit $", "Gross Profit $", "Gross Profit"),
            "hours": ("Hours Sold", "Billed Hours", "Sold Hours"),
            "gp_percent": ("Profit %", "Gross Profit %", "GP%"),
            "labor_gp": ("Labor GP%", "Labor GP %"),
            "parts_gp": ("Parts GP%", "Parts GP %"),
            "discount": ("Discounts", "Discount"),
            "status": ("Status", "Type"),
        }
        tickets = []
        for rows in all_tables(page):
            header_index = next((i for i, row in enumerate(rows)
                if any(label in row for label in aliases["ro"])
                and any(label in row for label in aliases["sales"])
                and any(label in row for label in aliases["gp"])
                and any(label in row for label in aliases["hours"])), None)
            if header_index is None:
                continue
            headers = rows[header_index]
            def column(key):
                return next((headers.index(label) for label in aliases[key] if label in headers), None)
            indexes = {key: column(key) for key in aliases}
            required = (indexes["ro"], indexes["sales"], indexes["gp"], indexes["hours"])
            if any(index is None for index in required):
                continue
            for row in rows[header_index + 1:]:
                if len(row) <= max(index for index in required if index is not None):
                    continue
                def cell(key):
                    index = indexes[key]
                    return row[index].strip() if index is not None and index < len(row) else ""
                ro_match = re.search(r"\d+", cell("ro"))
                if not ro_match or cell("ro").lower() == "total":
                    continue
                sales, gp, hours = currency(cell("sales")), currency(cell("gp")), number(cell("hours"))
                gp_percent = number(cell("gp_percent")) or (gp / sales * 100 if sales else 0)
                gp_per_hour = gp / hours if hours else 0
                labor_gp = number(cell("labor_gp"))
                parts_gp = number(cell("parts_gp"))
                status_text = cell("status")
                combined = " ".join(row).lower()
                exception = next((name for name, pattern in (
                    ("Warranty", r"warranty|third.?party"), ("Comeback", r"comeback|redo|no charge"),
                    ("Internal", r"internal|shop use"), ("Diagnostic-only", r"diagnos.*only|testing only"),
                ) if re.search(pattern, combined)), "")
                causes = []
                if gp_percent < 60: causes.append("Low overall margin")
                if gp_per_hour < 170 and hours > 0: causes.append("Low GP per billed hour")
                if sales < 1000: causes.append("Low ARO ticket")
                if hours < 3: causes.append("Too few sold hours")
                if indexes["parts_gp"] is not None and parts_gp < 40: causes.append("Low parts margin")
                if indexes["labor_gp"] is not None and labor_gp < 60: causes.append("Low labor margin")
                discount = abs(currency(cell("discount")))
                if discount: causes.append("Discount")
                tickets.append({
                    "roNumber": ro_match.group(0), "customer": cell("customer"),
                    "vehicle": cell("vehicle"), "serviceWriter": cell("writer") or "Unassigned",
                    "technicians": [name.strip() for name in re.split(r"[,/&]", cell("technician")) if name.strip()],
                    "detailUrl": "", "sales": sales, "grossProfit": gp, "hoursSold": hours,
                    "grossProfitPercent": gp_percent, "grossProfitPerHour": gp_per_hour,
                    "laborGpPercent": labor_gp, "partsGpPercent": parts_gp,
                    "laborSales": 0, "laborProfit": 0, "partsSales": 0,
                    "partsCost": 0, "partsProfit": 0,
                    "unbilledParts": 0, "missedLabor": 0, "discount": discount,
                    "rootCauses": causes, "exceptionType": exception,
                    "controllable": not bool(exception), "dataComplete": True,
                    "notes": status_text,
                })
            if tickets:
                break
        if not tickets:
            log("Goal Miss skipped: the favorite report did not expose RO, sales, GP dollars, and sold hours columns.")
            return 0
        post_goal_miss(config, start_date, end_date, tickets)
        return len(tickets)
    finally:
        page.close()


def job_category(label: str) -> str:
    normalized = label.lower()
    groups = {
        "attention": ("attn", "assist", "big daddy", "72hrs", "documentation"),
        "authorization": ("authorization", "approval", "declined"),
        "parts": ("part", "arrival", "sublet", "po#"),
        "production": ("scheduled", "in-progress", "tech finished", "verify", "estimate"),
        "completed": ("balance due", "credit due", "customer contacted", "ready to post", "payment link"),
        "warranty": ("warranty", "3rdparty"),
        "exception": ("abandonment", "labor lien", "no show", "need key", "do not touch"),
    }
    for category, tokens in groups.items():
        if any(token in normalized for token in tokens):
            return category
    return "other"


def parse_age_days(text: str) -> int:
    match = re.search(r"Created\s+(\d+)\s*([mhdM])\s+ago", text)
    if not match:
        return 0
    amount = int(match.group(1))
    unit = match.group(2)
    if unit == "M":
        return amount * 30
    if unit == "d":
        return amount
    return 0


def parse_job_card(raw: dict) -> dict | None:
    text = str(raw.get("text") or "")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    ro_match = re.search(r"RO#(\d+)", text)
    phone_match = re.search(r"\(\d{3}\)\s*\d{3}-\d{4}", text)
    if not ro_match or not phone_match:
        return None
    created_line = next((line for line in lines if line.startswith("Created ")), "")
    known_labels = {item.casefold(): item for item in JOB_BOARD_LABELS}
    label = next(
        (known_labels[line.casefold()] for line in lines if line.casefold() in known_labels),
        "Unlabeled",
    )
    customer_line = next(
        (line for line in lines if phone_match.group(0) in line),
        "",
    )
    customer = re.sub(r"\(\d{3}\)\s*\d{3}-\d{4}", "", customer_line)
    customer = customer.replace("•", "").strip()
    phone_index = lines.index(customer_line) if customer_line in lines else -1
    if not customer and phone_index > 0:
        for candidate in reversed(lines[:phone_index]):
            cleaned = candidate.replace("•", "").strip(" ·")
            if (
                not cleaned
                or cleaned.casefold() in known_labels
                or re.fullmatch(r"[A-Z]{1,3}", cleaned)
                or re.fullmatch(r"RO#\d+", cleaned, re.IGNORECASE)
                or cleaned.startswith("Created ")
                or re.fullmatch(r"\d+\s*[mhdM]\s+ago(?:\s*-\s*Pending)?", cleaned)
            ):
                continue
            if re.search(r"[A-Za-z]", cleaned):
                customer = cleaned
                break
    vehicle = ""
    for candidate in lines[phone_index + 1:] if phone_index >= 0 else []:
        cleaned = candidate.replace("•", "").strip(" ·")
        if re.match(r"^\d{4}\s+\S", cleaned):
            vehicle = cleaned
            break
    initials = set(re.findall(r"(?<![A-Z])[A-Z]{2}(?![A-Z#])", text))
    writer_initial = next(
        (initial for initial in SERVICE_WRITER_PRIORITY if initial in initials),
        "",
    )
    section = str(raw.get("section") or "unknown")
    age_days = parse_age_days(text)
    money_values = re.findall(r"\$[\d,]+(?:\.\d{2})?", text)
    # Tekmetric has rendered this progress value both as ``0 / 2 hrs`` and
    # simply ``0 / 2``.  The unit-free form is the current Job Board markup.
    # Keep the numbers bounded so dates, phone numbers, and dollar amounts
    # cannot be mistaken for labor progress.
    hour_progress = re.findall(
        r"(?<![\d.$])([0-9]{1,3}(?:\.[0-9]{1,2})?)\s*/\s*"
        r"([0-9]{1,3}(?:\.[0-9]{1,2})?)(?:\s*(?:hrs?|hours?))?(?![\d/])",
        text, re.I,
    )
    sold_hours = max((number(total) for _worked, total in hour_progress), default=0)
    activity_ages = re.findall(r"(\d+)\s*([mhdM])\s+ago", text)
    latest_activity_days = min(
        (
            int(value) * 30 if unit == "M" else int(value) if unit == "d" else 0
            for value, unit in activity_ages
        ),
        default=age_days,
    )
    return {
        "roNumber": ro_match.group(1),
        "section": section,
        "label": label,
        "category": job_category(label),
        "customer": customer,
        "phone": phone_match.group(0),
        "vehicle": vehicle,
        "serviceWriter": SERVICE_WRITERS.get(writer_initial, "Unassigned"),
        "serviceWriterInitials": writer_initial,
        "assignedInitials": sorted(initials),
        "ageDays": age_days,
        "daysSinceActivity": latest_activity_days,
        "amount": currency(money_values[-1]) if money_values else 0,
        "soldHours": round(sold_hours, 2),
        "balanceDue": "Balance Due" in text,
        "rawText": text[:2000],
        "detailUrl": str(raw.get("href") or ""),
    }


def extract_visible_job_cards(page: Page) -> list[dict]:
    return page.get_by_text(re.compile(r"^RO#\d+$")).evaluate_all(
        """links => links.map(link => {
          let card = link;
          while (card.parentElement) {
            const parent = card.parentElement;
            const text = parent.innerText || "";
            if (text.length > 1600) break;
            card = parent;
            const ros = text.match(/RO#\\d+/g) || [];
            if (ros.length === 1 && /Created\\s+\\d+\\s*[mhdM]\\s+ago/.test(text) &&
                /\\(\\d{3}\\)\\s*\\d{3}-\\d{4}/.test(text)) break;
          }
          const center = card.getBoundingClientRect().x + card.getBoundingClientRect().width / 2;
          const width = window.innerWidth;
          const section = center < width * .44 ? "estimates" :
            center < width * .72 ? "work-in-progress" : "completed";
          // Tekmetric usually renders the RO number as a span inside the
          // actual router link. Reading link.href directly therefore returns
          // blank even though clicking the visible RO opens the ticket.
          let anchor = link.closest('a[href]');
          if (!anchor) anchor = card.querySelector('a[href*="repair-order"],a[href*="repair-orders"],a[href*="estimate"]');
          if (!anchor) anchor = card.querySelector('a[href]');
          let href = anchor?.href || '';
          if (!href) {
            let node = link;
            for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
              const candidate = node.getAttribute?.('data-href') ||
                node.getAttribute?.('data-url') || node.getAttribute?.('data-path');
              if (candidate) {
                try { href = new URL(candidate, location.href).href; } catch (_) {}
                if (href) break;
              }
            }
          }
          return { text: card.innerText || "", section, href };
        })"""
    )


def audit_finding(code: str, severity: str, title: str, detail: str, impact: float = 0) -> dict:
    return {
        "code": code,
        "severity": severity,
        "title": title,
        "detail": detail,
        "estimatedImpact": max(0, round(impact, 2)),
    }


def profitability_modal_text(page: Page) -> str:
    """Open Tekmetric profitability and read every virtualized row while scrolling."""
    # Tekmetric lazy-renders the RO profitability footer. Make it visible
    # before looking for the icon next to GP%.
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(700)
    target = page.evaluate(
        r"""() => {
          document.querySelectorAll('[data-reader-profit-button]')
            .forEach(el => el.removeAttribute('data-reader-profit-button'));
          const gpCandidates = Array.from(document.querySelectorAll('*')).filter(el => {
            const text = (el.textContent || '').replace(/\s+/g, '').trim().toUpperCase();
            const r = el.getBoundingClientRect();
            return el.children.length === 0 && text === 'GP%' &&
              r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
          });
          // There may be a GP% inside each job. The RO-level control shown in
          // Tekmetric's sticky footer is the lowest visible GP% on screen.
          const gp = gpCandidates.sort((a, b) =>
            b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
          if (!gp) return { found: false };
          const gpRect = gp.getBoundingClientRect();
          let footer = gp.parentElement;
          for (let i = 0; i < 7 && footer; i++, footer = footer.parentElement) {
            const candidates = Array.from(footer.querySelectorAll('button,[role="button"],a,svg'))
              .map(el => el.closest('button,[role="button"],a') || el.parentElement || el)
              .filter((el, index, all) => all.indexOf(el) === index)
              .map(el => ({ el, r: el.getBoundingClientRect() }))
              .filter(item => item.r.width > 0 && item.r.height > 0 &&
                item.r.right <= gpRect.left + 12 && gpRect.left - item.r.right < 100 &&
                Math.abs((item.r.top + item.r.height / 2) - (gpRect.top + gpRect.height / 2)) < 55)
              .sort((a, b) => b.r.right - a.r.right);
            if (candidates.length) {
              candidates[0].el.setAttribute('data-reader-profit-button', '1');
              return { found: true, marked: true };
            }
          }
          // Screenshot-confirmed fallback: the bar-chart icon is immediately
          // left of the sticky footer's GP% label.
          return {
            found: true, marked: false,
            x: Math.max(1, gpRect.left - 27),
            y: gpRect.top + gpRect.height / 2
          };
        }"""
    )
    if not target.get("found"):
        (ROOT / "profitability-button-debug.txt").write_text(
            page.locator("body").inner_text(), encoding="utf-8"
        )
        page.screenshot(path=str(ROOT / "profitability-button-debug.png"), full_page=True)
        return ""
    if target.get("marked"):
        page.locator("[data-reader-profit-button='1']").click(force=True)
    else:
        page.mouse.click(float(target["x"]), float(target["y"]))
    try:
        page.get_by_text("Profitability Analysis", exact=True).wait_for(timeout=15000)
    except Exception:
        (ROOT / "profitability-button-debug.txt").write_text(
            page.locator("body").inner_text(), encoding="utf-8"
        )
        page.screenshot(path=str(ROOT / "profitability-button-debug.png"), full_page=True)
        return ""
    jobs = page.get_by_text("JOBS", exact=True)
    for index in range(jobs.count()):
        if jobs.nth(index).is_visible():
            jobs.nth(index).click(force=True)
            page.wait_for_timeout(800)
            break
    chunks: list[str] = []
    dialog = page.get_by_text("Profitability Analysis", exact=True).locator("xpath=ancestor::*[@role='dialog'][1]")
    root = dialog if dialog.count() else page.locator("body")
    scrollable = root.locator("*").evaluate_all(
        """els => {
          const candidates = els.filter(el => el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 250);
          const el = candidates.sort((a,b) => b.clientHeight - a.clientHeight)[0];
          if (!el) return null;
          el.setAttribute('data-reader-profit-scroll','1');
          return true;
        }"""
    )
    scroller = page.locator("[data-reader-profit-scroll='1']")
    if scrollable and scroller.count():
        scroller.evaluate("el => el.scrollTop = 0")
        for _ in range(40):
            chunks.append(root.inner_text())
            before = scroller.evaluate("el => el.scrollTop")
            scroller.evaluate("el => el.scrollTop += Math.max(300, el.clientHeight * .72)")
            page.wait_for_timeout(180)
            after = scroller.evaluate("el => el.scrollTop")
            at_bottom = scroller.evaluate("el => el.scrollTop + el.clientHeight >= el.scrollHeight - 5")
            if at_bottom or after == before:
                chunks.append(root.inner_text())
                break
    else:
        chunks.append(root.inner_text())
    page.keyboard.press("Escape")
    # Preserve first-seen order while removing identical virtualized snapshots.
    return "\n---READER-SNAPSHOT---\n".join(dict.fromkeys(chunks))


def parse_percent(text: str, label: str) -> float:
    match = re.search(rf"{re.escape(label)}\s*\??\s*\n?\s*(-?\d+(?:\.\d+)?)%", text, re.I)
    return float(match.group(1)) if match else 0


def parse_currency_metric(text: str, *labels: str) -> float:
    """Read a labeled currency metric from Tekmetric profitability text."""
    for label in labels:
        match = re.search(
            rf"{re.escape(label)}\s*\??\s*(?:\n|:)?\s*(-?\s*\$[\d,]+(?:\.\d{{2}})?)",
            text, re.I,
        )
        if match:
            return currency(match.group(1))
    return 0.0


def diagnostic_or_tow_only(page: Page) -> bool:
    """True only when every visible estimate job is diagnostic or towing, with at least one diagnostic job."""
    job_cards = page.locator("div,section,article").evaluate_all(
        r"""elements => elements.filter(el => {
          const text = (el.innerText || '').trim();
          if (text.length < 20 || text.length > 12000 || !/\bGP%\b/i.test(text) || !/JOB TOTAL/i.test(text)) return false;
          return !Array.from(el.children).some(child => {
            const childText = child.innerText || '';
            return /\bGP%\b/i.test(childText) && /JOB TOTAL/i.test(childText);
          });
        }).map(el => (el.innerText || '').trim())"""
    )
    if not job_cards:
        return False
    diagnostic = re.compile(
        r"\b(?:diagnostic|diagnosis|diag(?:nostic)?\s*(?:fee|time|labor)|troubleshoot(?:ing)?|electrical testing)\b",
        re.I,
    )
    towing = re.compile(r"\b(?:tow|towing|wrecker)\b", re.I)
    has_diagnostic = any(diagnostic.search(card) for card in job_cards)
    return has_diagnostic and all(diagnostic.search(card) or towing.search(card) for card in job_cards)


def audit_wip_tickets(context, config: Config, repair_orders: list[dict]) -> int:
    """Open and audit every current Work-in-Progress RO, regardless of age."""
    wip_items = [
        item for item in repair_orders
        if item.get("section") == "work-in-progress"
    ]
    audits: list[dict] = []
    page = context.new_page()
    try:
        for position, item in enumerate(wip_items, start=1):
            findings: list[dict] = []
            url = item.get("detailUrl") or ""
            gp = labor_gp = parts_gp = gp_per_hour = 0.0
            profit_text = ""
            if not url:
                findings.append(audit_finding(
                    "ticket-link-missing", "review", "Ticket could not be opened",
                    "The WIP card was found, but Tekmetric did not expose its repair-order link. Review this RO manually."
                ))
            else:
                if "/estimate" not in url:
                    url = url.rstrip("/") + "/estimate"
                try:
                    log(f"Auditing WIP RO#{item['roNumber']} ({position}/{len(wip_items)})")
                    page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_timeout(1800)
                    estimate_text = page.locator("body").inner_text()
                    if diagnostic_or_tow_only(page):
                        log(f"Skipping WIP RO#{item['roNumber']}: diagnostic-only or diagnostic plus towing")
                        continue
                    if re.search(r"unbilled or partially unbilled parts", estimate_text, re.I):
                        findings.append(audit_finding(
                            "unbilled-parts", "critical", "Unbilled or partially unbilled parts",
                            "Tekmetric's Parts Hub warning is visible. Assign, return, or move these parts before posting."
                        ))
                    profit_text = profitability_modal_text(page)
                    gp = parse_percent(profit_text, "Gross Profit %")
                    labor_gp = parse_percent(profit_text, "Labor GP%")
                    parts_gp = parse_percent(profit_text, "Parts GP%")
                    gp_per_hour = parse_currency_metric(
                        profit_text, "GP/Hr", "GP / Hr", "GP per hour", "Gross Profit Per Hour"
                    )
                    if not profit_text:
                        findings.append(audit_finding(
                            "profitability-unavailable", "review", "Profitability data was not read",
                            "The ticket was opened, but its Profitability Analysis could not be read. This RO cannot be marked Good."
                        ))
                except Exception as ticket_exc:
                    findings.append(audit_finding(
                        "ticket-read-failed", "review", "Ticket review did not finish",
                        f"The reader opened this WIP RO but could not finish its profitability check: {str(ticket_exc)[:300]}"
                    ))
            if gp and gp < 58:
                findings.append(audit_finding("low-gp", "critical", f"Overall GP is {gp:.1f}%",
                    "Below the 58% minimum. Review pricing, discounts, labor rate, and parts markup."))
            elif gp and gp < 60:
                findings.append(audit_finding("gp-watch", "warning", f"Overall GP is {gp:.1f}%",
                    "Acceptable, but below the 60% target."))
            if parts_gp and parts_gp < 40:
                findings.append(audit_finding("low-parts-gp", "warning", f"Parts GP is {parts_gp:.1f}%",
                    "Review part cost, retail price, vendor credits, and quantities."))
            if labor_gp and labor_gp < 60:
                findings.append(audit_finding("low-labor-gp", "warning", f"Labor GP is {labor_gp:.1f}%",
                    "Review labor rate, billed hours, technician cost, and discounts."))
            if gp_per_hour and gp_per_hour < 170:
                findings.append(audit_finding("low-gp-per-hour", "warning", f"GP per hour is ${gp_per_hour:.2f}",
                    "Below the $170 target. Review billed time, labor rate, parts margin, and discounts."))
            # Review heuristics are deliberately phrased as recommendations, not proven errors.
            if re.search(r"\bParts\b", profit_text) and not re.search(r"\bLabor\b", profit_text):
                findings.append(audit_finding("possible-missed-labor", "review", "Possible missed labor",
                    "Parts are shown without a visible labor line. Confirm this is intentional."))
            duplicates: set[str] = set()
            for snapshot in profit_text.split("---READER-SNAPSHOT---"):
                labor_names = re.findall(r"(?m)^(.{5,100})\n(?:[A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+\n)?\s*\d+(?:\.\d+)?\s*\n", snapshot)
                normalized: dict[str, int] = {}
                for name in labor_names:
                    key = re.sub(r"[^a-z0-9 ]", "", name.lower()).strip()
                    if key:
                        normalized[key] = normalized.get(key, 0) + 1
                duplicates.update(name for name, count in normalized.items() if count > 1)
            if duplicates:
                findings.append(audit_finding("possible-labor-overlap", "review", "Possible labor overlap",
                    "The same labor description appears more than once in one profitability view. Confirm the operations and billed time do not overlap."))
            audits.append({
                "roNumber": item["roNumber"], "customer": item["customer"],
                "vehicle": item["vehicle"], "serviceWriter": item["serviceWriter"],
                "detailUrl": url, "grossProfitPercent": gp,
                "grossProfitPerHour": gp_per_hour,
                "laborGpPercent": labor_gp, "partsGpPercent": parts_gp,
                "findings": findings, "status": "review" if findings else "clear",
            })
        post_ticket_audits(config, audits)
        return len(audits)
    finally:
        page.close()


def sync_schedule_history(context, config: Config, manual: bool = False) -> int:
    """Archive Tekmetric's Day - Employee schedule once for the current hour."""
    page = context.new_page()
    appointments: dict[str, dict] = {}
    try:
        page.goto(SCHEDULE_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        if page.get_by_text("New Appointment", exact=True).count() == 0:
            shop = page.get_by_text("Delta Auto", exact=True)
            for index in range(shop.count()):
                if shop.nth(index).is_visible():
                    shop.nth(index).click()
                    page.wait_for_timeout(1000)
                    page.goto(SCHEDULE_URL, wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_timeout(2500)
                    break
        if page.get_by_text("New Appointment", exact=True).count() == 0:
            raise NeedsSignInError(
                "Tekmetric",
                "Tekmetric's Appointments schedule did not load. The shop computer may need someone to sign back in.",
            )

        # Match the view shown in the supplied recording: today's Day - Employee calendar.
        # The button usually says "Week" when the Appointments page first
        # opens. Click the current calendar view first, then choose the desired
        # view from its menu (matching the exact sequence in the recording).
        view_button = page.locator("button").filter(
            has_text=re.compile(r"^(?:Month|Week|Work Week|Day|Day - Color|Day - Employee|Agenda)$")
        )
        for index in range(view_button.count()):
            candidate = view_button.nth(index)
            if candidate.is_visible() and candidate.bounding_box() and candidate.bounding_box()["y"] < 260:
                candidate.click()
                page.wait_for_timeout(350)
                break
        menu_option = page.get_by_role("menuitem", name="Day - Employee", exact=True)
        if not menu_option.count():
            menu_option = page.get_by_text("Day - Employee", exact=True)
        for index in reversed(range(menu_option.count())):
            if menu_option.nth(index).is_visible():
                menu_option.nth(index).click()
                page.wait_for_timeout(900)
                break
        today = page.get_by_text("Today", exact=True)
        if today.count():
            for index in range(today.count()):
                if today.nth(index).is_visible():
                    today.nth(index).click()
                    page.wait_for_timeout(1200)
                    break

        def visible_cards() -> list[dict]:
            return page.evaluate(
                r"""() => {
                  const employeeNames = ["Unassigned", "Devin Corley", "MIKE COOK",
                    "Stacy Williams", "Beau Corley", "Mario Butler"];
                  const visible = el => {
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
                  };
                  const headers = employeeNames.map(name => {
                    const matches = Array.from(document.querySelectorAll("body *"))
                      .filter(el => visible(el) && (el.textContent || "").trim() === name);
                    const el = matches.sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return {name, x: r.left + r.width / 2};
                  }).filter(Boolean).sort((a,b) => a.x - b.x);
                  const timePattern = /\b\d{1,2}:\d{2}\s*(?:AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(?:AM|PM)\b/i;
                  const leaves = Array.from(document.querySelectorAll("body *")).filter(el => {
                    if (!visible(el) || !timePattern.test(el.textContent || "")) return false;
                    return !Array.from(el.children).some(child => timePattern.test(child.textContent || ""));
                  });
                  const results = [];
                  const seen = new Set();
                  for (const leaf of leaves) {
                    let card = leaf;
                    for (let i = 0; i < 7 && card.parentElement; i++) {
                      const style = getComputedStyle(card);
                      const r = card.getBoundingClientRect();
                      const colored = style.backgroundColor && !["rgba(0, 0, 0, 0)", "transparent", "rgb(255, 255, 255)"].includes(style.backgroundColor);
                      if (colored && r.width > 55 && r.height > 24) break;
                      card = card.parentElement;
                    }
                    const r = card.getBoundingClientRect();
                    if (r.width < 45 || r.height < 20 || r.width > 500) continue;
                    const text = (card.innerText || leaf.innerText || "").trim().replace(/\n{3,}/g, "\n\n");
                    const match = text.match(timePattern);
                    if (!match) continue;
                    const center = r.left + r.width / 2;
                    const employee = headers.length ? headers.reduce((best, item) =>
                      Math.abs(item.x - center) < Math.abs(best.x - center) ? item : best).name : "Unassigned";
                    const key = `${employee}|${match[0]}|${text}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const parts = match[0].split(/\s*-\s*/);
                    results.push({employee, startTime: parts[0], endTime: parts[1], text,
                      color: getComputedStyle(card).backgroundColor || ""});
                  }
                  return {employees: headers.map(item => item.name), appointments: results};
                }"""
            )

        # The calendar scrolls internally. Walk the tallest scrollable schedule pane
        # so afternoon appointments through 7 PM are included in the archive.
        page.evaluate("""() => {
          const candidates = Array.from(document.querySelectorAll("body *"))
            .filter(el => el.scrollHeight > el.clientHeight + 150 && el.clientHeight > 300);
          const pane = candidates.sort((a,b) => b.clientHeight - a.clientHeight)[0];
          if (pane) pane.setAttribute("data-reader-schedule-scroll", "1");
        }""")
        pane = page.locator("[data-reader-schedule-scroll='1']")
        scroll_positions = [0]
        if pane.count():
            maximum = int(pane.first.evaluate("el => Math.max(0, el.scrollHeight - el.clientHeight)"))
            scroll_positions = list(range(0, maximum + 1, 500))
            if maximum not in scroll_positions:
                scroll_positions.append(maximum)
        employees: list[str] = []
        for position in scroll_positions:
            if pane.count():
                pane.first.evaluate("(el, top) => el.scrollTop = top", position)
                page.wait_for_timeout(250)
            result = visible_cards()
            employees = result.get("employees") or employees
            for item in result.get("appointments", []):
                key = "|".join([item.get("employee", ""), item.get("startTime", ""), item.get("text", "")])
                appointments[key] = item

        local_now = datetime.now(CENTRAL_TIME)
        hour_key = f"{local_now.hour:02d}{local_now.minute:02d}" if manual else f"{local_now.hour:02d}00"
        hour_label = (local_now.strftime("%-I:%M %p") if os.name != "nt" else local_now.strftime("%#I:%M %p")) if manual else (local_now.strftime("%-I:00 %p") if os.name != "nt" else local_now.strftime("%#I:00 %p"))
        payload = {
            "scheduleDate": local_now.date().isoformat(),
            "hourKey": hour_key,
            "hourLabel": hour_label,
            "employees": employees,
            "appointments": list(appointments.values()),
            "rawText": page.locator("body").inner_text(),
            "capturedAt": datetime.now(timezone.utc).isoformat(),
        }
        post_schedule_snapshot(config, payload)
        page.evaluate("""() => {
          document.body.style.zoom = '0.62';
          const pane = document.querySelector("[data-reader-schedule-scroll='1']");
          if (pane) pane.scrollTop = 0;
          window.scrollTo(0, 0);
        }""")
        page.wait_for_timeout(500)
        image = page.screenshot(full_page=True, type="png")
        post_schedule_screenshot(config, payload["scheduleDate"], hour_key, image)
        return len(appointments)
    finally:
        page.close()


def read_estimate_page(page: Page) -> str:
    """Read the opened Tekmetric estimate directly while triggering lazy-rendered sections."""
    chunks: list[str] = []
    page.evaluate("window.scrollTo(0, 0)")
    for _ in range(45):
        chunks.append(page.locator("body").inner_text())
        before = page.evaluate("window.scrollY")
        page.evaluate("window.scrollBy(0, Math.max(500, window.innerHeight * .72))")
        page.wait_for_timeout(180)
        after = page.evaluate("window.scrollY")
        at_bottom = page.evaluate("window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 8")
        if at_bottom or after == before:
            chunks.append(page.locator("body").inner_text())
            break
    # Preserve virtualized content from each scroll position without sending
    # repeated identical page snapshots to the AI reviewer.
    return "\n---ESTIMATE VIEW---\n".join(dict.fromkeys(chunks))[:60000]


def warranty_value(text: str, patterns: tuple[str, ...]) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, re.I | re.M)
        if match:
            return re.sub(r"\s+", " ", match.group(1)).strip(" :-")
    return ""


def warranty_section(text: str, headings: tuple[str, ...], limit: int = 1200) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    for index, line in enumerate(lines):
        if any(re.fullmatch(heading, line, re.I) for heading in headings):
            values = []
            for value in lines[index + 1:index + 14]:
                if not value:
                    continue
                if re.fullmatch(r"(?:Technician|Customer|Finding|Media|Labor|Part|Fees|Discount|Summary|Inspections|Estimate|Payment).{0,20}", value, re.I):
                    if values:
                        break
                    continue
                values.append(value)
            return " ".join(values)[:limit]
    return ""


def warranty_tokens(text: str) -> set[str]:
    ignored = {"with", "from", "that", "this", "labor", "part", "parts", "total", "remove",
               "replace", "approved", "repair", "customer", "vehicle", "hours", "rate", "quantity"}
    return {word.lower() for word in re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", text)
            if word.lower() not in ignored}


def warranty_history_candidates(page: Page, current_ro: str, current_text: str) -> list[dict]:
    rows = page.evaluate(r"""() => {
      const results = [], seen = new Set();
      const nodes = Array.from(document.querySelectorAll('tr,[role="row"],a[href*="repair-orders"]'));
      for (const node of nodes) {
        const text = (node.innerText || node.textContent || '').trim().replace(/\n{3,}/g,'\n');
        const match = text.match(/(?:RO#?\s*)?(\d{4,})/i);
        if (!match || seen.has(match[1])) continue;
        const anchor = node.matches('a[href]') ? node : node.querySelector('a[href*="repair-orders"]');
        let url = anchor?.href || '';
        if (!url) {
          const roLeaf = Array.from(node.querySelectorAll('*')).find(el =>
            (el.textContent || '').replace(/\D/g,'') === match[1]);
          url = roLeaf?.closest('a[href]')?.href || '';
        }
        seen.add(match[1]);
        const date = text.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/)?.[0] || '';
        results.push({roNumber:match[1], date, text:text.slice(0,700), url});
      }
      return results;
    }""")
    current_number = int(current_ro) if str(current_ro).isdigit() else 0
    # An original warranty repair must predate the current RO. Never allow a
    # newer/higher invoice number to be selected as the original repair.
    rows = [item for item in rows
            if str(item.get("roNumber", "")).isdigit()
            and int(item["roNumber"]) < current_number]
    current_tokens = warranty_tokens(current_text)
    for item in rows:
        row_tokens = warranty_tokens(item.get("text", ""))
        item["score"] = len(current_tokens & row_tokens)
    return sorted(
        rows,
        key=lambda item: (item.get("score", 0), int(item.get("roNumber", 0))), reverse=True,
    )[:100]


def warranty_job_blocks(page: Page) -> list[dict]:
    """Read individual estimate job cards instead of treating the whole RO as
    one description. This prevents unrelated diagnostic jobs from leaking into
    the warranty claim."""
    return page.evaluate(r"""() => {
      const results = [], seen = new Set();
      const leaves = Array.from(document.querySelectorAll('body *')).filter(el => {
        const text = (el.textContent || '').trim();
        return el.children.length === 0 && /^(?:Approved|Declined) on /i.test(text);
      });
      for (const leaf of leaves) {
        let card = leaf.parentElement;
        for (let i = 0; i < 8 && card?.parentElement; i++) {
          const text = (card.innerText || '').trim();
          const decisions = (text.match(/(?:Approved|Declined) on /gi) || []).length;
          if (decisions === 1 && text.length >= 90 && text.length <= 7000 &&
              /\b(?:Labor|Part|Discount|GP%)\b/i.test(text)) break;
          card = card.parentElement;
        }
        if (!card) continue;
        const text = (card.innerText || '').trim().replace(/\n{3,}/g,'\n');
        if (!text || seen.has(text)) continue;
        seen.add(text);
        const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
        const decision = lines.findIndex(x => /^(?:Approved|Declined) on /i.test(x));
        const before = decision > 0 ? lines.slice(0, decision) : lines.slice(0, 4);
        const title = [...before].reverse().find(x =>
          x.length > 3 && x.length < 180 && !/^(?:REORDER|COLLAPSE|EXPAND|Job|Labor|Part)$/i.test(x)) || before[0] || '';
        results.push({title, text:text.slice(0,7000)});
      }
      return results;
    }""")


def pertinent_warranty_jobs(blocks: list[dict], reference_text: str = "") -> list[dict]:
    excluded = re.compile(
        r"\b(?:diagnos(?:is|tic|e)?|shake[- ]?down|inspection|testing?|check engine|"
        r"customer concern|visual check|scan codes?|tow(?:ing)?|wrecker|service writer|"
        r"service bulletin|manager|admin(?:istration)?)\b", re.I)
    repair_jobs = [block for block in blocks if not excluded.search(block.get("title", ""))]
    if not repair_jobs:
        return []
    if reference_text:
        reference = warranty_tokens(reference_text)
        scored = [(len(reference & warranty_tokens(block.get("text", ""))), block)
                  for block in repair_jobs]
        best = max((score for score, _ in scored), default=0)
        if best:
            # One warranty claim line should come from one best-matching job.
            # Pulling near matches brought battery/service-bulletin jobs into an
            # alternator claim.
            return [next(block for score, block in scored if score == best)]
    warranty_marked = [block for block in repair_jobs
                       if re.search(r"\bWarranty\b", block.get("text", ""), re.I)]
    return warranty_marked or repair_jobs


def warranty_note_from_jobs(job_text: str) -> str:
    notes = []
    for pattern in (
        r"(?:Technician (?:Note|Concern)|Cause of Failure|Failure (?:Description|Reason)|Diagnosis)\s*[:\n]+(.{8,700}?)(?=\n(?:Labor|Part|Discount|Fee|GP%|Job Total)\b|$)",
        r"\bNote\s*:\s*(.{8,500}?)(?=\n(?:Labor|Part|Discount|Fee|GP%|Job Total)\b|$)",
    ):
        notes.extend(re.findall(pattern, job_text, re.I | re.S))
    cleaned = [re.sub(r"\s+", " ", note).strip() for note in notes]
    return " · ".join(dict.fromkeys(cleaned))[:1600]


def clean_warranty_prose(value: str) -> str:
    if not value:
        return ""
    # Stop before Tekmetric's estimate controls when a DOM card boundary was
    # wider than expected.
    value = re.split(
        r"\b(?:REOPEN REPAIR ORDER|REORDER JOBS|REASSIGN LABOR\s*&\s*PARTS|"
        r"COLLAPSE ALL|EXPAND ALL|MANAGE\s+ADMIN|UNPOST)\b",
        value, maxsplit=1, flags=re.I,
    )[0]
    value = re.sub(r"\s+", " ", value).strip(" ·:-")
    if re.fullmatch(
        r"(?:No technician concerns found\.?|No concerns found\.?|None provided\.?|N/?A)",
        value, re.I,
    ):
        return ""
    return value[:1600]


def warranty_technician_diagnosis(page_text: str) -> str:
    """Read only Tekmetric's Technician Concerns section. The warranty
    diagnosis must not come from Customer Concerns or an estimate job title."""
    lines = [re.sub(r"\s+", " ", line).strip() for line in page_text.splitlines()]
    for index, line in enumerate(lines):
        if not re.fullmatch(r"Technician (?:Concerns?|Findings?|Diagnosis)", line, re.I):
            continue
        values = []
        for value in lines[index + 1:index + 12]:
            if not value:
                continue
            if re.fullmatch(
                r"(?:Customer Concerns?|Finding|Media|Vehicle Issues?|Jobs|Labor|Part|"
                r"REOPEN REPAIR ORDER|REORDER JOBS|COLLAPSE ALL|EXPAND ALL)",
                value, re.I,
            ):
                if values:
                    break
                continue
            values.append(value)
        diagnosis = clean_warranty_prose(" ".join(values))
        if diagnosis:
            return diagnosis
    return ""


def split_complaint_and_diagnosis(value: str) -> tuple[str, str]:
    value = clean_warranty_prose(value)
    if not value or re.search(r"\bNo customer concerns found\b", value, re.I):
        return "", ""
    sentences = [sentence.strip() for sentence in re.split(r"(?<=[.!?])\s+", value)
                 if sentence.strip()]
    diagnostic_start = re.compile(
        r"^(?:Performed|Verified|Inspection|Testing|Tested|Found|Measured|"
        r"Diagnostic|Based on|Further testing)", re.I)
    complaint_sentences, diagnostic_sentences = [], []
    in_diagnosis = False
    for sentence in sentences:
        if diagnostic_start.search(sentence):
            in_diagnosis = True
        (diagnostic_sentences if in_diagnosis else complaint_sentences).append(sentence)
    # Keep diagnostic evidence concise and limited to an observed failed
    # condition. Recommendations and unrelated good-test results add noise.
    failure_terms = re.compile(
        r"\b(?:fail(?:ed|ing|ure)?|not maintain|below|above|out of spec|"
        r"broken|cracked|leak(?:ing)?|worn|short(?:ed)?|open circuit|"
        r"excessive|no output|low voltage|high resistance|play|binding)\b", re.I)
    pertinent_diagnosis = [sentence for sentence in diagnostic_sentences
                            if failure_terms.search(sentence)][:2]
    complaint = " ".join(complaint_sentences[:2])[:900]
    diagnosis = " ".join(pertinent_diagnosis)[:900]
    return complaint, diagnosis


def explicit_part_numbers(job_text: str) -> list[str]:
    if not job_text:
        return []
    candidates = []
    # Tekmetric renders a part row as separate table cells. The part number is
    # normally the nearest short letter/number field before "NAPA Auto Parts".
    # Splitting on both newlines and tabs handles both the visible table and
    # Chromium's accessibility text representation.
    fields = [re.sub(r"\s+", " ", field).strip()
              for field in re.split(r"[\n\t]+", job_text) if field.strip()]
    for index, field in enumerate(fields):
        if not re.search(r"\bNAPA Auto Parts\b", field, re.I):
            continue
        for prior in reversed(fields[max(0, index - 8):index]):
            if re.fullmatch(r"(?:All\s+\d+\s+Received|Received|Inventory|Rear|Front)", prior, re.I):
                continue
            if re.fullmatch(r"[A-Z0-9][A-Z0-9./-]{2,24}", prior, re.I) and re.search(r"\d", prior):
                candidates.append(prior)
                break
    # Prefer a clearly labeled part number.
    candidates.extend(re.findall(
        r"\b(?:Part|Item|SKU)\s*#?\s*[:\-]?\s*([A-Z0-9][A-Z0-9./-]{2,24})\b",
        job_text, re.I,
    ))
    # Tekmetric puts the stock number on its own line directly below the part
    # description (for example: NAPA Brake Kit / 7418AXSGK8 / All 1 Received).
    candidates.extend(re.findall(
        r"(?:^|\n)Part\s*\n[^\n]{3,220}\n\s*([A-Z0-9][A-Z0-9./-]{2,24})\s*(?=\n)",
        job_text, re.I,
    ))
    candidates.extend(re.findall(
        r"\n\s*([A-Z0-9][A-Z0-9./-]{3,24})\s*\n\s*(?:All\s+\d+\s+Received|NAPA Auto Parts|Inventory)\b",
        job_text, re.I,
    ))
    # Tekmetric part rows often place the vendor/stock number on a line that
    # also contains NAPA/Inventory/Received and pricing.
    for line in job_text.splitlines():
        if not re.search(r"\b(?:NAPA|Inventory|Received|Quoted)\b", line, re.I):
            continue
        if not re.search(r"\$\d", line):
            continue
        tokens = re.findall(r"\b[A-Z0-9][A-Z0-9./-]{3,17}\b", line, re.I)
        for token in tokens:
            if re.search(r"\d", token) and not re.fullmatch(r"\d{1,4}", token):
                candidates.append(token)
    blocked = re.compile(
        r"^(?:MANAGE|ADMIN|UNPOST|REORDER|REASSIGN|LABOR|PARTS?|COLLAPSE|"
        r"TOTAL|MARIO|BUTLER|SUBLET|APPLIED|DIAGNOSTIC|APPROVED|DECLINED|"
        r"CUSTOMER|TECHNICIAN|TEKMETRIC)$", re.I)
    cleaned = []
    for candidate in candidates:
        candidate = candidate.strip(".,;:()[]")
        if blocked.fullmatch(candidate) or not re.search(r"\d", candidate):
            continue
        if re.fullmatch(r"\d+[.,]\d{2}", candidate) or re.fullmatch(r"\d{1,2}/\d{1,2}/\d{2,4}", candidate):
            continue
        if re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", candidate, re.I):
            continue
        if candidate not in cleaned:
            cleaned.append(candidate)
    return cleaned[:6]


def warranty_page_data(text: str, pertinent_text: str = "") -> dict:
    repair_text = pertinent_text or ""
    vin = warranty_value(text, (r"\bVIN\s*\n\s*([A-HJ-NPR-Z0-9]{17})", r"\b([A-HJ-NPR-Z0-9]{17})\b"))
    # Tekmetric displays these in the top-right RO header as
    # "In: 270,240 | Out: 270,240". NAPA needs the mileage at repair, so use
    # Out first and fall back to In when no Out mileage was entered.
    out_mileage = warranty_value(text, (
        r"\bOut\s*:\s*([\d,]+)",
        r"\bOut(?:going)?\s+Mileage\s*[:\n]\s*([\d,]+)",
    ))
    in_mileage = warranty_value(text, (
        r"\bIn\s*:\s*([\d,]+)",
        r"\bIn(?:coming)?\s+Mileage\s*[:\n]\s*([\d,]+)",
    ))
    mileage = out_mileage or in_mileage or warranty_value(text, (
        r"Odometer\s*:\s*([^\n|]+)", r"Mileage\s*[:\n]\s*([\d,]+)",
    ))
    date = warranty_value(text, (
        r"(?:Posted|Completed|Approved)\s+(?:on\s+)?([A-Z][a-z]+\s+\d{1,2},\s*20\d{2})",
        r"\b(\d{1,2}\/\d{1,2}\/20\d{2})\b",
    ))
    labor_rate = currency(warranty_value(text, (r"Labor Rate\s*\$?([\d,.]+)",)))
    complaint_raw = warranty_section(text, (r"Customer concerns?", r"Customer complaint"))
    complaint, _diagnosis_from_concern = split_complaint_and_diagnosis(complaint_raw)
    # Tekmetric's Technician Concerns field is the authoritative diagnosis.
    # A note inside the matched warranty job is the fallback. Never substitute
    # the customer's complaint as a technician diagnosis.
    technician = (
        warranty_technician_diagnosis(text)
        or clean_warranty_prose(warranty_note_from_jobs(repair_text))
    )
    # Prefer the matched job card, but fall back to the complete original
    # estimate. Some posted ROs virtualize the Part table outside the DOM node
    # containing the job's Approved line.
    part_numbers = explicit_part_numbers(repair_text) or explicit_part_numbers(text)
    # Posted Tekmetric labor rows are description, technician, hours, rate,
    # total. Sum those rows instead of looking for an ASSIGN control.
    labor_text = re.split(r"\n\s*Part\s*\n", repair_text, maxsplit=1, flags=re.I)[0]
    labor_rows = re.findall(
        r"\n\s*(\d+(?:\.\d+)?)\s*\n\s*\$(\d[\d,]*\.\d{2})\s*\n\s*\$(\d[\d,]*\.\d{2})(?=\s*(?:\n|$))",
        labor_text,
    )
    labor_hours = round(sum(number(row[0]) for row in labor_rows), 2)
    labor_amount = round(sum(currency(row[2]) for row in labor_rows), 2)
    quantities = []
    for value in re.findall(
        r"(?:All\s+\d+\s+Received|NAPA Auto Parts|Inventory)[^\n]*\n\s*(\d+(?:\.\d+)?)\s*\n\s*\$\d[\d,]*\.\d{2}",
        repair_text, re.I,
    ):
        if value not in quantities:
            quantities.append(value)
    original_repair_lines = []
    for line in repair_text.splitlines():
        cleaned = re.sub(r"\s+", " ", line).strip()
        if re.search(r"Remove\s*&?\s*Replace|Repair|Service|Flush|Install", cleaned, re.I) and len(cleaned) < 220:
            original_repair_lines.append(cleaned)
    original_repair = " · ".join(dict.fromkeys(original_repair_lines))[:2500]
    return {
        "vin": vin, "mileage": mileage, "date": date, "laborRate": labor_rate,
        "complaint": complaint, "diagnosis": technician, "partNumbers": part_numbers,
        "laborHours": labor_hours, "repair": original_repair,
        "laborAmount": labor_amount, "quantities": quantities,
    }


def napa_invoice_lookup(context, part_numbers: list[str], original_ro: str) -> list[dict]:
    """Search PROLink by Part # and only accept a row whose PO matches the
    original Tekmetric RO, exactly following the shop's demonstrated process."""
    if not part_numbers or not original_ro:
        log(
            "Warranty NAPA invoice lookup skipped: "
            + ("no Tekmetric part number was read" if not part_numbers else "no original RO was matched")
        )
        return []
    page = next((candidate for candidate in context.pages
        if "napaprolink.com" in candidate.url and not candidate.is_closed()), None)
    page = page or context.new_page()
    leave_open_for_signin = False
    matches = []
    try:
        page.goto("https://pro.napaprolink.com/my-account/invoices", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1800)
        if not re.search(r"\bInvoices\b", page.locator("body").inner_text(timeout=10000), re.I):
            leave_open_for_signin = True
            raise NeedsSignInError(
                "NAPA",
                "NAPA PROLink needs sign-in. Its browser tab has been left open so you can sign in.",
            )
        for part_number in part_numbers[:6]:
            log(f"Warranty NAPA lookup: Part #{part_number}, PO #{original_ro}")
            try:
                page.get_by_text(re.compile(r"^(?:Invoice|Purchase Order|Part)\s*#$", re.I)).first.click(timeout=3000)
                page.get_by_text(re.compile(r"^Part\s*#$", re.I), exact=True).last.click(timeout=3000)
            except Exception:
                try:
                    page.locator("select").first.select_option(label="Part #")
                except Exception:
                    pass
            search_inputs = page.locator(
                'input:not(#vendor-search-handler)[placeholder*="Search" i]:visible'
            )
            if not search_inputs.count():
                raise RuntimeError("NAPA's visible invoice-search box was not found")
            search = search_inputs.last
            search.fill(part_number)
            clicked = search.evaluate(r"""input => {
              let node = input.parentElement;
              for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
                const controls = Array.from(node.querySelectorAll('button,[role="button"]'));
                const control = controls[controls.length - 1];
                if (control && control !== input && !(control.contains(input))) {
                  control.click();
                  return true;
                }
              }
              return false;
            }""")
            if not clicked:
                search.press("Enter")
            try:
                page.wait_for_function(
                    r"ro => document.body.innerText.includes(ro) && !/Loading\.\.\./i.test(document.body.innerText)",
                    str(original_ro), timeout=10000,
                )
            except Exception:
                page.wait_for_timeout(1800)
            rows = page.evaluate(r"""ro => {
              const results = [];
              for (const row of document.querySelectorAll('tr,[role="row"]')) {
                const text = (row.innerText || '').trim();
                if (text) results.push({text});
              }
              for (const leaf of Array.from(document.querySelectorAll('body *')).filter(el =>
                el.children.length === 0 && (el.textContent || '').trim() === ro)) {
                let node = leaf.parentElement;
                for (let depth = 0; depth < 7 && node; depth++, node = node.parentElement) {
                  const text = (node.innerText || '').trim();
                  if (text.includes('$') && text.length < 1200) {
                    results.push({text});
                    break;
                  }
                }
              }
              return results;
            }""", str(original_ro))
            for row in rows:
                row_text = re.sub(r"\s+", " ", str(row.get("text", ""))).strip()
                if not re.search(rf"\b{re.escape(str(original_ro))}\b", row_text):
                    continue
                invoice_numbers = [value for value in re.findall(r"\b\d{5,}\b", row_text)
                    if value != str(original_ro)]
                if not invoice_numbers:
                    continue
                match = {"partNumber": part_number, "invoiceNumber": invoice_numbers[0], "poNumber": str(original_ro)}
                if match not in matches:
                    matches.append(match)
                    log(f"Warranty NAPA match: Part #{part_number}, invoice #{invoice_numbers[0]}, PO #{original_ro}")
                break
            if not any(item["partNumber"] == part_number for item in matches):
                body_text = page.locator("body").inner_text(timeout=10000)
                debug = {
                    "url": page.url,
                    "partNumber": part_number,
                    "originalRo": str(original_ro),
                    "rows": rows[:50],
                    "pageText": body_text[:20000],
                }
                (ROOT / "napa-invoice-debug.json").write_text(
                    json.dumps(debug, indent=2), encoding="utf-8")
                page.screenshot(path=str(ROOT / "napa-invoice-debug.png"), full_page=True)
                log(f"Warranty NAPA lookup found no invoice for Part #{part_number} / PO #{original_ro}; saved napa-invoice-debug files")
        return matches
    except NeedsSignInError:
        raise
    except Exception as exc:
        log(f"Warranty NAPA invoice lookup failed: {exc}")
        return matches
    finally:
        if not leave_open_for_signin and not page.is_closed():
            page.close()


def sync_warranty_claims(context, config: Config, repair_orders: list[dict]) -> int:
    tagged = [item for item in repair_orders if item.get("section") == "completed" and
        re.search(r"Need(?:s)?\s+(?:Ext\.?\s+Warr(?:anty)?|Warranty)\s+(?:Payment|Pmt)", item.get("rawText", ""), re.I)]
    if not tagged:
        post_warranty_claims(config, [])
        return 0
    claims = []
    part_debug_saved = False
    overrides = get_warranty_overrides(config)
    page = context.new_page()
    try:
        for position, item in enumerate(tagged, start=1):
            url = item.get("detailUrl") or ""
            if not url:
                log(f"Warranty claim RO#{item.get('roNumber')} has no openable Tekmetric link")
                continue
            base_url = re.sub(r"/(?:summary|estimate|work-in-progress|payment)(?:/.*)?$", "", url.rstrip("/"))
            current_url = base_url + "/estimate"
            log(f"Reading warranty claim RO#{item['roNumber']} ({position}/{len(tagged)})")
            page.goto(current_url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(1400)
            current_text = read_estimate_page(page)
            current_blocks = warranty_job_blocks(page)
            current_jobs = pertinent_warranty_jobs(current_blocks)
            current_job_text = "\n---WARRANTY JOB---\n".join(
                block.get("text", "") for block in current_jobs)
            current = warranty_page_data(current_text, current_job_text)

            history_url = base_url + "/summary/job-history"
            page.goto(history_url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(1500)
            candidates = warranty_history_candidates(
                page, item["roNumber"], current_job_text or " ".join(filter(None, [
                    current.get("complaint", ""), current.get("diagnosis", "")
                ])))
            original = {}
            referenced_match = re.search(
                r"\bREFER(?:ENCE)?\s*(?:TO\s*)?RO\s*#?\s*(\d{4,})\b",
                current_text, re.I,
            )
            desired_original = overrides.get(str(item["roNumber"])) or (
                referenced_match.group(1) if referenced_match else "")
            original_candidate = None
            if desired_original and int(desired_original) < int(item["roNumber"]):
                original_candidate = next((candidate for candidate in candidates
                    if str(candidate.get("roNumber")) == desired_original and candidate.get("url")), None)
            if not desired_original and not original_candidate:
                original_candidate = next((candidate for candidate in candidates
                    if candidate.get("url") and candidate.get("score", 0) >= 2), None)
            if not desired_original and not original_candidate:
                # A current warranty RO is sometimes only a zero-dollar shell,
                # leaving no job words to score. In that case use the newest
                # lower RO containing an approved/posted job on this vehicle.
                original_candidate = next((candidate for candidate in candidates
                    if candidate.get("url") and re.search(
                        r"\b(?:Approved|Posted|Paid)\b", candidate.get("text", ""), re.I)), None)
                original_candidate = original_candidate or next((candidate for candidate in candidates
                    if candidate.get("url")), None)
            if not original_candidate and not part_debug_saved:
                (ROOT / "warranty-part-number-debug.txt").write_text(
                    "\n".join([
                        f"Current RO: {item['roNumber']}",
                        "Original RO: NOT MATCHED", "",
                        "--- CURRENT WARRANTY JOB TEXT ---", current_job_text,
                        "", "--- JOB HISTORY CANDIDATES ---",
                        json.dumps(candidates, indent=2),
                        "", "--- CURRENT ESTIMATE TEXT ---", current_text,
                    ]), encoding="utf-8")
                page.screenshot(
                    path=str(ROOT / "warranty-part-number-debug.png"),
                    full_page=True,
                )
                part_debug_saved = True
                log("Warranty original RO was not matched; saved warranty-part-number-debug files")
            if original_candidate:
                original_base = re.sub(r"/(?:summary|estimate|work-in-progress|payment)(?:/.*)?$", "", original_candidate["url"].rstrip("/"))
                original_candidate["url"] = original_base + "/estimate"
                page.goto(original_candidate["url"], wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(1200)
                original_text = read_estimate_page(page)
                original_blocks = warranty_job_blocks(page)
                original_jobs = pertinent_warranty_jobs(
                    original_blocks, current_job_text)
                original_job_text = "\n---MATCHED ORIGINAL JOB---\n".join(
                    block.get("text", "") for block in original_jobs)
                original = warranty_page_data(original_text, original_job_text)
                if not original.get("partNumbers") and not part_debug_saved:
                    (ROOT / "warranty-part-number-debug.txt").write_text(
                        "\n".join([
                            f"Current RO: {item['roNumber']}",
                            f"Original RO: {original_candidate.get('roNumber', '')}",
                            "", "--- MATCHED JOB TEXT ---", original_job_text,
                            "", "--- FULL ORIGINAL ESTIMATE TEXT ---", original_text,
                        ]), encoding="utf-8")
                    page.screenshot(
                        path=str(ROOT / "warranty-part-number-debug.png"),
                        full_page=True,
                    )
                    part_debug_saved = True
                    log("Warranty part number was not read; saved warranty-part-number-debug files")

            napa_matches = napa_invoice_lookup(
                context,
                original.get("partNumbers", []),
                original_candidate.get("roNumber", "") if original_candidate else "",
            )

            diagnosis = current.get("diagnosis", "")
            if re.search(
                r"\b(?:REOPEN REPAIR ORDER|REORDER JOBS|REASSIGN LABOR|COLLAPSE ALL|"
                r"MANAGE ADMIN|UNPOST|No technician concerns found|Approved on)\b",
                diagnosis, re.I,
            ):
                diagnosis = ""
            complaint = current.get("complaint", "")
            original_repair = original.get("repair", "")
            if re.search(r"\b(?:MANAGE ADMIN|REORDER|REASSIGN|COLLAPSE|UNPOST)\b", original_repair, re.I):
                original_repair = ""
            failed_part = ", ".join(original.get("partNumbers", [])[:3]) or (
                f"component repaired on original RO#{original_candidate.get('roNumber')}"
                if original_candidate else "component"
            )
            if diagnosis:
                failure_draft = (
                    f"Customer returned reporting {complaint or 'a concern with the prior repair'}. "
                    f"Inspection and testing documented: {diagnosis}. "
                    f"The previously installed {failed_part or 'component'} is not performing as intended and requires corrective replacement."
                )
            else:
                failure_draft = "Technician diagnosis is missing. Document the observed defect, tests performed, and why the previously installed component failed before filing."
            missing = []
            required = {
                "VIN": current.get("vin"), "original paid RO": original_candidate,
                "original repair date": original.get("date"), "original mileage": original.get("mileage"),
                "subsequent repair date": current.get("date"), "subsequent mileage": current.get("mileage"),
                "part number": original.get("partNumbers"), "NAPA invoice": napa_matches,
                "customer complaint": complaint,
                "technician failure diagnosis": diagnosis,
            }
            missing.extend(label for label, value in required.items() if not value)
            source_text = "|".join([
                current_job_text, json.dumps(candidates), json.dumps(original, sort_keys=True)
            ])
            claims.append({
                "roNumber": item["roNumber"], "customer": item.get("customer", ""),
                "phone": item.get("phone", ""), "email": "", "vehicle": item.get("vehicle", ""),
                "vin": current.get("vin", ""), "currentRoUrl": current_url,
                "originalRoNumber": original_candidate.get("roNumber", "") if original_candidate else "",
                "originalRoUrl": original_candidate.get("url", "") if original_candidate else "",
                "currentRepairDate": current.get("date", ""), "currentMileage": current.get("mileage", ""),
                "originalRepairDate": original.get("date", ""), "originalMileage": original.get("mileage", ""),
                "originalLaborRate": original.get("laborRate", 0), "originalLaborAmount": original.get("laborAmount", 0),
                "partNumbers": original.get("partNumbers", []),
                "quantities": original.get("quantities", []), "napaInvoices": napa_matches,
                "laborHours": current.get("laborHours", 0) or original.get("laborHours", 0),
                "partStore": "NAPA Auto Parts" if re.search(r"NAPA Auto Parts", source_text, re.I) else "",
                "customerComplaint": complaint, "originalRepair": original_repair,
                "failureSymptoms": complaint, "diagnosis": diagnosis, "failureDraft": failure_draft,
                "missingFields": missing, "candidatePreviousRos": candidates,
                "evidenceNotes": "Attach both Tekmetric invoices and any technician photos or test results.",
                "serviceWriter": item.get("serviceWriter", "Unassigned"),
                "sourceHash": hashlib.sha256(source_text.encode("utf-8", "ignore")).hexdigest(),
            })
        result = post_warranty_claims(config, claims)
        log(f"Warranty claims: {result.get('saved', 0)} saved from {len(tagged)} tagged completed ROs")
        return len(claims)
    finally:
        page.close()


def sync_delta_ai_estimates(context, config: Config, repair_orders: list[dict]) -> int:
    """Open and submit only WIP estimates carrying the exact Delta AI RO tag."""
    tagged = [item for item in repair_orders
        if item.get("section") == "work-in-progress"
        and re.search(r"(?:^|\n)\s*Delta AI\s*(?:$|\n)", item.get("rawText", ""), re.I)]
    active_numbers = [str(item.get("roNumber", "")) for item in tagged if item.get("roNumber")]
    estimates: list[dict] = []
    page = context.new_page()
    try:
        for position, item in enumerate(tagged, start=1):
            url = item.get("detailUrl") or ""
            if not url:
                log(f"Delta AI RO#{item.get('roNumber')} has no openable Tekmetric link")
                continue
            if "/estimate" not in url:
                url = url.rstrip("/") + "/estimate"
            log(f"Reading Delta AI estimate RO#{item['roNumber']} ({position}/{len(tagged)})")
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(1800)
            estimate_text = read_estimate_page(page)
            estimates.append({
                "roNumber": item["roNumber"], "customer": item.get("customer", ""),
                "vehicle": item.get("vehicle", ""), "serviceWriter": item.get("serviceWriter", "Unassigned"),
                "detailUrl": url, "estimateText": estimate_text,
            })
        result = post_delta_ai_estimates(config, estimates, active_numbers)
        log(f"Delta AI: {result.get('reviewed', 0)} reviewed, {result.get('unchanged', 0)} unchanged, {len(tagged)} tagged")
        return len(tagged)
    finally:
        page.close()


def sync_job_board(context, config: Config, run_ticket_audit: bool = False) -> int:
    page = context.new_page()
    collected: dict[str, dict] = {}
    try:
        page.goto(JOB_BOARD_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)
        if page.get_by_text("Job Board", exact=True).count() == 0:
            shop = page.get_by_text("Delta Auto", exact=True)
            for index in range(shop.count()):
                if shop.nth(index).is_visible():
                    shop.nth(index).click()
                    page.wait_for_timeout(1000)
                    page.goto(JOB_BOARD_URL, wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_timeout(2500)
                    break
        if page.get_by_text("Job Board", exact=True).count() == 0:
            raise RuntimeError("Tekmetric's Job Board could not be opened.")
        page.evaluate(
            """() => {
              document.querySelectorAll("[data-reader-job-column]")
                .forEach(el => el.removeAttribute("data-reader-job-column"));
              const links = Array.from(document.querySelectorAll("a,button,div,span"))
                .filter(el => /^RO#\\d+$/.test((el.textContent || "").trim()));
              const panes = [];
              for (const link of links) {
                let node = link.parentElement;
                while (node && node !== document.body) {
                  const rect = node.getBoundingClientRect();
                  if (node.scrollHeight > node.clientHeight + 60 &&
                      node.clientHeight > 250 && rect.width > 250 && rect.width < 800) {
                    if (!panes.includes(node)) panes.push(node);
                    break;
                  }
                  node = node.parentElement;
                }
              }
              const distinct = panes
                .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
                .filter((pane, index, all) => index === 0 ||
                  Math.abs(pane.getBoundingClientRect().x -
                    all[index - 1].getBoundingClientRect().x) > 100);
              distinct.slice(0, 3).forEach((el, index) =>
                el.setAttribute("data-reader-job-column", String(index)));
            }"""
        )
        columns = page.locator("[data-reader-job-column]")
        if columns.count() < 3:
            (ROOT / "job-board-debug.txt").write_text(
                page.locator("body").inner_text(), encoding="utf-8"
            )
            raise RuntimeError("The three Job Board columns could not be identified.")
        for column_index in range(columns.count()):
            column = columns.nth(column_index)
            column.evaluate("(el) => el.scrollTop = 0")
            page.wait_for_timeout(250)
            while True:
                for raw in extract_visible_job_cards(page):
                    item = parse_job_card(raw)
                    if item:
                        collected[f"{item['section']}:{item['roNumber']}"] = item
                before = column.evaluate("(el) => el.scrollTop")
                column.evaluate("(el) => el.scrollTop += Math.max(el.clientHeight * .8, 350)")
                page.wait_for_timeout(350)
                after = column.evaluate("(el) => el.scrollTop")
                at_bottom = column.evaluate(
                    "(el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 5"
                )
                if at_bottom or after == before:
                    for raw in extract_visible_job_cards(page):
                        item = parse_job_card(raw)
                        if item:
                            collected[f"{item['section']}:{item['roNumber']}"] = item
                    break
        if not collected:
            raise RuntimeError(
                "The Job Board opened but no repair-order cards could be parsed."
            )
        repair_orders = list(collected.values())
        post_job_board(config, repair_orders)
        try:
            sync_delta_ai_estimates(context, config, repair_orders)
        except Exception as delta_ai_exc:
            log(f"Delta AI estimate review failed: {delta_ai_exc}")
        try:
            sync_warranty_claims(context, config, repair_orders)
        except Exception as warranty_exc:
            log(f"Warranty claim sync failed: {warranty_exc}")
        if run_ticket_audit:
            try:
                wip_total = sum(1 for item in repair_orders if item.get("section") == "work-in-progress")
                wip_links = sum(1 for item in repair_orders
                    if item.get("section") == "work-in-progress" and item.get("detailUrl"))
                log(f"WIP link check: {wip_links} of {wip_total} tickets have an openable Tekmetric URL")
                audit_count = audit_wip_tickets(context, config, repair_orders)
                log(f"Audited {audit_count} current Work-in-Progress repair orders")
            except Exception as audit_exc:
                log(f"Daily ticket audit failed: {audit_exc}")
        return len(collected)
    finally:
        page.close()


def classify_customer(name: str) -> str:
    """Conservative first pass; uncertain records stay personal for review."""
    business_terms = re.compile(
        r"\b(LLC|INC|CORP|CO\.?|COMPANY|TOWING|ELECTRIC|PLUMBING|CONSTRUCTION|"
        r"COUNTY|CITY OF|POLICE|SHERIFF|SCHOOL|CHURCH|FARMS?|SERVICES?|TRUCKING|"
        r"LOGISTICS|LANDSCAPING|ROOFING|HVAC|ENTERPRISE|RENTAL)\b",
        re.IGNORECASE,
    )
    return "business" if business_terms.search(name) else "personal"


def extract_steer_page(page: Page) -> list[dict]:
    # Every opportunity row has one Call Guide button. Find the nearest
    # reasonably-sized ancestor for each button instead of depending on
    # Steer's generated CSS class names.
    return page.get_by_text("Call Guide", exact=True).evaluate_all(
        """guides => guides.map(guide => {
          let row = guide;
          while (row.parentElement && row.parentElement.innerText.length < 900) {
            const parent = row.parentElement;
            const guideCount = parent.querySelectorAll("button, a").length;
            const text = parent.innerText || "";
            row = parent;
            if (text.includes("Last Visit:") && text.includes("Call Guide") && guideCount >= 1) break;
          }
          return (row.innerText || "").trim();
        })"""
    )


def parse_steer_row(text: str) -> dict | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return None
    phone_match = re.search(r"\(\d{3}\)\s*\d{3}-\d{4}", text)
    last_visit_match = re.search(r"Last Visit:\s*([^\n]+)", text, re.IGNORECASE)
    heat = len(re.findall(r"🔥", text))
    signals = [
        line for line in lines
        if any(token in line for token in ("Svc Due", "Last Appt", "Since Last Visit", "Maint. Svc"))
    ]
    ignored = re.compile(r"^(Call Guide|More \(\d+\)|Last Visit:|\(\d{3}\))", re.IGNORECASE)
    content = [line for line in lines if not ignored.search(line) and "🔥" not in line]
    if len(content) < 2:
        return None
    customer = content[0]
    vehicle = content[1]
    opportunity_key = hashlib.sha1(
        f"{customer}|{vehicle}|{phone_match.group(0) if phone_match else ''}".encode("utf-8")
    ).hexdigest()
    return {
        "key": opportunity_key,
        "customer": customer,
        "vehicle": vehicle,
        "phone": phone_match.group(0) if phone_match else "",
        "lastVisit": last_visit_match.group(1).strip() if last_visit_match else "",
        "heat": heat,
        "signals": signals[:6],
        "recommendedServices": [
            signal for signal in signals
            if "svc" in signal.lower() or "service" in signal.lower()
        ][:6],
        "customerType": classify_customer(customer),
    }


def collect_steer_current_page(page: Page) -> list[dict]:
    """Collect every virtualized row by scrolling Steer's list container."""
    page.evaluate(
        """() => {
          document.querySelectorAll("[data-reader-steer-scroll]")
            .forEach(el => el.removeAttribute("data-reader-steer-scroll"));
          const guide = Array.from(document.querySelectorAll("button,a,div,span"))
            .find(el => (el.textContent || "").trim() === "Call Guide");
          let node = guide;
          while (node && node !== document.body) {
            if (node.scrollHeight > node.clientHeight + 100 && node.clientHeight > 250) {
              node.setAttribute("data-reader-steer-scroll", "true");
              return;
            }
            node = node.parentElement;
          }
          document.scrollingElement?.setAttribute("data-reader-steer-scroll", "true");
        }"""
    )
    scroll = page.locator("[data-reader-steer-scroll]").first
    if scroll.count() == 0:
        return extract_steer_page(page)
    collected: dict[str, dict] = {}
    scroll.evaluate("(el) => el.scrollTop = 0")
    page.wait_for_timeout(250)
    while True:
        for raw in extract_steer_page(page):
            item = parse_steer_row(raw)
            if item:
                collected[item["key"]] = item
        before = scroll.evaluate("(el) => el.scrollTop")
        scroll.evaluate("(el) => el.scrollTop += Math.max(el.clientHeight * .8, 350)")
        page.wait_for_timeout(300)
        after = scroll.evaluate("(el) => el.scrollTop")
        at_bottom = scroll.evaluate(
            "(el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 5"
        )
        if at_bottom or after == before:
            for raw in extract_steer_page(page):
                item = parse_steer_row(raw)
                if item:
                    collected[item["key"]] = item
            break
    return list(collected.values())


def dismiss_steer_pendo(page: Page) -> None:
    """Remove Steer's Pendo walkthrough/lightbox when it blocks the call-list
    pagination controls. Pendo is only an onboarding overlay, not shop data."""
    page.evaluate(r"""() => {
      document.querySelectorAll('#pendo-base, ._pendo-step-container, [id^="pendo-guide-"]')
        .forEach(element => element.remove());
      document.querySelectorAll('[class*="pendo-backdrop"], [class*="pendo-overlay"]')
        .forEach(element => element.remove());
    }""")


def sync_steer(context, config: Config) -> int:
    page = next((candidate for candidate in context.pages
        if "steercrm.com" in candidate.url and not candidate.is_closed()), None)
    page = page or context.new_page()
    leave_open_for_signin = False
    collected: dict[str, dict] = {}
    try:
        page.goto(STEER_HOT_LIST_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        if "app.steercrm.com" not in page.url or page.get_by_text("Today’s Call List", exact=True).count() == 0:
            # Same reasoning as the Tekmetric sign-in check above: never block
            # on input() waiting for someone at the shop computer. Report and
            # retry next cycle instead.
            leave_open_for_signin = True
            raise NeedsSignInError(
                "Steer",
                "Steer's Opportunity Hub did not load Today's Call List. The "
                "shop computer likely needs someone to sign back into Steer "
                "in the open browser window.",
            )

        # Enforce 100 items per page even if Steer discarded the query string.
        dismiss_steer_pendo(page)
        hundred = page.get_by_text("100", exact=True)
        for index in range(hundred.count() - 1, -1, -1):
            item = hundred.nth(index)
            if item.is_visible():
                item.click(force=True)
                page.wait_for_timeout(1800)
                break

        current_page = 1
        while True:
            page.wait_for_selector("text=Call Guide", timeout=30000)
            page_items = collect_steer_current_page(page)
            for item in page_items:
                collected[item["key"]] = item
            log(
                f"Steer page {current_page}: {len(page_items)} opportunities; "
                f"{len(collected)} unique total"
            )

            # Steer renders the paginator arrow as a clickable div, not a
            # button. Target its stable class fragment so the nearby Pendo
            # notification badge can never be mistaken for Next.
            next_arrow = page.locator("[class*='Paginate__arrow_next']")
            next_control = next_arrow.last if next_arrow.count() else None
            if next_control is None:
                break
            next_class = next_control.get_attribute("class") or ""
            aria_disabled = next_control.get_attribute("aria-disabled")
            if "disabled" in next_class.lower() or aria_disabled == "true":
                break
            before = page.url
            dismiss_steer_pendo(page)
            next_control.click(force=True)
            current_page += 1
            page.wait_for_timeout(1600)
            if page.url == before and current_page > 1:
                active = page.get_by_text(str(current_page), exact=True)
                if active.count() == 0:
                    break
            if current_page > 50:
                raise RuntimeError("Steer pagination exceeded its safety limit.")

        post_opportunities(config, list(collected.values()))
        return len(collected)
    finally:
        if not leave_open_for_signin and not page.is_closed():
            page.close()


def sync_once(page: Page, config: Config) -> None:
    now = datetime.now(timezone.utc)
    local_date = now.astimezone(CENTRAL_TIME).date()
    week_start = local_date - timedelta(days=(local_date.weekday() - 2) % 7)
    week_end = week_start + timedelta(days=6)
    last_week_start = week_start - timedelta(days=7)
    last_week_end = week_start - timedelta(days=1)

    # Set the main tab to the calculated Wednesday-through-Tuesday Custom range.
    open_reports(page)
    open_end_of_day(page)
    select_custom_range(page, week_start, week_end)
    weekly_financials = extract_end_of_day(page)
    weekly_technicians, _technician_report_car_count = extract_technicians(
        page, week_start, week_end
    )
    weekly_writers = extract_service_writers(page)
    weekly_payload = {
        "period": "weekly",
        "startDate": week_start.isoformat(),
        "endDate": week_end.isoformat(),
        **weekly_financials,
        "carCount": weekly_financials["totalROs"],
        "technicians": weekly_technicians,
        "capturedAt": now.isoformat(),
    }
    post_snapshot(config, weekly_payload)
    post_service_writers(config, "weekly", week_start, week_end, weekly_writers)

    # Use a separate tab for Today so changing the preset never disturbs the
    # manually configured Wednesday-through-Tuesday report in the main tab.
    daily_page = page.context.new_page()
    try:
        open_reports(daily_page)
        open_end_of_day(daily_page)
        select_report_period(daily_page, "Today")
        daily_financials = extract_end_of_day(daily_page)
        daily_technicians, _daily_car_count = extract_technicians(
            daily_page, local_date, local_date
        )
        daily_writers = extract_service_writers(daily_page)
        daily_payload = {
            "period": "daily",
            "startDate": local_date.isoformat(),
            "endDate": local_date.isoformat(),
            **daily_financials,
            "carCount": daily_financials["totalROs"],
            "technicians": daily_technicians,
            "capturedAt": now.isoformat(),
        }
        post_snapshot(config, daily_payload)
        post_service_writers(config, "daily", local_date, local_date, daily_writers)
    finally:
        daily_page.close()

    # Previous Wednesday-through-Tuesday range for every historical dashboard
    # card and scorecard. This is live Tekmetric data, not sample data.
    last_week_page = page.context.new_page()
    try:
        open_reports(last_week_page)
        open_end_of_day(last_week_page)
        select_custom_range(last_week_page, last_week_start, last_week_end)
        last_week_financials = extract_end_of_day(last_week_page)
        last_week_technicians, _last_week_car_count = extract_technicians(
            last_week_page, last_week_start, last_week_end
        )
        last_week_writers = extract_service_writers(last_week_page)
        last_week_payload = {
            "period": "last_week",
            "startDate": last_week_start.isoformat(),
            "endDate": last_week_end.isoformat(),
            **last_week_financials,
            "carCount": last_week_financials["totalROs"],
            "technicians": last_week_technicians,
            "capturedAt": now.isoformat(),
        }
        post_snapshot(config, last_week_payload)
        post_service_writers(
            config, "last_week", last_week_start, last_week_end, last_week_writers
        )
    finally:
        last_week_page.close()

    log(
        f"Synced weekly sales ${weekly_financials['totalSales']:,.2f} and "
        f"today sales ${daily_financials['totalSales']:,.2f} and "
        f"last week sales ${last_week_financials['totalSales']:,.2f}; "
        f"{len(weekly_technicians)} technicians. "
        f"Last week hours: "
        + ", ".join(
            f"{item['name']} {item['billedHours']:.2f}"
            for item in last_week_technicians
        )
    )


def run(config: Config) -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            str(PROFILE_PATH),
            headless=False,
            channel="chrome",
            viewport={"width": 1500, "height": 980},
        )
        page = context.pages[0] if context.pages else context.new_page()
        last_steer_sync: datetime | None = None
        last_ticket_audit_sync: datetime | None = None
        last_vehicle_history_sync: datetime | None = None
        last_schedule_hour_key: str | None = None
        last_full_report_sync: datetime | None = None
        while True:
            priority_cycle_started = time.monotonic()
            try:
                try:
                    if schedule_capture_requested(config):
                        manual_count = sync_schedule_history(context, config, manual=True)
                        log(f"Manual schedule snapshot completed: {manual_count} appointments")
                except NeedsSignInError as schedule_signin_exc:
                    log(f"Manual schedule snapshot needs sign-in: {schedule_signin_exc}")
                except Exception as manual_schedule_exc:
                    log(f"Manual schedule snapshot failed: {manual_schedule_exc}")
                report_due = (
                    last_full_report_sync is None
                    or datetime.now(timezone.utc) - last_full_report_sync > timedelta(minutes=5)
                )
                if report_due:
                    sync_once(page, config)
                    last_full_report_sync = datetime.now(timezone.utc)
                try:
                    audit_due = (
                        last_ticket_audit_sync is None
                        or datetime.now(timezone.utc) - last_ticket_audit_sync
                        > timedelta(minutes=20)
                    )
                    job_count = sync_job_board(context, config, audit_due)
                    if audit_due:
                        last_ticket_audit_sync = datetime.now(timezone.utc)
                    log(f"Synced {job_count} Job Board repair orders")
                    if audit_due:
                        local_date = datetime.now(CENTRAL_TIME).date()
                        week_start = local_date - timedelta(days=(local_date.weekday() - 2) % 7)
                        goal_count = extract_goal_miss_tickets(
                            context, config, week_start, week_start + timedelta(days=6)
                        )
                        if goal_count:
                            log(f"Synced Goal Miss detail for {goal_count} weekly repair orders")
                    schedule_now = datetime.now(CENTRAL_TIME)
                    schedule_hour_key = schedule_now.strftime("%Y-%m-%d-%H")
                    if 7 <= schedule_now.hour <= 19 and schedule_hour_key != last_schedule_hour_key:
                        try:
                            schedule_count = sync_schedule_history(context, config)
                            last_schedule_hour_key = schedule_hour_key
                            hour_label = schedule_now.strftime("%-I:00 %p") if os.name != "nt" else schedule_now.strftime("%#I:00 %p")
                            log(f"Archived {schedule_count} schedule appointments for {hour_label}")
                        except NeedsSignInError:
                            raise
                        except Exception as schedule_exc:
                            log(f"Schedule history sync failed: {schedule_exc}")
                except NeedsSignInError as job_signin_exc:
                    log(f"Job Board sync needs sign-in: {job_signin_exc}")
                    post_reader_status(
                        config, "tekmetric_signin_required", str(job_signin_exc)
                    )
                except Exception as job_exc:
                    log(f"Job Board sync failed: {job_exc}")
                if (
                    last_vehicle_history_sync is None
                    or datetime.now(timezone.utc) - last_vehicle_history_sync
                    > timedelta(minutes=20)
                ):
                    try:
                        history_count = sync_vehicle_history(context, config, batch_size=2)
                        last_vehicle_history_sync = datetime.now(timezone.utc)
                        log(f"Vehicle history background batch completed: {history_count} customers")
                    except NeedsSignInError as history_signin_exc:
                        log(f"Vehicle history needs sign-in: {history_signin_exc}")
                    except Exception as history_exc:
                        log(f"Vehicle history sync failed: {history_exc}")
                if (
                    last_steer_sync is None
                    or datetime.now(timezone.utc) - last_steer_sync > timedelta(hours=6)
                ):
                    try:
                        count = sync_steer(context, config)
                        last_steer_sync = datetime.now(timezone.utc)
                        log(f"Synced {count} Steer opportunities")
                    except NeedsSignInError as steer_signin_exc:
                        log(f"Steer sync needs sign-in: {steer_signin_exc}")
                        post_reader_status(
                            config, "steer_signin_required", str(steer_signin_exc)
                        )
                    except Exception as steer_exc:
                        log(f"Steer sync failed: {steer_exc}")
                # Everything above either succeeded or reported its own
                # specific status. If we got this far, the reader itself is
                # healthy — clear any stale "needs sign-in" banner.
                post_reader_status(config, "ok", "Reader is syncing normally.")
            except NeedsSignInError as signin_exc:
                log(f"Sync needs sign-in: {signin_exc}")
                status = (
                    "steer_signin_required"
                    if signin_exc.site.lower() == "steer"
                    else "tekmetric_signin_required"
                )
                post_reader_status(config, status, str(signin_exc))
            except Exception as exc:
                log(f"Sync failed: {exc}")
                post_reader_status(config, "error", str(exc)[:500])
            # Start the next tag/verification scan about one minute after this
            # one began. Longer Tekmetric or AI work can occasionally consume
            # the whole minute, in which case the next scan starts immediately.
            elapsed = time.monotonic() - priority_cycle_started
            time.sleep(max(1, 60 - elapsed))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--configure", action="store_true")
    args = parser.parse_args()
    selected = configure() if args.configure else load_config()
    try:
        run(selected)
    except KeyboardInterrupt:
        sys.exit(0)
