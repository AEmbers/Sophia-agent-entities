/**
 * Vendored fork of `@deepseek-ai/dsh-storage-sqlite` (`schema.ts`).
 *
 * Source: deepseek-ai/deepseek-harness
 * `packages/storage/storage-sqlite/src/schema.ts` at version 0.1.5-rc.2
 * (MIT per that version's package metadata and the repo root LICENSE;
 * the stale npm `latest` tag 0.0.1-rc.1 carries BSD-3-Clause metadata).
 * Kept identical except the `@module` tag below.
 *
 * Why vendored instead of depended on: DSH Desktop generation installers
 * strip `@deepseek-ai/*` copies and resolve them from the host closure,
 * which ships no `dsh-storage-sqlite` — a loader row naming that package
 * blocks boot (GitHub issue #28). Resolving from our own package survives
 * that boundary. Sync procedure: diff against the upstream file on every
 * DSH compat round (see docs/dsh-release-compatibility.md).
 */
/**
 * Schema + open-time helpers for the SQLite storage backend: the physical
 * layout version, the database open/configure sequence (permissions, pragmas,
 * version stamp/reject), and the unit metadata tables. Unit record tables are
 * created per descriptor in `unit.ts`.
 * @module dsh-sophia-entities/sqlite-backend/schema
 */
import { DatabaseSync } from 'node:sqlite';
/**
 * The on-disk physical layout version, stored in `PRAGMA user_version`.
 * Orthogonal to each unit's own `version` (stamped per unit in the `units`
 * row). Bumped only on a breaking change to the table layout; any other
 * stamped version rejects — this unreleased format has no migrations.
 */
export declare const STORAGE_SQLITE_SCHEMA_VERSION = 1;
/**
 * Journal modes the backend will run under. `wal` is the default; the
 * rollback-journal modes (`delete`/`truncate`/`persist`) exist for
 * filesystems where WAL's shared-memory files do not work (network mounts).
 * `memory`/`off` are excluded: dropping journal durability silently
 * contradicts the durability clause of the KV backend contract.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist';
/**
 * Open the database and apply its schema and pragmas. Missing directories and
 * database files are created owner-only (`:memory:` skips filesystem setup).
 * A zero `user_version` is stamped with {@link STORAGE_SQLITE_SCHEMA_VERSION};
 * every other non-current version rejects rather than being migrated in place.
 * @param path - the SQLite database file to open, or `:memory:`.
 * @param journalMode - validated journal pragma.
 * @returns the open handle with pragmas applied and the unit metadata tables ensured.
 */
export declare function openDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync>;
/**
 * Physical table name for one unit table. Both segments are validated against
 * `UNIT_NAME_RE` before reaching this, so the result is safe to interpolate
 * into DDL and prepared-statement text.
 * @param unit - Validated unit name.
 * @param table - Validated table name.
 * @returns the `u_<unit>_<table>` identifier.
 */
export declare function recordTableName(unit: string, table: string): string;
//# sourceMappingURL=schema.d.ts.map