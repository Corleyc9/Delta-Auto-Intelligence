from __future__ import annotations

import hashlib
import json
from pathlib import Path

READER_VERSION = "2.0.0"


def _hash_sources() -> str:
    root = Path(__file__).resolve().parent
    digest = hashlib.sha256()
    files = sorted(
        path for path in root.rglob("*")
        if path.is_file()
        and path.suffix in {".py", ".txt", ".ps1", ".json"}
        and "__pycache__" not in path.parts
        and "tests" not in path.parts
        and path.name not in {"VERSION", "build-hash.json"}
    )
    for path in files:
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()[:12]


def load_packaged_revision() -> tuple[str, str]:
    packaged = Path(__file__).resolve().parent / "build-hash.json"
    if packaged.exists():
        try:
            payload = json.loads(packaged.read_text(encoding="utf-8"))
            version = str(payload.get("version") or READER_VERSION)
            build_hash = str(payload.get("buildHash") or "")
            if build_hash:
                return version, build_hash
        except Exception:
            pass
    return READER_VERSION, _hash_sources()


READER_VERSION, READER_BUILD_HASH = load_packaged_revision()
READER_REVISION = f"{READER_VERSION}+{READER_BUILD_HASH}"
