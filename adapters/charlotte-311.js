// Adapter: City of Charlotte 311 service requests.
//
// Verified 2026-11-04 against
// https://data.charlottenc.gov/datasets/service-requests-311 (item
// d656def619664c47aa95073dcf8928cd, CC BY 4.0). The portal serves an ArcGIS
// MapServer layer; there is no ETag/Last-Modified, no per-record permalink, and
// no "last edited" column, so this adapter works on a rolling window of received
// dates and compares consecutive snapshots.
//
// Privacy: the layer carries the caller's full street address, block number,
// coordinates and parcel id. None of that is published. See docs/privacy.md.

import { fetchJson } from '../lib/http.js';
import { addDays } from '../lib/time.js';
import { canonicalValue, dropEmpty } from '../lib/json.js';

const QUERY_URL =
  'https://gis.charlottenc.gov/arcgis/rest/services/ODP/ServiceRequests311/MapServer/0/query';
const PAGE_SIZE = 5000;
const MAX_PAGES = 12;
const WINDOW_DAYS = 14;

// Requested from the publisher. Deliberately excludes FULL_ADDRESS, BLOCK_NO,
// STREET_*, LATITUDE, LONGITUDE, X_COORD, Y_COORD, PID, GlobalID, OBJECTID,
// TITLE and INTERNAL_FIELD_OBSERVATION.
const OUT_FIELDS = [
  'REQUEST_NO',
  'REQUEST_TYPE',
  'DEPARTMENT',
  'DIVISION',
  'RECEIVED_DATE',
  'NEIGHBORHOOD_PROFILE_AREA',
  'COUNCIL_DISTRICT',
  'ZIP_CODE',
  'CITY',
  'STATE',
];

const NOTABLE_TYPES = /HOUSING|DEMOLITION|CONDEMN|UNSAFE|FLOOD|TREE|SIDEWALK|CROSSWALK|STREET LIGHT/i;

