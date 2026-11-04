# What Changed Today

A static site that snapshots a handful of public datasets once a day and publishes **only what
changed** between two snapshots. The diff is the product.

Live: **https://slayyyyer.github.io/what-changed/**

- Charlotte 311 service requests — `data.charlottenc.gov`, CC BY 4.0
- Federal Register — `federalregister.gov`, US Government work

No server, no database, no runtime dependencies, no accounts, no API keys. GitHub Actions fetches
and diffs; GitHub Pages serves the result.

---

## What this is

A daily, field-level comparison of public records. Every item shows the fields that moved
(`old → new`), the two snapshot times being compared, and a link back to the publisher. Records
that appear for the first time are labelled new, records that appear with an older date are
labelled backfilled, and records that leave a rolling window are labelled aged out rather than
deleted.

## What this is not

- **Not live.** One comparison per day, from two snapshots.
- **Not a complete copy of any publisher's data.** Each source has a declared window (14 days for
  311, 21 for the Federal Register). Changes to records outside the window are not observed, and
  each source page says so.
- **Not a claim about the world.** It reports that a record changed, never why. No inference, no
  model-written summaries, no accusations.
- **Not allowed to say "0 changes" when it has no data.** A failed fetch is published as *no
  snapshot today*, with the last good time. See `docs/paper.md`.

---

## Run it locally

Node 20 or newer. Nothing else — there is no install step.

```bash
node tests/run.js        # 61 tests, offline, no network
node build.js            # fetch both sources, write ./_data, render ./dist
node build.js --offline  # no network: re-render the site from what is already in ./_data
node serve.js            # http://localhost:8080/ (serves ./dist)
node scripts/make-og.js  # regenerate site/og.png
```

`build.js` accepts `--data-dir <path>`, `--out <path>`, `--base-url <url>` and `--now <ISO date>`
(useful for testing a specific date's rendering).

The first run for a source writes a **baseline** and emits no diff — there is nothing to compare
yet. The second run is the first real diff.

## How it works

```
adapters/<source>.js   fetchSnapshot → normalize → records with stable keys
        │
lib/gates.js           empty? too small? keys valid? required fields? count swing? mass rewrite?
        │              (fail → quarantine: keep yesterday's snapshot, publish the reason)
lib/diff.js            pure field-level diff against the previous snapshot
        │
_data/ (data branch)   snapshots/<id>/latest.ndjson   normalized, sorted, overwritten daily
        │              diffs/<id>/YYYY-MM-DD.json     permanent archive
        │              status/<id>.json               last attempt, last success, reason, hash
lib/pages.js           pre-rendered HTML, Atom feeds, JSON payloads → dist/
```

More: `docs/paper.md`, `docs/adr/`, `docs/diagrams/`.

## Adding a third adapter

One module and one line. The interface is deliberately small:

```js
// adapters/my-source.js
import { fetchJson } from '../lib/http.js';

export default {
  id: 'my-source',
  title: 'My source',
  sourceUrl: 'https://example.gov/data',
  license: 'CC BY 4.0',
  publisher: 'Example Agency',

  windowDays: 7,
  fieldOrder: ['recordId', 'status', 'updated'], // display + snapshot order
  requiredFields: ['recordId', 'status'],        // missing on any record → quarantine
  keyPattern: /^rec-\d+$/,
  ignoreFields: ['retrievedAt'],                 // never compared
  caseInsensitiveFields: ['status'],
  eventDateField: 'updated',                     // drives the "backfilled" label
  limits: { minRecords: 50, maxChangeRatio: 0.3 }, // sanity gates

  async fetchSnapshot({ date, log }) {
    const response = await fetchJson(`https://example.gov/api?since=${date}`, { log });
    return { raw: response.body, meta: { windowFrom: date, windowTo: date } };
  },

  normalize(records) {
    return records.map((row) => ({
      key: `rec-${row.id}`,
      fields: { recordId: String(row.id), status: row.status, updated: row.updated },
    }));
  },

  labelFor(item) { return item.fields.recordId; },
  linkFor(item) { return `https://example.gov/records/${item.fields.recordId}`; },
  describe(item) { return `${item.fields.status} in ${item.fields.updated}.`; },
  significance(item) { return { score: item.kind === 'changed' ? 2 : 1, label: item.kind }; },
};
```

Then register it in `adapters/index.js` and add a fixture plus a test in `tests/adapters.test.js`.
Everything else — gates, diffing, ranking, archives, feeds, pages, the footer status table —
works unchanged.

## The data branch

History lives on a `data` branch, not in the Pages deployment, so a failed deploy cannot lose a
day. Layout:

```
snapshots/<source>/latest.ndjson    sorted by key, stable field order, overwritten daily
diffs/<source>/YYYY-MM-DD.json      one per day, never rewritten (a repeat run is a no-op)
status/<source>.json                last attempt, last success, reason, record count, hash
```

Snapshots are NDJSON so a day's change is a readable `git diff`, and sorted so the delta stays
small. `docs/adr/0001-snapshot-storage.md` compares this with the alternatives and states the
size plan.

## Constraints

Free infrastructure only: a public repository (so Actions minutes are free) and GitHub Pages.
No paid services, no cloud account, no secrets. The only dependencies are Node's standard library.

## Attribution

Charlotte open data is published by the City of Charlotte under CC BY 4.0; the Federal Register is
public domain. Every item links to the record it came from. Terms and cadence for each source are
recorded in `docs/sources.md`.

## License

MIT for the code. The data belongs to its publishers.
