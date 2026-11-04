# Sources

Every claim below was checked against the live service on **2026-11-04**, before the adapter was
written. Numbers are what the endpoints returned that day, not estimates. Anything still uncertain
is marked.

## Shipped in v1

### 1. Charlotte 311 service requests — `charlotte-311`

| | |
| --- | --- |
| Portal page | https://data.charlottenc.gov/datasets/service-requests-311 |
| API | ArcGIS MapServer layer: `https://gis.charlottenc.gov/arcgis/rest/services/ODP/ServiceRequests311/MapServer/0/query` |
| Item id | `d656def619664c47aa95073dcf8928cd` (owner `CharlotteNC`, org `9Nl857LBlQVyzq54`) |
| License | **CC BY 4.0** (`licenseInfo` on the item) |
| Format | JSON (Esri). `returnGeometry=false`, `f=json`, `resultOffset` paging |
| Row limit | `maxRecordCount: 7500`; the adapter pages at 5000 with `orderByFields=REQUEST_NO ASC` |
| Size | 4.06 M rows in total (FY2017–FY2028). **32,392** rows received since 2026-10-01. **12,621** rows in the 14-day window on 2026-11-04 (3 pages) |
| Cadence | Continuous; the layer is a live view of the 311 case system. Roughly 900–1,000 new rows/day |
| Conditional requests | **No.** No `ETag`, no `Last-Modified` on the query endpoint |
| Change signal | No "last edited" column. Changes are detected by comparing consecutive snapshots of a rolling received-date window |
| Robots | `gis.charlottenc.gov/robots.txt` → 404 (no rules). The Hub host `data.charlottenc.gov` returns `Crawl-delay: 60` and disallows `/sites/`, `/admin/`, `/people/`, etc.; the pipeline never crawls the Hub, it queries the GIS endpoint once a day |
| Fetch cost | 3 requests/day, ~9 MB |

Kept because it is local, genuinely daily, honest about its own limitations, and reaches records a
resident can recognise. Its weakness is that it is **add-dominated**: a request's fields rarely
change after intake, so most days the diff is arrivals plus a handful of re-routings. The site says
that in plain language rather than dressing it up.

Fields the layer publishes but this project does not use: `FULL_ADDRESS`, `BLOCK_NO`,
`STREET_NAME/DIRECTION/TYPE`, `LATITUDE/LONGITUDE`, `X_COORD/Y_COORD`, `PID`, `GlobalID`,
`OBJECTID`, `TITLE`, `INTERNAL_FIELD_OBSERVATION`, `CMPD_DIVISION`, `FISCAL_YEAR/MONTH`.
See `privacy.md`.

### 2. Federal Register — `federal-register`

| | |
| --- | --- |
| Portal | https://www.federalregister.gov/ |
| API docs | https://www.federalregister.gov/developers/documentation/api/v1 |
| Endpoint | `https://www.federalregister.gov/api/v1/documents.json` |
| Auth | **None.** No key, no registration, no quota advertised |
| License | US Government work, public domain |
| Format | JSON, `per_page` up to 1000, `page` paging, `conditions[publication_date][gte]=YYYY-MM-DD` |
| Size | **1,490** documents published 2026-10-14 → 2026-11-04 (2 pages of 1000) |
| Cadence | Daily, weekdays, on a publication schedule (documents are filed, then published) |
| Conditional requests | Not needed; the date-window query is deterministic |
| Robots | `fedederalregister.gov/robots.txt` disallows `/documents/current`, `/documents/search`, `/articles/search`, `/my/`; `/api/v1/documents.json` is **not** disallowed |
| Field names | `page_length` is the page count. **`pages` is not a valid field** and returns HTTP 400 — found the hard way; the adapter requests `page_length` |

Kept because it is a clean, stable, well-documented API with real institutional consequence, it
proves the adapter interface across a second transport and schema, and it needs no key. Its
weakness is that publication is **close to append-only**: the diff is mostly "documents published",
with the occasional correction (published as its own document, `C1-*`) or effective-date revision.
The source page states that.

## Verified and not shipped

### NC General Assembly bill actions — `ncleg.gov`

- Official machine access is limited to **RSS and HTML**: `https://www.ncleg.gov/About/Webservices`
  lists bill-history feeds (`https://webservices.ncleg.gov/BillHistory/2017/H1/RSS` works and
  returns per-action `<item>`s) and HTML endpoints such as
  `https://www.ncleg.gov/Legislation/Bills/LastActionByYear/2025/All/RSS`.
  `LastActionByYear/.../RSS` returned an HTML page, not a feed, on 2026-11-04.
- There is no documented bulk JSON download. Scraping the HTML bill pages would mean thousands of
  requests and a fragile parser, which fails the "good citizen" rule.
- Activity is **bursty by design**: the 2025 long session is over, November is interim, and the
  useful signal is nearly zero for months at a time.
- Verdict: the right shape of data — real status transitions — with the wrong access story and the
  wrong calendar for a daily product. Revisit if the GA publishes a bulk feed, or scope it to
  "bills with any action in the last 7 days" during session.

### Mecklenburg County building permits — `meckgis`

- Layer: `https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits/FeatureServer/0`
- **482,349** rows. Fields include `permitstat`, `permittype`, `issuedate`, `compldate`,
  `bldgcost`, `numunits` — excellent mutation material.
- Two blockers. First, it publishes **`ownname`** (owner name) and `projadd` (exact address); both
  would have to be dropped, fine, but owner names in a public permit file are exactly the kind of
  thing this project should not mirror. Second, and worse for the product: there is **no
  last-edited column**, and `maxRecordCount` is 2000, so observing a completion on a permit issued
  two years ago is not possible without pulling the whole 482k-row layer daily. An issue-date
  window would only ever show new permits, which is not a diff.
- Verdict: good data, wrong observability for a daily diff. Would work with a publisher-provided
  `last_updated` field or an incremental-query endpoint.

### Federal Register as "everything" — considered and rejected

Querying all ~1,500 documents a day into a "new this week" view was considered as a third adapter
and dropped: it is the same source twice, which proves nothing about the interface. Better to add a
source with a genuinely different shape (a status tracker with real mutations) when one is
available.

## Publisher manners (all sources)

- One fetch per source per day. No parallel fan-out.
- `User-Agent: what-changed/1.0 (+https://github.com/slayyyyer/what-changed; slayyyyer@users.noreply.github.com)`
- `Retry-After` honored, exponential backoff, at most 3 retries, 45–60 s timeouts.
- Conditional requests sent where the publisher supports them (Federal Register does not need
  them; the Charlotte layer does not support them — both facts are stated on the source pages).
- Every item links back to the publisher's own page.
- Nothing is republished that the terms forbid. Charlotte is CC BY 4.0 (attribution given in the
  page footer and here); the Federal Register is public domain.
