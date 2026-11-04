// The per-source pipeline: fetch → normalize → gate → diff → store.
//
// One failing source must not stop another. Every outcome — including failure —
// is recorded in status/<source>.json, which is what the site renders. A failed
// fetch never yields an empty diff and never touches `latest.ndjson`.

import { isoDate, isoStamp } from './time.js';
import { evaluateSnapshot } from './gates.js';
import { diffRecords, changeCount } from './diff.js';
import { canonicalValue } from './json.js';
import {
  readSnapshot,
  readStatus,
  writeSnapshot,
  writeStatus,
  writeDiff,
} from './snapshots.js';

/**
 * @param {object} options
 * @param {object} options.adapter
 * @param {string} options.dataDir
 * @param {Date} options.now
 * @param {boolean} [options.offline] skip the network entirely
 * @param {(message:string)=>void} [options.log]
 */
export async function runSource({ adapter, dataDir, now, offline = false, log = () => {} }) {
  const attemptedAt = isoStamp(now);
  const date = isoDate(now);
  const previousStatus = await readStatus(dataDir, adapter.id);
  const previous = await readSnapshot(dataDir, adapter.id);

  const baseStatus = {
    id: adapter.id,
    title: adapter.title,
    sourceUrl: adapter.sourceUrl,
    attemptedAt,
    date,
    windowDays: adapter.windowDays ?? null,
  };

  if (offline) {
    const status = previousStatus || { ...baseStatus, result: 'never' };
    log(`${adapter.id}: offline, reusing stored snapshot`);
    return {
      adapter,
      status: { ...status, offline: true },
      diff: null,
      previousRecords: previous.records,
      currentRecords: previous.records,
      items: [],
    };
  }

  let raw;
  let meta = {};
  try {
    const fetched = await adapter.fetchSnapshot({ now, date, log, previousStatus });
    raw = fetched.raw;
    meta = fetched.meta || {};
  } catch (error) {
    const status = {
      ...baseStatus,
      result: 'error',
      reason: describeError(error),
      lastSuccessAt: previousStatus?.lastSuccessAt ?? null,
      lastSuccessDate: previousStatus?.lastSuccessDate ?? null,
      lastSuccessSha256: previousStatus?.lastSuccessSha256 ?? null,
      lastSuccessRecordCount: previousStatus?.lastSuccessRecordCount ?? null,
      recordCount: previous.records?.length ?? 0,
      notes: collectNotes(meta, previousStatus),
      windowFrom: meta.windowFrom ?? null,
      windowTo: meta.windowTo ?? null,
      pages: meta.pages ?? null,
      etag: meta.etag ?? previousStatus?.etag ?? null,
      lastModified: meta.lastModified ?? previousStatus?.lastModified ?? null,
    };
    await writeStatus(dataDir, adapter.id, status);
    log(`${adapter.id}: FETCH FAILED — ${status.reason}`);
    return { adapter, status, diff: null, previousRecords: previous.records, currentRecords: null, items: [] };
  }

  if (meta.notModified) {
    const status = {
      ...baseStatus,
      result: 'unchanged',
      reason: null,
      lastSuccessAt: previousStatus?.lastSuccessAt ?? null,
      lastSuccessDate: previousStatus?.lastSuccessDate ?? null,
      lastSuccessSha256: previous.sha256,
      lastSuccessRecordCount: previous.records?.length ?? 0,
      recordCount: previous.records?.length ?? 0,
      notes: ['publisher answered 304 Not Modified; nothing was downloaded'],
      windowFrom: meta.windowFrom ?? previousStatus?.windowFrom ?? null,
      windowTo: meta.windowTo ?? previousStatus?.windowTo ?? null,
      pages: 0,
      etag: meta.etag ?? previousStatus?.etag ?? null,
      lastModified: meta.lastModified ?? previousStatus?.lastModified ?? null,
    };
    await writeStatus(dataDir, adapter.id, status);
    log(`${adapter.id}: 304 not modified`);
    return { adapter, status, diff: null, previousRecords: previous.records, currentRecords: previous.records, items: [] };
  }

  let records;
  try {
    records = adapter.normalize(raw, { now, date });
  } catch (error) {
    const status = {
      ...baseStatus,
      result: 'quarantined',
      reason: `normalize() failed: ${describeError(error)}`,
      lastSuccessAt: previousStatus?.lastSuccessAt ?? null,
      lastSuccessDate: previousStatus?.lastSuccessDate ?? null,
      lastSuccessSha256: previous.sha256,
      lastSuccessRecordCount: previous.records?.length ?? 0,
      recordCount: previous.records?.length ?? 0,
      notes: collectNotes(meta, previousStatus),
      windowFrom: meta.windowFrom ?? null,
      windowTo: meta.windowTo ?? null,
    };
    await writeStatus(dataDir, adapter.id, status);
    log(`${adapter.id}: QUARANTINED — ${status.reason}`);
    return { adapter, status, diff: null, previousRecords: previous.records, currentRecords: null, items: [] };
  }

  const rawDiff = previous.records ? diffRecords(previous.records, records, adapter) : null;
  const gate = evaluateSnapshot({
    adapter,
    records,
    previousRecords: previous.records,
    diff: rawDiff,
  });

  if (!gate.ok) {
    const status = {
      ...baseStatus,
      result: 'quarantined',
      reason: gate.reason,
      lastSuccessAt: previousStatus?.lastSuccessAt ?? null,
      lastSuccessDate: previousStatus?.lastSuccessDate ?? null,
      lastSuccessSha256: previous.sha256,
      lastSuccessRecordCount: previous.records?.length ?? 0,
      recordCount: previous.records?.length ?? 0,
      rejectedRecordCount: records.length,
      notes: [...gate.notes, ...collectNotes(meta, previousStatus)],
      windowFrom: meta.windowFrom ?? null,
      windowTo: meta.windowTo ?? null,
    };
    await writeStatus(dataDir, adapter.id, status);
    log(`${adapter.id}: QUARANTINED — ${status.reason}`);
    return { adapter, status, diff: null, previousRecords: previous.records, currentRecords: null, items: [] };
  }

  const current = await writeSnapshot(dataDir, adapter.id, records, adapter.fieldOrder || []);
  const notes = [...gate.notes, ...collectNotes(meta, previousStatus)];

  // Idempotence: identical bytes mean there is nothing to commit but the status.
  if (previous.sha256 && previous.sha256 === current.sha256) {
    const status = {
      ...baseStatus,
      result: 'unchanged',
      reason: null,
      lastSuccessAt: attemptedAt,
      lastSuccessDate: date,
      lastSuccessSha256: current.sha256,
      lastSuccessRecordCount: records.length,
      recordCount: records.length,
      notes,
      windowFrom: meta.windowFrom ?? null,
      windowTo: meta.windowTo ?? null,
      pages: meta.pages ?? null,
      etag: meta.etag ?? null,
      lastModified: meta.lastModified ?? null,
    };
    await writeStatus(dataDir, adapter.id, status);
    log(`${adapter.id}: identical snapshot, no diff written`);
    return { adapter, status, diff: null, previousRecords: previous.records, currentRecords: records, items: [] };
  }

  if (!previous.records) {
    const status = {
      ...baseStatus,
      result: 'baseline',
      reason: null,
      lastSuccessAt: attemptedAt,
      lastSuccessDate: date,
      lastSuccessSha256: current.sha256,
      lastSuccessRecordCount: records.length,
      recordCount: records.length,
      notes: ['first snapshot for this source — there is nothing to compare against yet'],
      windowFrom: meta.windowFrom ?? null,
      windowTo: meta.windowTo ?? null,
      pages: meta.pages ?? null,
      etag: meta.etag ?? null,
      lastModified: meta.lastModified ?? null,
    };
    await writeStatus(dataDir, adapter.id, status);
    log(`${adapter.id}: baseline snapshot (${records.length} records)`);
    return { adapter, status, diff: null, previousRecords: null, currentRecords: records, items: [] };
  }

  const filtered = partitionExpired(adapter, rawDiff, meta, previous.records);
  const diffDoc = {
    source: adapter.id,
    date,
    from: {
      takenAt: previousStatus?.lastSuccessAt ?? null,
      recordCount: previous.records.length,
      sha256: previous.sha256,
    },
    to: {
      takenAt: attemptedAt,
      recordCount: records.length,
      sha256: current.sha256,
    },
    window: { from: meta.windowFrom ?? null, to: meta.windowTo ?? null },
    ignoredFields: adapter.ignoreFields || [],
    stats: filtered.stats,
    added: filtered.added,
    removed: filtered.removed,
    changed: filtered.changed,
    expired: filtered.expired,
  };
  await writeDiff(dataDir, adapter.id, date, diffDoc);

  const status = {
    ...baseStatus,
    result: 'ok',
    reason: null,
    lastSuccessAt: attemptedAt,
    lastSuccessDate: date,
    lastSuccessSha256: current.sha256,
    lastSuccessRecordCount: records.length,
    recordCount: records.length,
    notes,
    windowFrom: meta.windowFrom ?? null,
    windowTo: meta.windowTo ?? null,
    pages: meta.pages ?? null,
    etag: meta.etag ?? null,
    lastModified: meta.lastModified ?? null,
    diffStats: filtered.stats,
  };
  await writeStatus(dataDir, adapter.id, status);
  log(
    `${adapter.id}: ok — ${filtered.stats.added} added, ${filtered.stats.removed} removed, ${filtered.stats.changed} changed`,
  );

  return {
    adapter,
    status,
    diff: diffDoc,
    previousRecords: previous.records,
    currentRecords: records,
    items: [],
  };
}

