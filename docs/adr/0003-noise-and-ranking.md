# ADR 0003 — Noise, ranking, and never hiding a change

**Status:** accepted · 2026-11-04

## Context

Two failure modes ruin a diff product. One: it reports its own noise — a reformatted field, a
re-fetched timestamp, a URL that changed host. Two: it sorts by "interesting" and shows twelve
items, so the rest are effectively invisible.

## Decision — noise

Comparison happens on a canonical form, not on bytes:

- Unicode NFKC, `\r\n` → `\n`, all whitespace runs (including non-breaking spaces) collapsed to one
  space, trimmed. Publisher formatting churn is not a change.
- Fields listed in `ignoreFields` are never compared. Federal Register `url` is derived from
  `document_number`, so a CDN change cannot look like a data change.
- Fields listed in `caseInsensitiveFields` compare case-insensitively. Agency names and request
  types are the publisher's formatting, not a fact that changed.
- Values are stored as display strings (`old → new` must read correctly), so numeric fields are
  stringified in `normalize` and compared as text. A publisher switching `1.0` to `1` is a change;
  that is accepted as the cost of readable diffs.

**Rejected:** automatic numeric tolerance. A valuation moving from 100 to 101 is a real change;
guessing a threshold hides it.

## Decision — ranking

Scoring is a small per-adapter rule set (see `docs/paper.md` §7). Ordering is
`score desc → kind → key`, so it is deterministic.

Ranking **never filters**. The front page caps at twelve, links to "everything", and every archived
day page lists the full diff. The `everything` page is pre-rendered HTML, so completeness does not
depend on JavaScript.

**Rejected:** dropping low-significance items from the archive to keep it small. The archive is the
product; size is handled in ADR 0001 instead.

## Consequences

- A quiet day is genuinely quiet, not "twelve items of formatting churn".
- A noisy day (900+ new 311 requests) is honest but long; the "everything" page is the complete
  list and the front page says how many it is not showing.
- Ranking weights are hand-set and arguable. They are documented per adapter rather than tuned
  invisibly, and a wrong weight changes order, never truth.
