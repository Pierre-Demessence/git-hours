# git-hours

Estimate work time from git commit history. Groups commits into sessions based on a max gap threshold, then sums total estimated hours.

See [CHANGELOG.md](CHANGELOG.md) for changes between versions.

## Install

```sh
npm install -g .
```

This installs `git-hours` as a global command. The TypeScript source is bundled to `dist/index.js` by [tsup](https://tsup.egoist.dev/); the bundle is the only thing shipped at install time.

### Local development

```sh
npm install        # installs deps and runs the build (via the `prepare` script)
npm run build      # rebuild dist/ after changes
```

On first install, `npm install -g .` symlinks the global package back to this repo, so subsequent `npm run build` runs are picked up by the global command without needing to reinstall.

## Usage

Run inside any git repository:

```sh
git-hours [options]
```

### Options

| Option | Description |
| --- | --- |
| `--since <date>` | Start date, inclusive (ISO, e.g. `2025-03-01`; a bare date means local midnight) |
| `--until <date>` | End date, exclusive (ISO, e.g. `2025-04-01`) |
| `--month <YYYY-MM>` | Shortcut: analyze a specific month |
| `--week <YYYY-MM-DD>` | Shortcut: analyze the Monday-based week containing that date |
| `--today` / `--yesterday` | Shortcut: analyze today or yesterday |
| `--this-week` / `--last-week` | Shortcut: analyze the current or previous week (Monday-based) |
| `--this-month` / `--last-month` | Shortcut: analyze the current or previous month |
| `--gap <minutes>` | Max gap between commits in a session (default: `120`) |
| `--first-commit-credit <minutes>` | Time credited for the first commit in a session (default: `30`) |
| `--auto-gap` | Auto-pick gap from commit cadence (P90 of inter-commit deltas ≤ 6h, clamped to 60–240) |
| `--author <name>` | Filter by author name or email (case-insensitive substring match) |
| `--all-authors` | Show per-author breakdown |
| `--exclude-author <name...>` | Exclude commits by author (repeatable, substring match) |
| `--top <n>` | Limit `--all-authors` to the top N authors by hours |
| `--branch <name>` | Analyze a specific branch (default: HEAD) |
| `--all-branches` | Analyze commits reachable from any ref (includes remote-tracking refs — see note below) |
| `--daily` | Include the per-day breakdown (off by default) |
| `--heatmap` | Print a 7×24 hour-of-day × day-of-week heatmap |
| `--json` | Emit machine-readable JSON instead of human text |
| `--csv` | Emit the daily breakdown as CSV (implies `--daily`) |
| `--repo <path>` | Path to git repository (default: current directory) |
| `--compare <window>` | Compare against another window: a shortcut (`last-month`, `last-week`, `this-month`, `this-week`, `today`, `yesterday`), `YYYY-MM`, or `START..END` (end exclusive, either side optional, e.g. `2025-03-01..2025-03-08`) |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show the version |

### Examples

```sh
git-hours --month 2025-03
git-hours --since 2025-03-01 --until 2025-04-01
git-hours --week 2025-03-24
git-hours --gap 90 --first-commit-credit 20
git-hours --all-authors
```

### Notes

Date ranges apply to the commit's **author date** (when the work was done),
not its committer date, so commits rebased or cherry-picked later stay in the
period they were written. `--month`, `--week`, the shortcuts and `--since`/`--until`
are mutually exclusive.

With `--all-authors`, each author is estimated separately and the total is the
sum of their hours (person-hours); `--top` only limits which authors are listed.
The `--daily` breakdown always sums to the total: a session crossing midnight is
split between the two days.

`--all-branches` passes `--all` to git, which walks **every ref** — including
remote-tracking branches under `refs/remotes/*`. If you have local-only work,
this is fine. If you fetch from a shared remote, single-author totals can be
silently inflated by teammates' commits that exist on remote refs but never
landed in your local branches. Combine with `--author <name>` (or `--exclude-author`)
to scope to your own work.

## Tests

```sh
npm test
npm run lint
npm run typecheck
```

Runs Node's built-in test runner via `tsx` (used as a dev-time TS loader; not a runtime dependency). Tests cover the session math, date windows, argument parsing, report building and rendering, and read commits from a throwaway git repository.

## How the estimate works
For each ordered sequence of commits:

- The first commit of a session is credited `--first-commit-credit` minutes (default 30).
- Subsequent commits within `--gap` minutes (default 120) of the previous one are added at their actual elapsed time.
- A gap larger than `--gap` ends the session and starts a new one (which itself gets `--first-commit-credit` minutes credited).

This is a heuristic — it's a useful approximation, not a timesheet.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success (also after `--help` / `--version`) |
| `1` | git failed (not a repository, no commits, git not installed…) |
| `2` | Invalid arguments |

## Project layout

The pipeline is: parse arguments → read commits → build a `Report` → render it.
Only `index.ts` touches the process (stdout, exit code); everything else returns
values or throws a `CliError`.

```
src/
  index.ts        # main(): wires the pipeline, maps CliError to exit codes
  cli.ts          # commander setup → Options (throws UsageError, never exits)
  dates.ts        # date windows: shortcuts, months, weeks, START..END specs
  git.ts          # async git log reading (readCommits) and parsing
  progress.ts     # stderr spinner (TTY only)
  estimate.ts     # session math (estimateHours, estimateTotal, computeDailyBreakdown, pickAutoGap)
  report.ts       # buildReport(): commits → Report (totals, authors, daily, heatmap, compare)
  render/
    text.ts       # human-readable output
    json.ts       # --json
    csv.ts        # --csv
  format.ts       # hour / date / ISO-week formatting
  heatmap.ts      # day-of-week × hour-of-day grid
  errors.ts       # CliError, UsageError, GitError, ExitRequest
  types.ts        # shared interfaces
tests/            # node:test tests
tsup.config.ts    # build configuration
package.json      # bin = ./dist/index.js, prepare script runs tsup
tsconfig.json     # IDE/type-check config (no emit)
dist/             # generated bundle (gitignored)
```