/**
 * A rolling window means yesterday's records age out. That is not a removal by
 * the publisher, so those keys are kept apart from real removals.
 */
function partitionExpired(adapter, diff, meta, previousRecords) {
  if (!meta.windowFrom || !adapter.eventDateField) {
    return { ...diff, expired: [], stats: { ...diff.stats, expired: 0 } };
  }
  const byKey = new Map(previousRecords.map((record) => [record.key, record]));
  const expired = [];
  const removed = [];
  for (const record of diff.removed) {
    const full = byKey.get(record.key);
    const eventDate = canonicalValue(full?.fields?.[adapter.eventDateField] ?? record.fields?.[adapter.eventDateField]).slice(0, 10);
    if (eventDate && eventDate < meta.windowFrom) expired.push({ key: record.key, eventDate });
    else removed.push(record);
  }
  const stats = {
    ...diff.stats,
    removed: removed.length,
    expired: expired.length,
  };
  return { ...diff, removed, expired, stats };
}

function describeError(error) {
  if (!error) return 'unknown error';
  const parts = [error.message || String(error)];
  if (error.status) parts.push(`(HTTP ${error.status})`);
  return parts.join(' ');
}

/** Carry forward notices that describe the publisher, not this run. */
function collectNotes(meta, previousStatus) {
  const notes = [];
  if (meta && Array.isArray(meta.notes)) notes.push(...meta.notes);
  if (meta && meta.truncated) notes.push('the publisher reported more rows than were delivered');
  return notes;
}

export { changeCount };
