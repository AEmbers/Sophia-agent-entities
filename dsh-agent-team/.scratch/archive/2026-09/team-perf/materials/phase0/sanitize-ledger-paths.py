#!/usr/bin/env python3
"""Neutralize real Member private-memory paths in a ledger copy before probing.

Why this exists
---------------
`migrateLegacyMemoryDirectory` (packages/agent-team/src/member-runtime.ts) renames
the directory named by a record's absolute `privateMemoryPath` into whatever
`DSH_HOME` the process runs under. A perf probe that replays a ledger copy of a
REAL workspace under an isolated home therefore moves a real Member's private
directory. Until the guard (Aster's ab119d9: rename only within the same parent)
is merged, any real-ledger probe must scrub the copy first.

What it does
------------
Rewrites every absolute `*MemoryPath` string in every table of the ledger copy to
a path under `--root` (default `/nonexistent-dsh-probe`), leaving record count,
kinds, and all other fields untouched, then re-verifies that no other absolute
path remains.

Usage
-----
  python3 sanitize-ledger-paths.py <ledger.sqlite> [--root /nonexistent-dsh-probe]
  python3 sanitize-ledger-paths.py --check <ledger.sqlite>     # report only

Prints aggregate counts only: it never echoes a real path.
"""
import argparse
import os
import re
import sqlite3
import sys

PATTERN = re.compile(r'("(?:[A-Za-z]*[Mm]emoryPath)"\s*:\s*")([^"]*)(")')
KIND_PATTERN = re.compile(r'"kind"\s*:\s*"([a-z-]+)"')


def scrub(value, root, report):
    def replace(match):
        path = match.group(2)
        if not path.startswith('/'):
            return match.group(0)
        report['rewritten'] += 1
        report['kinds'].update(KIND_PATTERN.findall(value))
        return f'{match.group(1)}{root}/{os.path.basename(path)}{match.group(3)}'
    return PATTERN.sub(replace, value)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('ledger')
    parser.add_argument('--root', default='/nonexistent-dsh-probe')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if not os.path.exists(args.ledger):
        sys.exit(f'no such ledger: {args.ledger}')

    connection = sqlite3.connect(args.ledger)
    tables = [row[0] for row in connection.execute("select name from sqlite_master where type = 'table'")]
    report = {'rewritten': 0, 'kinds': set(), 'rows': 0}
    for table in tables:
        columns = [row[1] for row in connection.execute(f'pragma table_info({table})')]
        primary = columns[0]
        for row in connection.execute(f'select * from {table}').fetchall():
            report['rows'] += 1
            updated = False
            replaced = []
            for value in row:
                if isinstance(value, str) and 'MemoryPath' in value:
                    text = scrub(value, args.root, report)
                    if text != value:
                        updated = True
                        replaced.append(text)
                        continue
                replaced.append(value)
            if updated and not args.check:
                assignments = ', '.join(f'{column} = ?' for column in columns)
                connection.execute(f'update {table} set {assignments} where {primary} = ?', [*replaced, row[0]])
    if not args.check:
        connection.commit()

    remaining = 0
    for table in tables:
        for row in connection.execute(f'select * from {table}').fetchall():
            for value in row:
                if not isinstance(value, str) or 'MemoryPath' not in value:
                    continue
                for match in PATTERN.finditer(value):
                    if match.group(2).startswith('/') and not match.group(2).startswith(args.root):
                        remaining += 1
    connection.close()
    print(f'tables={tables} rows={report["rows"]} rewrites={report["rewritten"]} absolute_remaining={remaining} kinds={sorted(report["kinds"])}')
    if not args.check and remaining != 0:
        sys.exit('sanitize failed: absolute paths remain')


if __name__ == '__main__':
    main()
