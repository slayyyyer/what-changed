# ADR 0002 — A small adapter interface, one module per source

**Status:** accepted · 2026-11-04

## Context

The project ships two sources and expects a third. The interface has to be small enough that adding
a source is an afternoon, and strict enough that the integrity rules (gates, key stability,
privacy) cannot be skipped by accident. Two sources with genuinely different transports — ArcGIS
REST and a plain JSON API — already exist to test the shape against.

## Options

1. **One module exporting a fixed set of properties and functions** (chosen). Plain ESM, no
   registry magic, no class hierarchy. The registry is an array.
2. **A declarative JSON config** driving a generic fetcher. Tempting for the trivial cases, but every
   real source needs pagination, a date window, field renaming and privacy decisions. The config
   would grow into a language.
3. **A base class with hooks.** Adds ceremony and inheritance without buying anything; adapters are
   already singleton objects.
4. **A plugin package per source.** Solves a distribution problem this project does not have, and
   adds an install step.

## Decision

An adapter is an object with:

| Member | Required | Purpose |
| --- | --- | --- |
| `id`, `title`, `sourceUrl`, `license`, `publisher` | yes | Identity and attribution. |
| `fieldOrder` | yes | Snapshot order, display order, and the schema-drift contract. |
| `requiredFields`, `keyPattern` | yes | Gates that stop a broken payload from being stored. |
| `fetchSnapshot(ctx)` | yes | Returns `{raw, meta}`; `meta` carries `windowFrom/windowTo/etag/notes`. |
| `normalize(raw, ctx)` | yes | Returns records `{key, fields}` with **no personal data**. |
| `significance(item)` | yes | `{score, label}` for ordering. |
| `describe(item)` | yes | A templated sentence. No model, no invention. |
| `labelFor`, `linkFor` | no | Record title and the link back to the publisher. |
| `ignoreFields`, `caseInsensitiveFields`, `eventDateField` | no | Noise control and backfill detection. |
| `limits`, `notesForHumans`, `windowDays` | no | Per-source gate thresholds and honest framing shown on the page. |

`normalize` owns privacy: personal fields are dropped or coarsened before anything is written, so
they cannot reach the data branch, a diff, a feed or git history. It is tested against a real
publisher payload that *includes* the personal fields.

## Consequences

- Adding a source is one file plus one registry line; the pipeline, gates, diffing, ranking,
  archives, feeds and status table work unchanged. `README.md` shows a complete example.
- The interface cannot express a source whose previous state is needed to fetch the next page
  (cursor state across runs). No current source needs it; the `meta` bag leaves room.
- Every adapter is tested for interface completeness, key shape, field-list consistency, and PII
  absence. A fourth adapter that skips a required member fails tests, not production.
- Two transports prove the shape is not ArcGIS-specific. They do not prove it is universal; that is
  stated in the paper's limits.
