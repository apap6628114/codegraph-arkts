/**
 * SQLite backend reporting.
 *
 * CodeGraph prefers `node:sqlite` (Node's built-in real SQLite), falling back
 * to `better-sqlite3` when `node:sqlite` lacks FTS5 support (notably some
 * Windows Node.js distributions). Both backends support WAL + FTS5.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { CodeGraph } from '../src';

const VALID_BACKENDS = ['node-sqlite', 'better-sqlite3'];

describe('DatabaseConnection — backend reporting', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-backend-'));
  });

  afterEach(() => {
    if (fs.existsSync(dir)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows EBUSY */ }
    }
  });

  it('reports a valid backend in WAL for an initialized DB', () => {
    const conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
    expect(VALID_BACKENDS).toContain(conn.getBackend());
    expect(conn.getJournalMode()).toBe('wal');
    conn.close();
  });

  it('CodeGraph.getBackend() delegates to the underlying DatabaseConnection', async () => {
    fs.writeFileSync(path.join(dir, 'x.ts'), `export function x(): void {}\n`);
    const cg = await CodeGraph.init(dir, { index: true });
    try {
      expect(VALID_BACKENDS).toContain(cg.getBackend());
    } finally {
      cg.destroy();
    }
  });
});
