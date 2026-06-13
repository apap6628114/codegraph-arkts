/**
 * Configuration Management
 *
 * Loads the optional `.codegraph/config.json` file. Config is never required —
 * when absent or invalid, defaults are used and indexing proceeds normally.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCodeGraphDir } from './directory';
import { logWarn } from './errors';

/** Configuration loaded from `.codegraph/config.json` */
export interface CodeGraphConfig {
  /** Language IDs to restrict indexing to (empty/undefined = all languages) */
  languages?: string[];
  /** Glob patterns for files to force-include (bypasses .gitignore + defaults) */
  include?: string[];
  /** Glob patterns for files to force-exclude (highest priority) */
  exclude?: string[];
}

/** Config filename inside the .codegraph/ directory */
const CONFIG_FILENAME = 'config.json';

/**
 * Load configuration from `.codegraph/config.json`.
 *
 * Never throws — returns an empty config when the file is missing, unparseable,
 * or contains invalid field types, logging a warning so the user can fix it.
 */
export function loadCodeGraphConfig(rootDir: string): CodeGraphConfig {
  const configPath = path.join(getCodeGraphDir(rootDir), CONFIG_FILENAME);
  try {
    if (!fs.existsSync(configPath)) return {};
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: CodeGraphConfig = {};

    if (Array.isArray(parsed.languages)) {
      result.languages = parsed.languages.filter(
        (l): l is string => typeof l === 'string',
      );
    }

    if (Array.isArray(parsed.include)) {
      result.include = parsed.include.filter(
        (p): p is string => typeof p === 'string',
      );
    }

    if (Array.isArray(parsed.exclude)) {
      result.exclude = parsed.exclude.filter(
        (p): p is string => typeof p === 'string',
      );
    }

    return result;
  } catch (err) {
    logWarn('Failed to load .codegraph/config.json', {
      path: configPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
