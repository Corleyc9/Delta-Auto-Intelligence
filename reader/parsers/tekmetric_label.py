from __future__ import annotations

import os
import re
from urllib.parse import urlsplit, urlunsplit

# Confirmed from Devin's Job Board teach demo (shop 4326, ACTIVE column view):
# the dropdown chip is exactly "Verified/Send Estimate" (slash, no spaces).
# Incoming "Verify" / "Verify Parts&Labor" tags mean the RO still needs GM
# review. After dashboard Verified, the outgoing tag is this one.
DEFAULT_TEKMETRIC_VERIFY_LABEL = "Verified/Send Estimate"

_SUFFIXES = ("/estimate", "/inspection", "/inspections", "/parts", "/jobs")
_SIGNIN_PATH = re.compile(r"/(?:login|log-in|signin|sign-in|auth|session)(?:/|$)", re.I)
_RO_DETAIL_PATH = re.compile(r"/admin/shop/4326/repair-orders/\d+", re.I)


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
    """Exact shop string first. Spacing variants are click fallbacks only."""
    raw = (target or "").strip() or DEFAULT_TEKMETRIC_VERIFY_LABEL
    variants = [
        raw,
        DEFAULT_TEKMETRIC_VERIFY_LABEL,
        raw.replace("/", " / ").replace("  ", " "),
        raw.replace(" / ", "/"),
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


def is_repair_order_detail_url(url: str) -> bool:
    """True for /admin/shop/4326/repair-orders/{internalId} deep links."""
    return bool(_RO_DETAIL_PATH.search(urlsplit(url or "").path))


def is_tekmetric_signin_url(url: str) -> bool:
    """Session-expired redirects leave shop.tekmetric.com for a login page."""
    value = (url or "").strip()
    if not value:
        return False
    parts = urlsplit(value)
    host = (parts.hostname or "").lower()
    path = parts.path or "/"
    if host.endswith("tekmetric.com"):
        if _SIGNIN_PATH.search(path):
            return True
        if "/admin/shop/" not in path.lower() and re.search(r"login|sign[-_]?in", path, re.I):
            return True
        return False
    return bool(re.search(r"login|sign[-_]?in|session", value, re.I))


def repair_order_page_url(detail_url: str, ro_number: str = "") -> str:
    """Clean a real RO deep link. Do not invent /repair-orders/{RO#}.

    Tekmetric ids in the demo are internal (e.g. repair-orders/366529871),
    not the shop-facing RO number.
    """
    url = (detail_url or "").strip()
    if not url:
        return ""
    parts = urlsplit(url)
    path = parts.path.rstrip("/")
    lowered = path.lower()
    for suffix in _SUFFIXES:
        if lowered.endswith(suffix):
            path = path[: -len(suffix)]
            break
    cleaned = urlunsplit((parts.scheme, parts.netloc, path, "", ""))
    if is_repair_order_detail_url(cleaned):
        return cleaned
    return cleaned if url else ""
