# ADR 0001 — Snapshot storage on a `data` branch

**Status:** accepted · 2026-11-04

## Context

The site needs yesterday's snapshot to compute today's diff, and it needs the diffs kept as an
archive. The site is served from GitHub Pages, which is a deploy artifact, not a database. Actions
runners are ephemeral, so anything not committed is lost.

Murmur (a sibling project) reads its previous state back out of the published Pages deployment.
That works until a deploy fails after a successful fetch: the new state is live in memory, the
deploy is rolled back, and the next run diffs against older data with no way to tell. Worse for this
project, because a lost snapshot is invisible — it looks like a day with no changes.

## Options

| Option | Verdict |
| --- | --- |
| **`data` branch** (chosen) | Durable, independent of deploys, reviewable as `git diff`, free, no external service. Costs repository size, and requires the pipeline to commit and push. |
| Releases assets | Also durable and free, but assets are opaque blobs: no line-level history, awkward to read, and GitHub's release asset limits are unfriendly to daily files (1000 assets/release, 2 GB/asset). |
| Read the previous Pages deployment | No history, and a failed deploy silently loses a day. This is the failure mode the project exists to avoid. |
| External database / S3 | Breaks the "free, no account, no secrets" constraint. |

## Decision

Snapshots, diffs and status live on a `data` branch, checked out into `_data/` by the workflow with
`git worktree`. `_data/` is gitignored on `main`.

```
snapshots/<id>/latest.ndjson     sorted by key, declared field order, overwritten daily
diffs/<id>/YYYY-MM-DD.json       one per day, never rewritten
status/<id>.json                 last attempt, last success, reason, counts, SHA-256
```

`latest.ndjson` is newline-delimited JSON rather than one big array so that a day's change is a
readable `git diff` (one record per line), and sorted by key so the delta is small and local rather
than a reshuffle.

## Consequences

- A failed deploy cannot lose data: the branch is pushed before the Pages artifact is uploaded.
- A repeat run with identical bytes writes only `status/` and produces no diff file, so re-running
  the workflow is idempotent and cannot duplicate a day.
- The archive is *not* rewritten. A day's diff is the comparison that was published at the time;
  re-deriving it later from changing data would be a different claim.
- The repository grows by roughly 150–250 KB/day of uncompressed diff JSON, far less compressed.
- The build reads every archived diff to render day pages. That is fine for years, not decades;
  the squash plan below exists for when it stops being fine.

## Size plan

Measured at v1 (2026-11-04): 12,621-row 311 snapshot ≈ 2.4 MB, 1,490-document Federal Register
snapshot ≈ 1.2 MB, daily diff 150–250 KB before git compression.

- `scripts/check-size.js` runs before every data-branch push. Warns at **150 MB**, refuses at
  **500 MB**. Both are far under GitHub's 1 GB recommendation and 5 GB hard block.
- When the alarm warns: squash diffs older than 13 months into one
  `diffs/<id>/history/YYYY.json` (per-day stats only, items dropped), keep the most recent year
  full-fidelity, and record the squash in this ADR.
- If a source's window is the cause, narrow the window in the adapter rather than dropping days.

## Reversibility

The data branch is plain files under a plain layout. Moving to Releases or an object store later is
a copy, not a migration.
