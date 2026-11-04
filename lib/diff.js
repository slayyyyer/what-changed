// The diff engine. Pure functions, no I/O, no clock, no randomness.
//
// Records look like:
//   { key: "request-8409834", fields: { requestType: "BLOCKAGE", ... } }
//
// Field values are display strings (or null). Comparison happens on a canonical
// form so whitespace churn is never reported as a change.

import { canonicalValue, displayValue } from './json.js';

/**
 * Compare two normalized snapshots.
 *
 * @param {Array<{key:string, fields:Record<string,string|null>}>} previous
 * @param {Array<{key:string, fields:Record<string,string|null>}>} current
 * @param {{ignoreFields?: string[], caseInsensitiveFields?: string[], fieldOrder?: string[]}} options
 * @returns {{
 *   added: Array<{key:string, fields:object}>,
 *   removed: Array<{key:string, fields:object}>,
 *   changed: Array<{key:string, fields:object, changes:Array<{name:string, from:string|null, to:string|null}>}>,
 *   unchanged: number,
 *   stats: {added:number, removed:number, changed:number, unchanged:number, fieldChanges:number, recordsBefore:number, recordsAfter:number}
 * }}
 */
export function diffRecords(previous, current, options = {}) {
  const ignore = new Set(options.ignoreFields || []);
  const caseInsensitive = new Set(options.caseInsensitiveFields || []);
  const prevMap = new Map();
  for (const record of previous) prevMap.set(record.key, record);
  const currMap = new Map();
  for (const record of current) currMap.set(record.key, record);

  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;
  let fieldChanges = 0;

  const keys = [...new Set([...prevMap.keys(), ...currMap.keys()])].sort(compareKeys);

  for (const key of keys) {
    const before = prevMap.get(key);
    const after = currMap.get(key);

    if (before && !after) {
      removed.push({ key, fields: before.fields });
      continue;
    }
    if (!before && after) {
      added.push({ key, fields: after.fields });
      continue;
    }

    const changes = [];
    for (const name of fieldNames(before.fields, after.fields, ignore)) {
      const from = before.fields[name] ?? null;
      const to = after.fields[name] ?? null;
      const left = canonicalValue(from);
      const right = canonicalValue(to);
      const equal = caseInsensitive.has(name) ? left.toLowerCase() === right.toLowerCase() : left === right;
      if (!equal) {
        changes.push({ name, from: displayValue(from), to: displayValue(to) });
      }
    }

    if (changes.length === 0) {
      unchanged += 1;
    } else {
      fieldChanges += changes.length;
      changed.push({ key, fields: after.fields, changes });
    }
  }

  return {
    added,
    removed,
    changed,
    unchanged,
    stats: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged,
      fieldChanges,
      recordsBefore: previous.length,
      recordsAfter: current.length,
    },
  };
}

/** Union of field names, sorted, minus ignored ones. Deterministic by construction. */
function fieldNames(a = {}, b = {}, ignore = new Set()) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((name) => !ignore.has(name))
    .sort();
}

function compareKeys(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Apply a diff to the previous snapshot, producing the current one.
 * Used by the round-trip property test and to rebuild a day's state.
 */
export function applyDiff(previous, diff) {
  const map = new Map();
  for (const record of previous) map.set(record.key, { key: record.key, fields: { ...record.fields } });

  for (const record of diff.removed) map.delete(record.key);
  for (const record of diff.added) {
    map.set(record.key, { key: record.key, fields: { ...record.fields } });
  }
  for (const record of diff.changed) {
    const existing = map.get(record.key) || { key: record.key, fields: {} };
    const fields = { ...existing.fields };
    // A field is present only when it has a value, so "cleared" means "absent".
    for (const change of record.changes) {
      if (change.to === null) delete fields[change.name];
      else fields[change.name] = change.to;
    }
    map.set(record.key, { key: record.key, fields });
  }

  return [...map.values()].sort((a, b) => compareKeys(a.key, b.key));
}

/** Total number of reported events in a diff (added + removed + changed records). */
export function changeCount(diff) {
  return diff.stats.added + diff.stats.removed + diff.stats.changed;
}

export function isEmptyDiff(diff) {
  return changeCount(diff) === 0;
}
