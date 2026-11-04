# Privacy

The rule: **nothing that identifies a person reaches the repository, the data branch, or the
published site.** Fields are dropped or coarsened in `normalize()`, before anything is written.
Personal data never exists in `_data/`, so it can never leak through a diff, an archive page, a
feed, or git history.

Verified against live payloads on 2026-11-04.

---

## Charlotte 311 service requests

A 311 request is filed by, or about, a specific household. The type plus the address can be enough
to identify someone — a housing complaint, a hoarding report, a "check on the resident" request.
The publisher's layer carries the caller's full street address, block number, coordinates, parcel
id and an internal observation flag.

| Field (publisher) | Treatment | Notes |
| --- | --- | --- |
| `REQUEST_NO` | **kept** | The record key. A case number, not a person. |
| `REQUEST_TYPE` | **kept** | Category, e.g. `BLOCKAGE`. |
| `DEPARTMENT`, `DIVISION` | **kept** | Which city unit is responsible. |
| `RECEIVED_DATE` | **kept** | Epoch ms → ISO-8601 UTC. |
| `NEIGHBORHOOD_PROFILE_AREA` | **kept** | City geography, ~neighborhood scale. |
| `COUNCIL_DISTRICT` | **kept** | Coarse political boundary (1–7). |
| `ZIP_CODE` | **kept** | Coarse; a ZIP holds tens of thousands of people. |
| `CITY`, `STATE` | **kept** | |
| `FULL_ADDRESS` | **dropped** | Exact address of a resident's home. |
| `BLOCK_NO`, `STREET_NAME`, `STREET_DIRECTION`, `STREET_TYPE` | **dropped** | Block-level address is still identifying at 311 volume. |
| `LATITUDE`, `LONGITUDE`, `X_COORD`, `Y_COORD` | **dropped** | Precise coordinates. |
| `PID` (parcel id), `GlobalID`, `OBJECTID` | **dropped** | Parcel id resolves to an owner. |
| `TITLE`, `INTERNAL_FIELD_OBSERVATION` | **dropped** | Free-ish text / internal notes; the request type carries the meaning. |
| `CMPD_DIVISION`, `FISCAL_YEAR`, `FISCAL_MONTH` | **dropped** | Redundant with what is kept; fiscal month is derivable from the date. |

Tested: `tests/adapters.test.js` asserts that the normalized snapshot contains no address, street
name, coordinate, parcel id or GlobalID, and that no field outside `fieldOrder` survives. The
fixtures are **real publisher payloads, including the personal fields**, precisely so that this
test is meaningful.

What is still said: that a `HOUSING` request was logged in council district 4 and ZIP 28202 on a
given day. That is a record-level fact the publisher already makes public, coarsened to a
neighborhood scale. It is not framed as a finding about anyone.

## Federal Register

| Field | Treatment |
| --- | --- |
| `document_number`, `type`, `title`, `agencies`, `publication_date`, `effective_on`, `comments_close_on`, `action`, `page_length`, `correction_of`, `html_url` | **kept** — all public, institutional |

Federal Register documents are US Government work. No personal fields are requested: the adapter
asks for an explicit `fields[]` list, so dockets, abstracts, comment counts and any signatory data
are never downloaded in the first place. Titles are institutional ("Streamlining Contested
Adjudications in Licensing Proceedings"), not personal.

## Fields that are never compared

`url` on Federal Register records is derived from `document_number`; it is stored for linking and
excluded from the diff (`ignoreFields`) so a CDN change cannot look like a data change.

## If a new source is added

The checklist is: list every field, mark each kept/dropped/coarsened, write the reason, add a test
asserting the dropped ones are absent from a real fixture, and update this file. If the publisher's
terms forbid redistribution of a field, the field is not fetched.
