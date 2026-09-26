#!/usr/bin/env python3
"""Shrink the OC portrait masters so the repository stays installable.

The shipped bundles live in the tree (see .gitignore), which means every
`git clone` / GitHub-address install downloads them. The portrait masters were
2048x2048 RGB PNGs at ~4.8 MB each — 87.5 MB of the 99 MB tarball — and pushed
a default-timeout `pnpm add <github-url>` over the line.

This rewrites them in place as 1024x1024 WebP q90 (~3.4 MB for the whole set),
which is still a comfortable master size: the runtime set under
sophia-avatars-webp/ is 512x512, so there is a full stop of headroom for
re-deriving it at a larger size later.

The 2048px originals are archived outside the repository at
.scratch/avatar-sources-2048/ (gitignored) before this ever runs.

Usage:
  python scripts/shrink-avatar-masters.py --dry-run   # report only
  python scripts/shrink-avatar-masters.py             # rewrite in place

Requires Pillow with WebP support.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
MASTER_DIR = REPO_ROOT / "packages" / "dag-team" / "assets" / "sophia-avatars"
ARCHIVE_DIR = REPO_ROOT / ".scratch" / "avatar-sources-2048"


def collect() -> list[Path]:
    """Every master portrait, as PNG (the pre-shrink form) or WebP (already done)."""
    if not MASTER_DIR.is_dir():
        print(f"ERROR: master dir not found: {MASTER_DIR}", file=sys.stderr)
        sys.exit(1)
    found = sorted(p for p in MASTER_DIR.rglob("*") if p.suffix.lower() in {".png", ".webp"})
    if not found:
        print(f"ERROR: no portraits found under {MASTER_DIR}", file=sys.stderr)
        sys.exit(1)
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    parser.add_argument("--size", type=int, default=1024, help="square edge (default 1024)")
    parser.add_argument("--quality", type=int, default=90, help="WebP quality (default 90)")
    args = parser.parse_args()

    sources = collect()
    before = sum(p.stat().st_size for p in sources)
    print(f"portraits: {len(sources)} files, {before / 1024 / 1024:.2f} MB")

    if not ARCHIVE_DIR.is_dir():
        print(
            f"WARNING: {ARCHIVE_DIR.relative_to(REPO_ROOT)} does not exist; "
            f"the {args.size}px originals of any still-PNG master are about to be lost.",
            file=sys.stderr,
        )

    after = 0
    for src in sources:
        out = src if src.suffix.lower() == ".webp" else src.with_suffix(".webp")
        if args.dry_run:
            print(f"  {src.relative_to(MASTER_DIR)} -> {out.name} ({src.stat().st_size / 1024 / 1024:.2f} MB)")
            continue
        with Image.open(src) as im:
            im = im.convert("RGB").resize((args.size, args.size), Image.LANCZOS)
            im.save(out, "WEBP", quality=args.quality, method=6)
        written = out.stat().st_size
        was = src.stat().st_size if out != src else None
        if out != src:
            src.unlink()
        after += written
        was_text = f" (was {was / 1024 / 1024:.2f} MB)" if was is not None else ""
        print(f"  {out.relative_to(MASTER_DIR)} {written / 1024:.0f} KB{was_text}")

    if not args.dry_run:
        print(f"\nsummary: {before / 1024 / 1024:.2f} MB -> {after / 1024 / 1024:.2f} MB "
              f"({after * 100 / before:.1f}% of before)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
