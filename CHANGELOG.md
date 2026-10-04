# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [3.0.0] - 2026-10-04

### Breaking changes

- **Only your commits are counted by default.** Without `--author`,
  git-hours now uses the repository's `git config user.email` and
  `user.name` (as git resolves them, including `includeIf`). Use
  `--all-authors` for the previous behaviour (everyone's commits).
- `--all-authors` now means "count every author" (one combined estimate).
  The per-author breakdown it used to produce is now **`--per-author`**.
- `--top` requires `--per-author` or `--scan`.
- **The default gap is 90 minutes** (was 120), and `--auto-gap` is removed:
  on real histories, pauses between commits don't split cleanly into work and
  breaks, so no rule picks the gap reliably (the old P90 rule included). Set
  your own with `--gap` or `"gap"` in the config file — see README, "Choosing
  your gap". The header shows `(default)` until you do, and JSON
  `params.autoGap` is replaced by `params.gapSource` (`set` or `default`).

### Added

- Config file at `~/.config/git-hours/config.json` (or
  `$XDG_CONFIG_HOME/git-hours/config.json`) for `author`, `allAuthors`,
  `excludeAuthor`, `allBranches`, `gap`, `firstCommitCredit`,
  `scan` (default roots for a bare `--scan`), `scanExclude`, `fetch` and
  `independentRepos`. Command-line flags win; `--config <path>` and
  `--no-config` select or skip the file.
- `--author` accepts several patterns (any may match).
- `--fetch` to force fetching when the config file disables it.
- The header shows whose commits were counted and which config file was used;
  JSON gains `author` and `config`.

## [2.1.0] - 2026-10-03

### Added

- `--scan [dirs...]`: find git repositories recursively and report hours per
  project with a combined total. Repositories are fetched first (`--no-fetch`
  to skip) and read in parallel. By default all projects share one timeline so
  sessions hopping between projects are counted once and projects sum to the
  total; `--independent-repos` estimates each project on its own instead.
  `--scan-exclude` skips folders by glob, and `--top` limits the listed projects.
- With `--scan`, `--json` gains `scan` and `perRepo`, and `--csv` emits one row
  per project (or per project per day with `--daily`).

## [2.0.0] - 2026-10-03

### Breaking changes

- `--until` is now **exclusive**, like `--month` and the other shortcuts
  (`--since 2025-03-01 --until 2025-04-01` is exactly March).
- Date ranges apply to the commit's **author date** instead of git's committer
  date, so rebased or cherry-picked commits stay in the period they were
  written.
- With `--all-authors`, the total (text grand total and JSON `total`) is the sum
  of per-author hours over **all** authors; `--top` only limits the listing.
- `--json --compare` now emits the regular JSON payload plus a `compare` section
  (`range`, `total`, `delta`) instead of a separate `current`/`compare`/`delta`
  object.
- JSON `range` gains a `label` field.
- `--author` is a case-insensitive substring match on name or email (it was a
  case-sensitive regex).
- Only one date range may be given: `--month`, `--week`, the shortcuts, and
  `--since`/`--until` are mutually exclusive (some combinations used to silently
  override each other).

### Added

- `--compare` accepts open-ended ranges (`2025-03-01..`, `..2025-03-01`) and
  date-times on either side of `START..END`.
- `--compare` works with `--all-authors`.
- Animated progress spinner on stderr while reading git (TTY only).
- `npm run typecheck`, run in CI.
- Documented exit codes: `0` success, `1` git failure, `2` invalid arguments.

### Fixed

- A bare `--since`/`--until` date means local midnight; git used the current
  time of day.
- The `--daily` breakdown (and weekly subtotals) sum to the total: sessions
  crossing midnight are split between the two days instead of being estimated
  twice.
- `formatHours` no longer prints `01h 60m`.
- A negative `--compare` delta is printed with its minus sign.
- `--repo` accepts subdirectories of a work tree and bare repositories.

### Changed

- Header shows a compact window label (`2025-03`, `week of 2025-03-24`,
  `last-month (2025-09-01..2025-10-01)`) instead of raw timestamps.
- Internals restructured into a parse → read → report → render pipeline
  (`dates.ts`, `report.ts`, `render/*`), with async git reads.

## [1.0.0]

Initial release.
