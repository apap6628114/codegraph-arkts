/**
 * SQLite Adapter
 *
 * Thin wrapper over Node's built-in `node:sqlite` (`DatabaseSync`), exposed
 * through a small better-sqlite3-shaped interface so the rest of the codebase
 * is storage-agnostic.
 *
 * CodeGraph ships with a bundled Node runtime, so `node:sqlite` (real SQLite,
 * with WAL + FTS5) is always available — there is no native build step and no
 * wasm fallback. When run from source instead, it requires Node >= 22.5.
 */

export interface SqliteStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(str: string, options?: { simple?: boolean }): any;
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  close(): void;
  readonly open: boolean;
}

/**
 * The active SQLite backend. Only one now (`node:sqlite`); kept as a named type
 * so `codegraph status` and the per-instance reporting have a stable shape.
 */
export type SqliteBackend = 'node-sqlite' | 'better-sqlite3';

/**
 * Wraps Node's built-in `node:sqlite` (`DatabaseSync`) to match the
 * better-sqlite3 interface the rest of the code expects.
 *
 * node:sqlite is real SQLite compiled into Node, so it supports WAL, FTS5,
 * mmap, and `@named` params natively — the only shims needed are the
 * better-sqlite3 conveniences node:sqlite omits: a `.pragma()` helper, a
 * `.transaction()` helper, and `open` (node:sqlite exposes `isOpen`).
 */
class NodeSqliteAdapter implements SqliteDatabase {
  private _db: any;

  constructor(db: any) {
    this._db = db;
  }

  get open(): boolean {
    return this._db.isOpen;
  }

  prepare(sql: string): SqliteStatement {
    // node:sqlite matches better-sqlite3's calling convention (variadic
    // positional args, or a single object for @named params), so params forward
    // through unchanged.
    const stmt = this._db.prepare(sql);
    return {
      run(...params: any[]) {
        const r = stmt.run(...params);
        return {
          changes: Number(r?.changes ?? 0),
          lastInsertRowid: r?.lastInsertRowid ?? 0,
        };
      },
      get(...params: any[]) {
        return stmt.get(...params);
      },
      all(...params: any[]) {
        return stmt.all(...params);
      },
    };
  }

  exec(sql: string): void {
    this._db.exec(sql);
  }

  pragma(str: string, options?: { simple?: boolean }): any {
    const trimmed = str.trim();
    // Write pragma ("key = value"): node:sqlite is real SQLite, so every pragma
    // (WAL, mmap, synchronous, …) applies as-is.
    if (trimmed.includes('=')) {
      this._db.exec(`PRAGMA ${trimmed}`);
      return;
    }
    // Read pragma. Default: the row object (e.g. { journal_mode: 'wal' }).
    // `{ simple: true }` returns just the single column value, like better-sqlite3.
    const row = this._db.prepare(`PRAGMA ${trimmed}`).get();
    if (options?.simple) {
      return row && typeof row === 'object' ? Object.values(row)[0] : row;
    }
    return row;
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return (...args: any[]) => {
      this._db.exec('BEGIN');
      try {
        const result = fn(...args);
        this._db.exec('COMMIT');
        return result;
      } catch (error) {
        this._db.exec('ROLLBACK');
        throw error;
      }
    };
  }

  close(): void {
    // node:sqlite's DatabaseSync.close() throws if already closed; make it
    // idempotent to match better-sqlite3 (callers may close more than once).
    if (this._db.isOpen) this._db.close();
  }
}

/**
 * Check whether a node:sqlite connection supports FTS5.
 * Some Node.js builds (notably some Windows distributions) ship SQLite
 * without the FTS5 extension compiled in.
 */
function supportsFts5(db: any): boolean {
  try {
    db.exec('CREATE VIRTUAL TABLE __cg_fts_test USING fts5(content)');
    db.exec('DROP TABLE __cg_fts_test');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a database connection, preferring `node:sqlite` when FTS5 is
 * available and falling back to `better-sqlite3` otherwise.
 *
 * Returns the active backend alongside the db so each `DatabaseConnection` can
 * report it per-instance — MCP can open multiple project DBs in one process, so
 * a process-global would race.
 */
export function createDatabase(dbPath: string): { db: SqliteDatabase; backend: SqliteBackend } {
  // 1. Try node:sqlite first
  try {
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(dbPath);
    if (supportsFts5(raw)) {
      return { db: new NodeSqliteAdapter(raw), backend: 'node-sqlite' };
    }
    // Node:sqlite available but FTS5 not supported — close and fall through
    raw.close();
  } catch {
    // node:sqlite not available — fall through
  }

  // 2. Fall back to better-sqlite3 (bundles its own SQLite with FTS5)
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    return {
      db: {
        prepare: (sql: string) => db.prepare(sql),
        exec: (sql: string) => db.exec(sql),
        pragma: (str: string, options?: { simple?: boolean }) => db.pragma(str, options),
        transaction: <T>(fn: (...args: any[]) => T) => db.transaction(fn),
        close: () => db.close(),
        get open() { return db.open; },
      },
      backend: 'better-sqlite3',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Failed to open SQLite database. CodeGraph requires either:\n' +
      '  1. Node.js 22.5+ with SQLite compiled with FTS5 support, or\n' +
      '  2. The better-sqlite3 package (npm install better-sqlite3)\n' +
      'Install the self-contained CodeGraph release (it bundles a compatible Node).\n' +
      `Underlying error: ${msg}`
    );
  }
}
