#!/usr/bin/env python3
"""
Optimize the OC member portrait set for UI use.

Runs on the master set under
packages/dag-team/assets/sophia-avatars/<tier>/<中文职位名>.webp

and writes 512x512 WebP versions under
packages/dag-team/assets/sophia-avatars-webp/<slug>.webp

The masters were 2048x2048 PNGs until the repository had to become installable
from a Git address; they are now 1024x1024 WebP (see
scripts/shrink-avatar-masters.py) so a clone downloads ~3.4 MB instead of
~87 MB. Either extension is accepted here, so the step still works against an
archived PNG master.

The Chinese filename -> runtime slug mapping follows
docs/material-integration.md §4 ("建议 OC slug" column). Flat output
directory matches the host route's single-segment restriction.

Usage:
  python scripts/optimize-avatars.py            # convert all
  python scripts/optimize-avatars.py --dry-run  # print plan only
  python scripts/optimize-avatars.py --size 512 --quality 82

Requires Pillow with WebP support. Idempotent: overwrites outputs.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "packages" / "dag-team" / "assets" / "sophia-avatars"
OUT_DIR = REPO_ROOT / "packages" / "dag-team" / "assets" / "sophia-avatars-webp"

# Chinese portrait stem -> runtime slug (source: docs/material-integration.md §4).
# Keyed by stem, without the extension: the masters are .webp today but the map
# still has to serve an archived .png set.
SLUG_MAP: dict[str, str] = {
    # 1-command (管理与总控组)
    "监正": "lead-ceo",
    "灵台主事": "product-director",
    "时宪主事": "program-director",
    "典籍掌事": "resource-admin",
    "星禁掌察": "risk-compliance",
    # 2-analysis (产品分析与设计组)
    "观象访事": "requirement-analyst",
    "星图主事": "product-manager",
    "象绘主事": "ux-designer",
    "星绘主事": "ui-designer",
    "传报主事": "client-success",
    # 3-tech (架构与研发组)
    "灵台郎": "architect",
    "历算主事": "backend-engineer",
    "星仪主事": "frontend-engineer",
    "数象主事": "data-engineer",
    "推步主事": "algorithm-engineer",
    # 4-qa (测试运维与文档组)
    "星验主事": "business-qa",
    "星机校验": "test-engineer",
    "天象值守": "ops-engineer",
    "星文审校": "code-reviewer",
    "录典主事": "docs-writer",
}


def collect_sources() -> list[tuple[Path, str]]:
    """Return (source image, slug) pairs, sorted by tier then name."""
    found: list[tuple[Path, str]] = []
    if not SRC_DIR.is_dir():
        print(f"ERROR: source dir not found: {SRC_DIR}", file=sys.stderr)
        sys.exit(1)
    for tier in sorted(SRC_DIR.iterdir()):
        if not tier.is_dir():
            continue
        for src in sorted(p for p in tier.iterdir() if p.suffix.lower() in {".png", ".webp"}):
            slug = SLUG_MAP.get(src.stem)
            if slug is None:
                print(f"WARN: no slug mapping for {src.relative_to(REPO_ROOT)}; skipping", file=sys.stderr)
                continue
            found.append((src, slug))
    return found


def convert(png: Path, slug: str, size: int, quality: int, dry_run: bool) -> tuple[int, int]:
    """Convert one portrait. Returns (input_bytes, output_bytes)."""
    out = OUT_DIR / f"{slug}.webp"
    in_bytes = png.stat().st_size
    if dry_run:
        return in_bytes, 0
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with Image.open(png) as im:
        im = im.convert("RGB")
        im = im.resize((size, size), Image.LANCZOS)
        im.save(out, "WEBP", quality=quality, method=6)
    return in_bytes, out.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print plan without writing")
    parser.add_argument("--size", type=int, default=512, help="output square edge (default 512)")
    parser.add_argument("--quality", type=int, default=82, help="WebP quality 1-100 (default 82)")
    args = parser.parse_args()

    sources = collect_sources()
    if not sources:
        print(f"ERROR: no source portraits found under {SRC_DIR}", file=sys.stderr)
        return 1

    print(f"plan: {len(sources)} portraits -> {OUT_DIR.relative_to(REPO_ROOT)} ({args.size}x{args.size} WebP q{args.quality})")
    total_in = total_out = 0
    for png, slug in sources:
        in_bytes, out_bytes = convert(png, slug, args.size, args.quality, args.dry_run)
        total_in += in_bytes
        total_out += out_bytes
        if args.dry_run:
            print(f"  {slug:24s} <- {png.name} ({in_bytes / 1024 / 1024:.2f} MB)")
        else:
            print(f"  {slug:24s} {out_bytes / 1024:.1f} KB (was {in_bytes / 1024 / 1024:.2f} MB)")

    if not args.dry_run:
        print(f"\nsummary: input {total_in / 1024 / 1024:.2f} MB -> output {total_out / 1024:.1f} KB "
              f"({total_out * 100 / total_in:.2f}% of input)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())