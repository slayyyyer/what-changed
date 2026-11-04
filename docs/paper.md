# What Changed Today — a daily diff of public data

## 1. The problem with "here is a dashboard"

Most public-data projects show you the current state of something: a map, a table, a count. That
answers "what is", which the publisher already answers better. The question a person actually asks
about a city or a federal agency is *what changed since I last looked* — and almost nobody
publishes that, because publishing it requires owning the comparison.

This project owns the comparison. Every day it takes a snapshot, compares it to the previous one
field by field, and publishes only the difference. The diff is the product; the current state is
not shown at all.

## 2. Shape

```
GitHub Actions (daily)                      GitHub Pages (static)
┌───────────────────────────┐               ┌──────────────────────────┐
│ adapters → normalize      │               │ dist/index.html          │
│ gates → quarantine?       │               │ dist/sources/<id>/…      │
│ diff → rank               │──data branch──▶│ dist/feed.xml            │
│ store snapshots + diffs   │               │ dist/data/today.json     │
└───────────────────────────┘               └──────────────────────────┘
```

Two adapters ship: Charlotte 311 service requests (ArcGIS, ~12.6k rows in a 14-day window) and the
Federal Register (JSON API, ~1.5k documents in 21 days). One run is about 3 + 2 HTTP requests and
roughly 8 seconds.

## 3. The records

Normalization produces records, not rows:

```json
{"key":"request-11153566","fields":{"requestNo":"11153566","requestType":"NON-RECYCLABLE ITEMS", …}}
```

`key` is the publisher's stable identifier, prefixed by source. `fields` holds display-ready
strings in the adapter's declared order. **A field exists only when it has a value** — absent and
empty are the same thing, which is what makes the diff, the snapshot format and the patch applier
agree. Values are canonicalized (NFKC, whitespace collapsed, line endings normalized) before
comparison, so a publisher reformatting a string is not reported as a change. Adapters may declare
fields as case-insensitive (codes, agency names) and fields as ignored entirely (derived URLs).

## 4. Diff semantics

```
diff(previous, current) → {
  added:   [{key, fields}],
  removed: [{key, fields}],                  // last known values
  changed: [{key, fields, changes: [{name, from, to}]}],
  unchanged: n,
  stats: {added, removed, changed, unchanged, fieldChanges, recordsBefore, recordsAfter}
}
```

Pure functions, sorted by key, byte-identical for identical input. `applyDiff(previous, diff)`
reconstructs `current`; the property test checks this over seeded random snapshots, plus
`diff(a, a)` is empty and repeated runs produce identical bytes.

Four things are deliberately *not* reported as changes:

1. **Whitespace and Unicode formatting** — canonicalized before comparison.
2. **Fields the adapter ignores** — derived values, retrieval timestamps.
3. **Records that aged out of a rolling window.** The window moves daily; a record leaving it is
   not a deletion by the publisher. The pipeline partitions removals by their event date and
   reports them as `expired`, shown as "aged out" and excluded from the deletion count.
4. **Case changes in declared case-insensitive fields.**

And two things are labelled rather than silently classified:

- **Backfilled**: added to the snapshot, but its event date is older than the previous snapshot was
  taken. Publishers revise history; calling that "new today" would be false.
- **Baseline**: the first snapshot for a source has nothing to compare to, so it produces no diff
  and the site says so.

## 5. Integrity rules

### 5.1 "No snapshot" is not "no changes"

A source that fails never yields an empty diff. `runSource` writes `status/<id>.json` with
`result: "error"`, the reason, and the last good time; `latest.ndjson` is untouched; no diff file is
written. Rendering keys off `result`, and `isFresh()` also treats a status from a previous day as
stale, so an offline re-render cannot present yesterday's success as today's snapshot.

This is the single most important rule, because the failure mode is invisible: a fetch that times
out at 3 a.m. would otherwise publish a confident, empty page.

### 5.2 Gates and quarantine

Before a snapshot is accepted:

| Gate | Failure |
| --- | --- |
| Non-empty | quarantine |
| At least N records (per adapter) | quarantine |
| Every required field non-empty | quarantine |
| Keys match the declared pattern, no duplicates | quarantine |
| Record count within 0.55–1.9× of previous | quarantine |
| Fewer than 35% of records changed at once | quarantine |
| Unexpected fields | visible note |
| Fields that used to carry values have vanished | visible note |
| More than 6 fields' worth of drift | quarantine |

On quarantine the previous `latest` is kept, the reason and the rejected row count are published,
and **no diff is emitted**. A mass rewrite — a column rename, a re-export, a portal migration — is
indistinguishable from a day of real events by count alone, so it is quarantined and a human looks.

