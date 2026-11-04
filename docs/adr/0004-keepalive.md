# ADR 0004 — Keeping the schedule alive

**Status:** accepted, with one unverified assumption · 2026-11-04

## Context

GitHub disables scheduled workflows in public repositories after **60 days without repository
activity**. This project is entirely scheduled: if the workflow is disabled, the site silently
freezes at its last day, which is exactly the failure the project promises never to present as
"no changes".

The documented trigger is repository activity, but GitHub's documentation does not say explicitly
whether a push to a non-default branch (the `data` branch) counts. **This is the unverified part.**
It cannot be tested without waiting 60 days.

## Decision

Two independent lines of defence, plus a way to notice:

1. **Daily status commit.** Every run writes `status/<source>.json`, including the timestamp of the
   attempt, so the pipeline commits to the `data` branch every single day even when no dataset
   changed. If pushes to any branch count as activity, this is sufficient on its own.
2. **Monthly keepalive workflow.** On the 1st of each month, `keepalive.yml` checks the age of the
   last `data` branch commit and, if it is older than 45 days, pushes an empty commit. That is
   activity on the same branch by a different mechanism.
3. **Visible staleness.** The footer shows the build time and each source's last good snapshot, and
   `isFresh()` treats a status from a previous day as stale, so a frozen site says "no snapshot
   today" rather than showing yesterday's success as today's.

## What to check, and when

After 60 days of operation:

- Confirm the workflow is still enabled (Actions tab, or `gh workflow list`).
- If it was disabled, the daily status commit does not count. In that case, move the keepalive to a
  commit on `main` (an empty `chore: keepalive` commit monthly) and note it here.
- Confirm `status/*.json` timestamps are advancing daily, which is also the cheapest way to detect
  a silently dead schedule from outside.

## Consequences

- A daily commit to the data branch, even on quiet days. That is the point: it is both a heartbeat
  and a record of when the pipeline ran.
- One extra workflow, which costs nothing on a public repository.
- If the assumption is wrong, the failure is visible within a day (stale footer), not at the next
  time someone happens to look.