const charlotte311 = {
  id: 'charlotte-311',
  title: 'Charlotte 311 service requests',
  shortTitle: 'Charlotte 311',
  subtitle: 'New requests the city logged in the last two weeks, and the ones whose routing changed.',
  sourceUrl: 'https://data.charlottenc.gov/datasets/service-requests-311',
  publisher: 'City of Charlotte Open Data Portal',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  windowDays: WINDOW_DAYS,
  limits: {
    minRecords: 500,
    minCountRatio: 0.55,
    maxCountRatio: 1.9,
    maxChangeRatio: 0.35,
  },
  fieldOrder: [
    'requestNo',
    'requestType',
    'department',
    'division',
    'received',
    'neighborhood',
    'councilDistrict',
    'zip',
    'city',
    'state',
  ],
  fieldLabels: {
    requestNo: 'Request number',
    requestType: 'Request type',
    department: 'Department',
    division: 'Division',
    received: 'Received',
    neighborhood: 'Neighborhood profile area',
    councilDistrict: 'Council district',
    zip: 'ZIP code',
    city: 'City',
    state: 'State',
  },
  requiredFields: ['requestNo', 'requestType', 'received'],
  keyPattern: /^request-\d+$/,
  ignoreFields: [],
  caseInsensitiveFields: ['requestType', 'department', 'division', 'city', 'state'],
  eventDateField: 'received',
  notesForHumans:
    'Requests are compared across a rolling 14-day received-date window. A request that leaves the window is not a deletion, and the site says so.',

  async fetchSnapshot({ now, date, log }) {
    const windowFrom = addDays(date, -WINDOW_DAYS);
    const where = `RECEIVED_DATE >= DATE '${windowFrom}'`;
    const features = [];
    let pages = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        where,
        outFields: OUT_FIELDS.join(','),
        returnGeometry: 'false',
        orderByFields: 'REQUEST_NO ASC',
        resultOffset: String(page * PAGE_SIZE),
        resultRecordCount: String(PAGE_SIZE),
        f: 'json',
      });

      const response = await fetchJson(`${QUERY_URL}?${params}`, {
        timeoutMs: 60_000,
        log,
      });
      pages += 1;

      const body = response.body;
      if (body?.error) {
        throw new Error(`ArcGIS error ${body.error.code}: ${body.error.message}`);
      }
      if (!Array.isArray(body?.features)) {
        throw new Error('ArcGIS response had no features array');
      }

      features.push(...body.features);
      log(`charlotte-311: page ${pages} returned ${body.features.length} rows`);

      if (body.features.length < PAGE_SIZE) break;
      if (body.exceededTransferLimit === false) break;
    }

    if (features.length === 0) throw new Error('ArcGIS returned zero features');

    return {
      raw: features,
      meta: {
        windowFrom,
        windowTo: date,
        pages,
        etag: null,
        lastModified: null,
        notes: [
          'the publisher does not support conditional requests for this layer, so the full window is downloaded each run',
        ],
      },
    };
  },

  normalize(features) {
    const records = new Map();

    for (const feature of features) {
      const attributes = feature?.attributes || feature || {};
      const requestNo = toInt(attributes.REQUEST_NO);
      if (!requestNo) continue;

      const fields = dropEmpty({
        requestNo: String(requestNo),
        requestType: text(attributes.REQUEST_TYPE),
        department: text(attributes.DEPARTMENT),
        division: text(attributes.DIVISION),
        received: toIsoStamp(attributes.RECEIVED_DATE),
        neighborhood: text(attributes.NEIGHBORHOOD_PROFILE_AREA),
        councilDistrict: text(attributes.COUNCIL_DISTRICT),
        zip: text(attributes.ZIP_CODE),
        city: titleCase(text(attributes.CITY)),
        state: text(attributes.STATE),
      });

      const key = `request-${requestNo}`;
      if (!records.has(key)) records.set(key, { key, fields });
    }

    return [...records.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  },

  labelFor(item) {
    const type = item.fields.requestType || 'Service request';
    return `${titleCase(type)}`;
  },

  linkFor() {
    // The portal has no per-record permalink; every item links to the dataset.
    return 'https://data.charlottenc.gov/datasets/service-requests-311';
  },

  describe(item) {
    const type = item.fields.requestType ? titleCase(item.fields.requestType) : 'service request';
    const where = describePlace(item.fields);
    const received = item.fields.received ? item.fields.received.slice(0, 10) : null;

    if (item.kind === 'added') {
      if (item.late && received) {
        return `Appeared in the city's data today but is dated ${received}: ${type}${where}.`;
      }
      return `Logged with the city on ${received || 'an unstated date'}: ${type}${where}.`;
    }
    if (item.kind === 'removed') {
      return `Was in yesterday's snapshot and is not in today's, and its received date is still inside the window.`;
    }
    const parts = item.changes.map((change) => {
      const label = this.fieldLabels?.[change.name] || change.name;
      return `${label} ${change.from === null ? 'filled in' : `changed from “${change.from}” to “${change.to}”`}`;
    });
    return `${parts.join('; ')}${where}.`;
  },

  significance(item) {
    const type = item.fields.requestType || '';
    const notable = NOTABLE_TYPES.test(type);
    if (item.kind === 'changed') {
      return { score: 3.4 + item.changes.length * 0.3, label: 'rerouted' };
    }
    if (item.kind === 'removed') {
      return { score: 2.8, label: 'dropped by publisher' };
    }
    if (item.late) {
      return { score: 2.2, label: 'backfilled' };
    }
    return { score: notable ? 1.9 : 1, label: 'new request' };
  },
};

function describePlace(fields) {
  const bits = [];
  if (fields.councilDistrict) bits.push(`council district ${fields.councilDistrict}`);
  if (fields.zip) bits.push(`ZIP ${fields.zip}`);
  return bits.length ? ` in ${bits.join(', ')}` : '';
}

function text(value) {
  if (value === null || value === undefined) return null;
  const value_ = canonicalValue(value);
  return value_ === '' ? null : value_;
}

function toInt(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

/** ArcGIS dates are epoch milliseconds; store ISO-8601 UTC so diffs compare as strings. */
function toIsoStamp(value) {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return new Date(number).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function titleCase(value) {
  if (!value) return '';
  const lower = value.toLowerCase();
  // Keep all-caps acronyms readable without mangling short codes.
  return lower.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

export default charlotte311;
