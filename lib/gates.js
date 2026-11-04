// Sanity gates. A snapshot is only accepted when it looks like the same dataset
// we saw yesterday. Anything else is quarantined: the old `latest` is kept, the
// reason is recorded, and no diff is emitted.
//
// The rule this file exists to enforce: "no snapshot" is never "no changes".

import { canonicalValue } from './json.js';

export const DEFAULT_LIMITS = {
  /** Fewest records we will accept, ever. */
  minRecords: 25,
  /** Largest acceptable drop against the previous snapshot. */
  minCountRatio: 0.6,
  /** Largest acceptable jump against the previous snapshot. */
  maxCountRatio: 1.8,
  /** Fraction of records changed before we assume a schema/format break. */
  maxChangeRatio: 0.35,
  /** Unexpected field names tolerated before we fail outright. */
  maxUnexpectedFields: 6,
};

/**
 * Validate a freshly normalized snapshot.
 *
 * @param {object} input
 * @param {object} input.adapter
 * @param {Array<{key:string, fields:object}>} input.records
 * @param {Array<{key:string, fields:object}>|null} input.previousRecords
 * @param {object} input.diff  diff against previous (null on the first run)
 * @param {object} [input.limits]
 * @returns {{ok:boolean, reason:string|null, notes:string[], failures:string[]}}
 */
export function evaluateSnapshot({ adapter, records, previousRecords, diff, limits = {} }) {
  const config = { ...DEFAULT_LIMITS, ...(adapter.limits || {}), ...limits };
  const failures = [];
  const notes = [];

  if (!Array.isArray(records)) {
    return { ok: false, reason: 'normalize() did not return an array', notes, failures: ['not-an-array'] };
  }

  // 1. Empty or implausibly small payloads are usually outages dressed as data.
  if (records.length === 0) {
    failures.push('empty snapshot');
  } else if (records.length < config.minRecords) {
    failures.push(`only ${records.length} records (floor is ${config.minRecords})`);
  }

  // 2. Required fields must be present and non-empty on every record.
  const required = adapter.requiredFields || [];
  for (const name of required) {
    const missing = records.filter((record) => {
      const value = record.fields?.[name];
      return value === null || value === undefined || canonicalValue(value) === '';
    }).length;
    if (missing > 0) failures.push(`${missing} record(s) missing required field "${name}"`);
  }

  // 3. Keys must be stable, unique and match the declared shape.
  const seen = new Set();
  let duplicateKeys = 0;
  let malformedKeys = 0;
  for (const record of records) {
    if (!record || typeof record.key !== 'string' || record.key === '') {
      malformedKeys += 1;
      continue;
    }
    if (adapter.keyPattern && !adapter.keyPattern.test(record.key)) malformedKeys += 1;
    if (seen.has(record.key)) duplicateKeys += 1;
    seen.add(record.key);
  }
  if (malformedKeys > 0) failures.push(`${malformedKeys} malformed key(s)`);
  if (duplicateKeys > 0) failures.push(`${duplicateKeys} duplicate key(s)`);

  // 4. Schema drift: unexpected or vanished fields are a notice, not a failure,
  //    unless enough fields move that we can no longer recognise the dataset.
  const expected = new Set(adapter.fieldOrder || []);
  if (expected.size > 0) {
    const present = new Set();
    for (const record of records) for (const name of Object.keys(record.fields || {})) present.add(name);

    const unexpected = [...present].filter((name) => !expected.has(name)).sort();
    if (unexpected.length > 0) {
      notes.push(`unexpected field(s): ${unexpected.join(', ')}`);
    }

    // A field that has never carried a value in either snapshot is simply
    // optional; one that used to carry values and stopped is drift.
    const before = new Set();
    for (const record of previousRecords || []) {
      for (const name of Object.keys(record.fields || {})) before.add(name);
    }
    const vanished = [...before].filter((name) => !present.has(name)).sort();
    if (vanished.length > 0) {
      notes.push(`field(s) no longer present: ${vanished.join(', ')}`);
    }

    const drift = unexpected.length + vanished.length;
    if (drift > config.maxUnexpectedFields) {
      failures.push(`schema drift across ${drift} fields`);
    }
  }

  // 5. Record-count swing against the previous snapshot.
  if (previousRecords && previousRecords.length > 0) {
    const ratio = records.length / previousRecords.length;
    if (ratio < config.minCountRatio) {
      failures.push(
        `record count fell from ${previousRecords.length} to ${records.length} (${Math.round(ratio * 100)}% of previous)`,
      );
    }
    if (ratio > config.maxCountRatio) {
      failures.push(
        `record count jumped from ${previousRecords.length} to ${records.length} (${Math.round(ratio * 100)}% of previous)`,
      );
    }

    // 6. Mass change: a huge fraction of records "changing" at once is nearly
    //    always a schema rename or a re-export, not a day of real events.
    if (diff && previousRecords.length >= 100) {
      const touched = diff.stats.added + diff.stats.removed + diff.stats.changed;
      const ratioChanged = touched / Math.max(previousRecords.length, records.length);
      if (ratioChanged > config.maxChangeRatio) {
        failures.push(
          `${Math.round(ratioChanged * 100)}% of records changed at once (limit ${Math.round(config.maxChangeRatio * 100)}%)`,
        );
      }
    }
  }

  if (failures.length > 0) {
    return { ok: false, reason: failures.join('; '), notes, failures };
  }
  return { ok: true, reason: null, notes, failures };
}
