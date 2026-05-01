# git-hours

Estimate work time from git commit history. Groups commits into sessions based on a max gap threshold, then sums total estimated hours.

## Install

```sh
npm install -g .
```

This installs `git-hours` as a global command. The CLI is written in TypeScript and runs through [`tsx`](https://github.com/privatenumber/tsx) at execution time — no build step.

## Usage

Run inside any git repository:

```sh
git-hours [options]
```

### Options

| Option | Description |
| --- | --- |
| `--since <date>` | Start date (ISO, e.g. `2025-03-01`) |
| `--until <date>` | End date (ISO, e.g. `2025-04-01`) |
| `--month <YYYY-MM>` | Shortcut: analyze a specific month |
| `--week <YYYY-MM-DD>` | Shortcut: analyze the week starting on that date |
| `--gap <minutes>` | Max gap between commits in a session (default: `120`) |
| `--first <minutes>` | Time credited for the first commit in a session (default: `30`) |
| `--author <name>` | Filter by author name (substring match) |
| `--all-authors` | Show per-author breakdown |
| `-h`, `--help` | Show help |

### Examples

```sh
git-hours --month 2025-03
git-hours --since 2025-03-01 --until 2025-04-01
git-hours --week 2025-03-24
git-hours --gap 90 --first 20
git-hours --all-authors
```

## How the estimate works

For each ordered sequence of commits:

- The first commit of a session is credited `--first` minutes (default 30).
- Subsequent commits within `--gap` minutes (default 120) of the previous one are added at their actual elapsed time.
- A gap larger than `--gap` ends the session and starts a new one (which itself gets `--first` minutes credited).

This is a heuristic — it's a useful approximation, not a timesheet.

## Project layout

```
src/
  index.ts        # main() entry
  cli.ts          # commander setup, argument parsing & validation
  git.ts          # git log invocation
  estimate.ts     # session math (estimateHours, computeDailyBreakdown)
  format.ts       # date / hour / ISO-week formatting
  print.ts        # console output
  types.ts        # shared interfaces
bin/git-hours.mjs # Node launcher that runs src/index.ts via tsx's API
package.json      # bin = ./bin/git-hours.mjs
tsconfig.json     # IDE/type-check config (no emit)
```

The `bin/git-hours.mjs` launcher exists because npm's Windows shim doesn't handle `#!/usr/bin/env npx tsx` shebangs reliably. The launcher uses a plain `#!/usr/bin/env node` shebang and invokes `tsx`'s programmatic API to load the TypeScript entry.
