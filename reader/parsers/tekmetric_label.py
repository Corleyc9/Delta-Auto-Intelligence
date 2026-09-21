from __future__ import annotations

import os
import re
from urllib.parse import urlsplit, urlunsplit

from config import JOB_BOARD_LABELS

# Exact Job Board string used by this shop. Incoming "Verify" / "Verify
# Parts&Labor" tags mean the RO still needs GM review. After dashboard
# Verified, the outgoing tag is this one (Devin: "verified/ send estimate").
DEFAULT_TEKMETRIC_VERIFY_LABEL = "Verified/Send Estimate"

_SUFFIXES = ("/estimate", "/inspection", "/inspections", "/parts", "/jobs")


def normalize_label(value: str) -> str:
    return re.sub(r"[\s/]+", " ", value or "").strip().casefold()


def labels_match(left: str, right: str) -> bool:
    a = normalize_label(left)
    b = normalize_label(right)
    return bool(a and a == b)


def resolve_verify_label(job_target: str = "", env: dict | None = None) -> str:
    """Prefer the Worker job's target, then TEKMETRIC_VERIFY_LABEL, then shop default."""
    explicit = (job_target or "").strip()
    if explicit:
        return explicit[:80]
    environ = env if env is not None else os.environ
    override = str(environ.get("TEKMETRIC_VERIFY_LABEL") or "").strip()
    if override:
        return override[:80]
    return DEFAULT_TEKMETRIC_VERIFY_LABEL


def label_click_candidates(target: str) -> list[str]:
    """Exact shop string first, then spacing variants Devin might quote."""
    raw = (target or "").strip() or DEFAULT_TEKMETRIC_VERIFY_LABEL
    variants = [
        raw,
        raw.replace("/", " / ").replace("  ", " "),
        raw.replace(" / ", "/"),
        "Verified/Send Estimate",
        "Verified / Send Estimate",
        "Verified/ Send Estimate",
    ]
    seen: set[str] = set()
    ordered: list[str] = []
    for item in variants:
        key = item.casefold()
        if key in seen or not item.strip():
            continue
        seen.add(key)
        ordered.append(item)
    return ordered


def repair_order_page_url(detail_url: str, ro_number: str = "") -> str:
    """Open the RO header (label chip), not the estimate sub-page."""
    url = (detail_url or "").strip()
    if url:
        parts = urlsplit(url)
        path = parts.path.rstrip("/")
        lowered = path.lower()
        for suffix in _SUFFIXES:
            if lowered.endswith(suffix):
                path = path[: -len(suffix)]
                break
        return urlunsplit((parts.scheme, parts.netloc, path, "", ""))
    ro = re.sub(r"\D", "", str(ro_number or ""))
    if ro:
        return f"https://shop.tekmetric.com/admin/shop/4326/repair-orders/{ro}"
    return ""


def known_job_board_labels() -> tuple[str, ...]:
    return JOB_BOARD_LABELS
