import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { UsageError } from './errors.ts';

// Settings read from a JSON config file. Keys mirror the long CLI flags in
// camelCase; command-line flags always win over the file.
export interface FileConfig {
  allAuthors?: boolean;
  allBranches?: boolean;
  author?: string[];
  excludeAuthor?: string[];
  fetch?: boolean;
  firstCommitCredit?: number;
  gap?: number;
  independentRepos?: boolean;
  // Default folders for a bare `--scan`.
  scan?: string[];
  scanExclude?: string[];
}

type Kind = 'boolean' | 'number' | 'strings';

const KEYS: Record<keyof FileConfig, Kind> = {
  allAuthors: 'boolean',
  allBranches: 'boolean',
  author: 'strings',
  excludeAuthor: 'strings',
  fetch: 'boolean',
  firstCommitCredit: 'number',
  gap: 'number',
  independentRepos: 'boolean',
  scan: 'strings',
  scanExclude: 'strings',
};

// $XDG_CONFIG_HOME/git-hours/config.json, else ~/.config/git-hours/config.json.
export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'git-hours', 'config.json');
}

export function validateConfig(raw: unknown, path: string): FileConfig {
  const fail = (msg: string): never => {
    throw new UsageError(`config ${path}: ${msg}`);
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    fail('must be a JSON object');

  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === '$schema')
      continue;
    if (key === 'autoGap')
      fail('"autoGap" was removed in 3.0: the gap is calibrated automatically unless "gap" is set');
    const kind = KEYS[key as keyof FileConfig];
    if (!kind)
      fail(`unknown key "${key}" (allowed: ${Object.keys(KEYS).join(', ')})`);
    if (kind === 'boolean' && typeof value !== 'boolean')
      fail(`"${key}" must be true or false`);
    if (kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))
      fail(`"${key}" must be a non-negative number`);
    if (kind === 'strings') {
      // A single string is accepted as a one-element list.
      const list = typeof value === 'string' ? [value] : value;
      if (!Array.isArray(list) || list.length === 0 || !list.every(v => typeof v === 'string' && v !== ''))
        fail(`"${key}" must be a non-empty string or list of strings`);
      config[key] = list;
      continue;
    }
    config[key] = value;
  }

  if (config.author && config.allAuthors)
    fail('"author" and "allAuthors" cannot both be set');
  return config as FileConfig;
}

// Load a config file. A missing file is an error only when `required` (an
// explicit --config); the default location is optional.
export function loadConfig(path: string, required: boolean): FileConfig | undefined {
  if (!existsSync(path)) {
    if (required)
      throw new UsageError(`config file not found: ${path}`);
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  }
  catch (err) {
    throw new UsageError(`config ${path}: ${(err as Error).message}`);
  }
  return validateConfig(raw, path);
}
