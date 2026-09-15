#!/usr/bin/env bash
# Rebuild public/downloads/delta-auto-reader.zip from the current reader sources.
# The hash written into reader/build-hash.json, public/reader-version.json,
# VERSION, and the ZIP must match so the dashboard Download button, reader log,
# and shop-PC status report the same revision.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
reader_dir="${root}/reader"
public_dir="${root}/public"
downloads_dir="${public_dir}/downloads"
zip_path="${downloads_dir}/delta-auto-reader.zip"

rm -f "${reader_dir}/build-hash.json" "${reader_dir}/VERSION"

python3 - "${reader_dir}" "${public_dir}" "${zip_path}" <<'PY'
from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path

reader_dir = Path(sys.argv[1])
public_dir = Path(sys.argv[2])
zip_path = Path(sys.argv[3])
sys.path.insert(0, str(reader_dir))

from version import READER_VERSION, _hash_sources  # noqa: E402

build_hash = _hash_sources()
revision = {"version": READER_VERSION, "buildHash": build_hash}
(reader_dir / "build-hash.json").write_text(
    json.dumps(revision, indent=2) + "\n", encoding="utf-8"
)
(reader_dir / "VERSION").write_text(
    f"{READER_VERSION}+{build_hash}\n", encoding="utf-8"
)
(public_dir / "reader-version.json").write_text(
    json.dumps(revision, indent=2) + "\n", encoding="utf-8"
)

include = [
    "reader.py",
    "config.py",
    "numeric.py",
    "version.py",
    "requirements.txt",
    "build-hash.json",
    "VERSION",
    "install-reader.ps1",
    "register-scheduled-task.ps1",
]
for path in sorted((reader_dir / "parsers").rglob("*")):
    if path.is_file() and "__pycache__" not in path.parts and "tests" not in path.parts:
        include.append(str(path.relative_to(reader_dir)))

zip_path.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for relative in include:
        source = reader_dir / relative
        if not source.exists():
            raise SystemExit(f"Missing reader file for ZIP: {relative}")
        archive.write(source, arcname=relative)

digest = hashlib.sha256()
digest.update(zip_path.read_bytes())
print(f"Packed reader {READER_VERSION}+{build_hash}")
print(f"ZIP {zip_path} sha256={digest.hexdigest()[:12]}")
PY
