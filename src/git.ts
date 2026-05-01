import { execFileSync } from 'node:child_process';
import process from 'node:process';
import type { CommitEntry, Options } from './types.ts';

export function getCommits(opts: Options): CommitEntry[] {
  const args = ['log', '--format=%at|%an|%s', '--no-merges'];

  if (opts.since)
    args.push(`--since=${opts.since}`);
  if (opts.until)
    args.push(`--until=${opts.until}`);
  if (opts.author)
    args.push(`--author=${opts.author}`);

  let raw: string;
  try {
    raw = execFileSync('git', args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.repo,
      // Default maxBuffer is 1 MiB; large repos with thousands of commits in
      // range can blow past that and throw ENOBUFS. 64 MiB covers ~600k commits.
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  }
  catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    const message = typeof stderr === 'string' ? stderr : stderr?.toString() ?? (err as Error).message;
    if (/not a git repository/i.test(message)) {
      console.error('git-hours: not a git repository (run from inside a repo).');
    }
    else if (/does not have any commits yet/i.test(message)) {
      console.error('git-hours: this repository has no commits yet.');
    }
    else {
      console.error(`git-hours: failed to read git log: ${message.trim()}`);
    }
    process.exit(1);
  }

  if (!raw)
    return [];

  return raw.split('\n').map((line) => {
    const [ts, author, ...msgParts] = line.split('|');
    return {
      author,
      message: msgParts.join('|'),
      timestamp: Number(ts) * 1000,
    };
  });
}
