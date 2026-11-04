// Adapter: Federal Register documents.
//
// Verified 2026-11-04 against https://www.federalregister.gov/developers/documentation/api/v1
// (public JSON API, no key, no registration). Documents are US Government work
// and in the public domain.
//
// Honest framing: this feed is close to append-only. Most days the diff is
// "documents published", plus the occasional correction or effective-date change.
// That is a different shape of change from a status tracker, and the site says so.

import { fetchJson } from '../lib/http.js';
import { addDays } from '../lib/time.js';
import { canonicalValue, dropEmpty } from '../lib/json.js';

const API_URL = 'https://www.federalregister.gov/api/v1/documents.json';
const PAGE_SIZE = 1000;
const MAX_PAGES = 8;
const WINDOW_DAYS = 21;

const FIELDS = [
  'document_number',
  'title',
  'type',
  'publication_date',
  'agencies',
  'correction_of',
  'effective_on',
  'comments_close_on',
  'action',
  'page_length',
  'html_url',
];

const TYPE_WEIGHT = {
  'Presidential Document': 5,
  Rule: 4,
  'Proposed Rule': 3,
  Notice: 1.2,
};

const federalRegister = {
  id: 'federal-register',
  title: 'Federal Register',
  shortTitle: 'Federal Register',
  subtitle: 'Rules, proposed rules and notices published in the last three weeks.',
  sourceUrl: 'https://www.federalregister.gov/',
  publisher: 'Office of the Federal Register',
  license: 'Public domain (US Government work)',
  licenseUrl: 'https://www.usa.gov/government-works',
  windowDays: WINDOW_DAYS,
  limits: {
    minRecords: 100,
    minCountRatio: 0.5,
    maxCountRatio: 2.2,
    maxChangeRatio: 0.4,
  },
  fieldOrder: [
    'documentNumber',
    'type',
    'title',
    'agency',
    'agencyCount',
    'publicationDate',
    'effectiveOn',
    'commentsCloseOn',
    'action',
    'pages',
    'correctionOf',
    'url',
  ],
  fieldLabels: {
    documentNumber: 'Document number',
    type: 'Document type',
    title: 'Title',
    agency: 'Agency',
    agencyCount: 'Agencies listed',
    publicationDate: 'Publication date',
    effectiveOn: 'Effective date',
    commentsCloseOn: 'Comments close',
    action: 'Action',
    pages: 'Pages',
    correctionOf: 'Corrects document',
    url: 'Document URL',
  },
  requiredFields: ['documentNumber', 'title', 'publicationDate'],
  keyPattern: /^fr-[A-Z0-9-]+$/,
  ignoreFields: ['url'],
  caseInsensitiveFields: ['type', 'agency'],
  eventDateField: 'publicationDate',
  notesForHumans:
    'Publication is mostly one-way: new documents arrive and rarely change. A “correction” is itself a published document, so it shows up as a new item that points at what it corrects.',

  async fetchSnapshot({ date, log }) {
    const windowFrom = addDays(date, -WINDOW_DAYS);
    const collected = [];
    let pages = 0;
    let declaredCount = null;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        per_page: String(PAGE_SIZE),
        page: String(page),
        order: 'newest',
        'conditions[publication_date][gte]': windowFrom,
      });
      for (const field of FIELDS) params.append('fields[]', field);

      const response = await fetchJson(`${API_URL}?${params}`, { log });
      pages += 1;
      const body = response.body || {};
      if (!Array.isArray(body.results)) throw new Error('Federal Register response had no results array');

      if (declaredCount === null && Number.isFinite(body.count)) declaredCount = body.count;
      collected.push(...body.results);
      log(`federal-register: page ${pages} returned ${body.results.length} documents (of ${declaredCount ?? '?'})`);

      if (body.results.length < PAGE_SIZE) break;
      if (declaredCount !== null && collected.length >= declaredCount) break;
      if (Number.isFinite(body.total_pages) && page >= body.total_pages) break;
    }

    if (collected.length === 0) throw new Error('Federal Register returned no documents');

    const truncated = declaredCount !== null && collected.length < declaredCount;

    return {
      raw: collected,
      meta: {
        windowFrom,
        windowTo: date,
        pages,
        declaredCount,
        truncated,
        notes: truncated
          ? [`publisher reported ${declaredCount} documents but delivered ${collected.length}`]
          : [],
      },
    };
  },

  normalize(documents) {
    const records = new Map();

    for (const doc of documents) {
      const number = canonicalValue(doc.document_number);
      if (!number) continue;
      const agencies = Array.isArray(doc.agencies) ? doc.agencies : [];
      const primary = agencies[0]?.name || agencies[0]?.raw_name || null;

      const fields = dropEmpty({
        documentNumber: number,
        type: text(doc.type),
        title: text(doc.title),
        agency: text(primary),
        agencyCount: agencies.length ? String(agencies.length) : null,
        publicationDate: text(doc.publication_date),
        effectiveOn: text(doc.effective_on),
        commentsCloseOn: text(doc.comments_close_on),
        action: text(doc.action),
        pages: toStr(doc.page_length),
        correctionOf: text(doc.correction_of) ? canonicalValue(doc.correction_of).split('/').pop() : null,
        url: text(doc.html_url),
      });

      const key = `fr-${number}`;
      if (!records.has(key)) records.set(key, { key, fields });
    }

    return [...records.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  },

  labelFor(item) {
    return item.fields.title || item.fields.documentNumber;
  },

  linkFor(item) {
    return item.fields.url || null;
  },

  describe(item, context = {}) {
    const type = (item.fields.type || 'Document').toLowerCase();
    const agency = item.fields.agency || 'an unnamed agency';
    const published = item.fields.publicationDate || 'an unstated date';

    if (item.kind === 'added') {
      const correction = item.fields.correctionOf
        ? ` It corrects document ${item.fields.correctionOf}.`
        : '';
      const effective = item.fields.effectiveOn ? ` Effective ${item.fields.effectiveOn}.` : '';
      const late = item.late ? ` It is dated ${published} and appeared in the feed later.` : '';
      return `Published ${published} by ${agency}: a ${type}.${correction}${effective}${late}`;
    }
    if (item.kind === 'removed') {
      return `Was in the previous window and is no longer published in it.`;
    }
    const parts = item.changes.map((change) => {
      const label = this.fieldLabels?.[change.name] || change.name;
      return `${label} changed from “${change.from ?? 'nothing'}” to “${change.to ?? 'nothing'}”`;
    });
    return `${parts.join('; ')}.`;
  },

  significance(item) {
    const type = item.fields.type || '';
    const base = TYPE_WEIGHT[type] ?? 1.5;
    let score = base;
    let label = type ? type.toLowerCase() : 'document';

    if (item.fields.correctionOf) {
      score += 2;
      label = 'correction';
    }
    if (item.kind === 'removed') {
      score += 1.5;
      label = 'withdrawn from the feed';
    }
    if (item.kind === 'changed') {
      score += 2.5;
      label = 'revised';
    }
    if (item.fields.effectiveOn && item.fields.publicationDate) {
      const days = daysBetween(item.fields.publicationDate, item.fields.effectiveOn);
      if (days >= 0 && days <= 14) score += 0.8;
    }
    return { score: Math.round(score * 100) / 100, label };
  },
};

function daysBetween(a, b) {
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.round((end - start) / 86_400_000);
}

function text(value) {
  if (value === null || value === undefined) return null;
  const normalized = canonicalValue(value);
  return normalized === '' ? null : normalized;
}

function toStr(value) {
  if (value === null || value === undefined) return null;
  const normalized = canonicalValue(value);
  return normalized === '' ? null : normalized;
}

export default federalRegister;
