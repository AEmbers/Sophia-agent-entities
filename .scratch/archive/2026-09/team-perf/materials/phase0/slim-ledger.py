#!/usr/bin/env python3
"""Counterfactual ledgers for ticket 04 (slim `team/thread-read` records).

The frozen ledger's read records are all fat and stay fat (criterion ④), so the
four absolute numbers measured on it barely move. The ticket's real intent --
"replay gets cheaper" -- is only observable on a ledger whose read records were
written in the NEW shape. This script builds that ledger by mechanically
projecting each fat read record onto the announced slim shape, keeping the
sequence, ids, actor, occurredAt and the whole Inbox delta / watermark intact:

  data := { workspaceId, memberId, threadRef, taskRef?, readThroughSequence, inbox }

Shape fixed by Tars 2026-09-13 22:56: `remainingUnreadCount` and `attention` are
NOT stored -- they are projection-derived report fields, and re-deriving them per
record would be exactly the per-record cost criterion (2) wants gone.

Because the fat and slim shapes are both accepted by the same union schema (04's
whole design), the result is a legal ledger; because projection replay only ever
consumed `inbox` (+ attention observations), boot and projection must come out
byte-identical to the original. If the domain fails to open, the field list here
does not match the shipped slim schema -- fix it, do not "fix" the product.

Usage:
  python3 slim-ledger.py <src.sqlite> <dst.sqlite> [--ratio 1.0] [--dry-run]

Protocol / pitfalls:
  * Run BEFORE anything opens the copy: a pre-boot rewrite through an independent
    sqlite connection is fine (the running-backend case is not -- see ruler note).
  * Always `rm -f <dst>-wal <dst>-shm` before the copy AND before booting it.
  * `--ratio 0.5` gives the mixed arm: half the read records slim, half fat, in
    the same ledger -- the strongest single proof that both validator branches
    coexist and that shape is not load-bearing for the projection.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sqlite3
import sys
from collections import defaultdict

SLIM_KEYS = ("workspaceId", "memberId", "readThroughSequence", "inbox")


def slim_data(operation: dict) -> dict | None:
    data = operation.get("data")
    if not isinstance(data, dict) or "thread" not in data:
        return None  # already slim (or not the fat shape we know)
    slim: dict = {}
    for key in SLIM_KEYS:
        if key in data:
            slim[key] = data[key]
    slim["threadRef"] = data["thread"]["threadRef"]
    if "task" in data:
        slim["taskRef"] = data["task"]["taskRef"]
    # Key order is irrelevant to the schema; keep the announced order for diffs.
    ordered = {}
    for key in ("workspaceId", "memberId", "threadRef", "taskRef", "readThroughSequence", "inbox"):
        if key in slim:
            ordered[key] = slim[key]
    return ordered


# Fields a rewritten record is allowed to lose. Anything else changing is a bug in
# this instrument, and would silently invalidate every measurement made with it.
SNAPSHOT_KEYS = {"task", "thread", "claims", "anchor", "anchorMentions", "facts",
                 "attention", "remainingUnreadCount"}
ENVELOPE_KEYS = ("sequence", "operationId", "requestId", "occurredAt", "actor",
                 "previousOperationId", "kind")


def audit(src: str, dst: str) -> None:
    with sqlite3.connect(src) as left_db, sqlite3.connect(dst) as right_db:
        left = dict(left_db.execute("select key, value from u_agent_team_operations").fetchall())
        right = dict(right_db.execute("select key, value from u_agent_team_operations").fetchall())
    violations: list[str] = []
    if set(left) != set(right):
        violations.append("record keys differ between src and dst")
    changed = 0
    for key, value in left.items():
        other = right.get(key)
        if other == value:
            continue
        changed += 1
        before, after = json.loads(value), json.loads(other)
        for field in ENVELOPE_KEYS:
            if before.get(field) != after.get(field):
                violations.append(f"{key}: {field} changed")
        before_data, after_data = before.get("data", {}), after.get("data", {})
        dropped = set(before_data) - set(after_data)
        added = set(after_data) - set(before_data)
        if added - {"threadRef", "taskRef"}:
            violations.append(f"{key}: added data keys {sorted(added - {'threadRef', 'taskRef'})}")
        # `threadRef`/`taskRef` are the identity lifted out of the dropped snapshot
        # objects; they may only be added with exactly the values they carried.
        if "threadRef" in added and before_data.get("thread", {}).get("threadRef") != after_data.get("threadRef"):
            violations.append(f"{key}: threadRef does not match the dropped thread.threadRef")
        if "taskRef" in added and before_data.get("task", {}).get("taskRef") != after_data.get("taskRef"):
            violations.append(f"{key}: taskRef does not match the dropped task.taskRef")
        if "thread" in before_data and "threadRef" not in after_data:
            violations.append(f"{key}: slim record has no threadRef")
        if not dropped <= SNAPSHOT_KEYS:
            violations.append(f"{key}: dropped non-snapshot keys {sorted(dropped - SNAPSHOT_KEYS)}")
        for field in set(before_data) & set(after_data):
            if before_data[field] != after_data[field]:
                violations.append(f"{key}: data.{field} changed")
    print(json.dumps({"audit": {
        "changedRecords": changed, "sameRecords": len(left) - changed,
        "violationCount": len(violations), "violations": violations[:10],
    }}, ensure_ascii=False))
    if violations:
        raise SystemExit("slim-ledger audit failed: the transform touched more than the snapshot fields")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("src")
    parser.add_argument("dst")
    parser.add_argument("--ratio", type=float, default=1.0,
                        help="fraction of fat read records to slim (default: all)")
    parser.add_argument("--seed", type=int, default=20260913)
    parser.add_argument("--dry-run", action="store_true",
                        help="report sizes without writing the destination")
    parser.add_argument("--audit", action="store_true",
                        help="after writing, diff src against dst field by field: every "
                             "rewritten record may only lose snapshot keys, everything else "
                             "must be byte-identical (self-audit for the verifier)")
    args = parser.parse_args()

    for suffix in ("-wal", "-shm"):
        for path in (args.src, args.dst):
            stale = path + suffix
            if os.path.exists(stale):
                os.remove(stale)

    if not os.path.exists(args.dst) or os.path.getsize(args.dst) != os.path.getsize(args.src):
        with open(args.src, "rb") as source, open(args.dst, "wb") as target:
            while chunk := source.read(1 << 20):
                target.write(chunk)

    connection = sqlite3.connect(args.dst)
    try:
        rows = connection.execute("select key, value from u_agent_team_operations").fetchall()
        reads = []
        before_kind: dict[str, int] = defaultdict(int)
        before_total = 0
        for key, value in rows:
            operation = json.loads(value)
            before_kind[operation["kind"]] += len(value)
            before_total += len(value)
            if operation["kind"] == "team/thread-read":
                reads.append((key, value, operation))

        chosen = reads
        if args.ratio < 1.0:
            rng = random.Random(args.seed)
            rng.shuffle(chosen)
            chosen = chosen[: int(len(reads) * args.ratio)]

        after_total = before_total
        after_kind = dict(before_kind)
        fat_bytes = slim_bytes = 0
        updates = []
        for key, value, operation in chosen:
            data = slim_data(operation)
            if data is None:
                continue
            rewritten = dict(operation)
            rewritten["data"] = data
            encoded = json.dumps(rewritten, separators=(",", ":"), ensure_ascii=False)
            fat_bytes += len(value)
            slim_bytes += len(encoded)
            after_total += len(encoded) - len(value)
            after_kind["team/thread-read"] += len(encoded) - len(value)
            updates.append((encoded, key))

        print(json.dumps({
            "records": len(rows),
            "readRecords": len(reads),
            "rewritten": len(updates),
            "fatReadRecordMeanBytes": fat_bytes // max(1, len(updates)),
            "slimReadRecordMeanBytes": slim_bytes // max(1, len(updates)),
            "ledgerBytesBefore": before_total,
            "ledgerBytesAfter": after_total,
            "shrinkPct": round(100 * (1 - after_total / before_total), 1),
            "topKindsBefore": sorted(before_kind.items(), key=lambda item: -item[1])[:4],
            "topKindsAfter": sorted(after_kind.items(), key=lambda item: -item[1])[:4],
            "dst": args.dst,
            "dryRun": args.dry_run,
        }, ensure_ascii=False, indent=1))

        if args.dry_run:
            return 0
        connection.executemany("update u_agent_team_operations set value = ? where key = ?", updates)
        connection.commit()

        if args.audit:
            audit(args.src, args.dst)
    finally:
        connection.close()
    for suffix in ("-wal", "-shm"):
        stale = args.dst + suffix
        if os.path.exists(stale):
            os.remove(stale)
    return 0


if __name__ == "__main__":
    sys.exit(main())