The mass-change threshold is why the 311 adapter's window matters: with 240 records and 14% of them
touched, a normal day sits far below the gate; a schema break sits far above it.

### 5.3 Schema drift

Adapters declare `fieldOrder`. New field names are a notice. Fields that previously carried values
and stopped are a notice. A field that has never carried a value is simply optional, not drift —
otherwise the Federal Register's occasionally-null `effective_on` would warn every single day.

### 5.4 Determinism and idempotence

Snapshots are NDJSON, sorted by key, fields in declared order, one trailing newline. The snapshot's
SHA-256 is stored in status. A re-run that produces the same bytes writes only the status file and
**no diff**, so re-running a workflow cannot duplicate a day or rewrite an archived diff. Diff JSON
goes through a recursive key sort.

### 5.5 Time

The pipeline runs on UTC; the site shows Eastern time (the publishers' clock) with UTC alongside.
Every item carries the two snapshot timestamps it came from. The site never implies a real-world
event time that the data does not support: a 311 `received` timestamp is when the city logged the
request, which is not when the pothole appeared.

## 6. Storage

History lives on a `data` branch, not in the Pages deployment. That decision and its alternatives
are in `docs/adr/0001-snapshot-storage.md`. In short: a failed deploy cannot lose a day, `git diff`
on the data branch is a readable record of what the pipeline did, and the site build reads only from
that branch.

Sizes at v1: 311 snapshot ~2.4 MB (12.6k records), Federal Register ~1.2 MB. A daily diff is
~150–250 KB before git compression, dominated by 311 arrivals. Yearly growth is bounded by the
window sizes, not by publisher history; `docs/adr/0001` states the alarm thresholds.

## 7. Ranking

Ranking never hides anything: the front page shows a dozen, "everything" shows all of it, and every
archived day page shows all of that day. The score is a small rule set per adapter:

- Charlotte 311: re-routed records (3.4+) > dropped by publisher (2.8) > backfilled (2.2) >
  new request (1.0, or 1.9 for housing, trees, flooding, sidewalks).
- Federal Register: Presidential Document 5 > final Rule 4 > Proposed Rule 3 > Notice 1.2, +2 for a
  correction, +0.8 when the effective date is within two weeks.

Ties break on key, so ordering is deterministic.

## 8. The site

Plain HTML, CSS and one progressive-enhancement script. The front page, "everything" page, every
source page and every archive page are rendered at build time — the site works with JavaScript
disabled. JavaScript only filters rows that are already in the DOM. Data is also published as JSON
(`/data/today.json`, `/data/archive.json`) and as Atom feeds per source plus one combined feed.

Accessibility: semantic landmarks, a skip link, `aria-current`, labelled tables, visible focus,
`prefers-color-scheme` and `prefers-reduced-motion` respected, no motion that isn't a hover.

## 9. Limits, stated plainly

- **A window is not the whole dataset.** 14 days of 311, 21 days of Federal Register. A record that
  changes after it leaves the window is invisible here.
- **The diff is only as good as the publisher's identifiers.** If a publisher reissues a record
  under a new key, it appears as one removal and one addition. Nothing can infer otherwise.
- **Charlotte 311 has no modification timestamp**, so field changes are only observable while a
  record is inside the window.
- **Federal Register is append-only in practice.** "Changed" is rare and usually a correction
  published as a new document.
- **One source is one HTTP shape.** Two adapters prove the interface across two transports, not
  across every possible one.
- **Scheduled workflows can be disabled** after 60 days of repository inactivity. The pipeline
  commits status to the data branch every day, and `docs/adr/0004` records the uncertainty about
  whether that counts plus the monthly keepalive as a second line of defence. *Unverified:* GitHub's
  exact definition of "activity" for this rule.

## 10. Testing

`node tests/run.js` — 61 tests, no network, no dependencies. Diff engine (including determinism and
patch round-trip), normalization, ranking, every gate, both adapters against real trimmed payloads,
snapshot storage, the pipeline's failure/quarantine/idempotence/window behaviour, and seeded
property tests. The pipeline tests are the acceptance criteria: a forced fetch failure produces
`error` and leaves `latest.ndjson` byte-identical; a synthetic mass rewrite produces `quarantined`
and no diff file.

## 11. What would come next

1. A source with real record mutations and a modification timestamp — the thing 311 cannot offer.
2. Yearly history squash once the data branch passes the size alarm.
3. Per-field "first seen" annotations, derived from the archive, not from a model.

Model-written summaries remain out of scope. If they are ever added, the writer gets finished
numbers and instructions not to invent any — the same rule as the Charlotte Almanac.
