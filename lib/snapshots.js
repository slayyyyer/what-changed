// The `data` branch layout: snapshots, diffs and status. All reads and writes go
// through here so the on-disk format stays byte-stable and diffable in git.

import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalValue, sha256, stableJson, writeText, readJsonLoose } from './json.js';

export const LAYOUT = {
  latest: (id) => `snapshots/${id}/latest.ndjson`,
  status: (id) => `status/${id}.json`,
  diff: (id, date) => `diffs/${id}/${date}.json`,
  diffDir: (id) => `diffs/${id}`,
};

/**
 * Serialize records to NDJSON: sorted by key, fields in the adapter's declared
 * order, one record per line, single trailing newline.
 */
export function serializeSnapshot(records, fieldOrder = []) {
  const order = [...fieldOrder];
  const sorted = [...records].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const lines = sorted.map((record) => {
    const fields = {};
    for (const name of order) {
      if (hasValue(record.fields[name])) fields[name] = record.fields[name];
    }
    for (const name of Object.keys(record.fields).sort()) {
      if (!(name in fields) && hasValue(record.fields[name])) fields[name] = record.fields[name];
    }
    // Key first, then fields in declared order: readable in `git diff`, and
    // independent of any alphabetical sorting.
    return `{"key":${JSON.stringify(record.key)},"fields":${JSON.stringify(fields)}}`;
  });
  return `${lines.join('\n')}\n`;
}

function hasValue(value) {
  return value !== null && value !== undefined && canonicalValue(value) !== '';
}

export function parseSnapshot(text) {
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed.key !== 'string') {
      throw new Error('snapshot line missing key');
    }
    records.push({ key: parsed.key, fields: parsed.fields || {} });
  }
  return records;
}

export async function readSnapshot(dataDir, id) {
  const text = await readTextFile(join(dataDir, LAYOUT.latest(id)));
  if (text === null) return { records: null, text: null, sha256: null };
  return { records: parseSnapshot(text), text, sha256: sha256(text) };
}

export async function writeSnapshot(dataDir, id, records, fieldOrder) {
  const text = serializeSnapshot(records, fieldOrder);
  await writeText(join(dataDir, LAYOUT.latest(id)), text);
  return { text, sha256: sha256(text) };
}

export async function readStatus(dataDir, id) {
  return readJsonLoose(join(dataDir, LAYOUT.status(id)), null);
}

export async function writeStatus(dataDir, id, status) {
  await writeText(join(dataDir, LAYOUT.status(id)), stableJson(status));
  return status;
}

export async function writeDiff(dataDir, id, date, diffDoc) {
  await writeText(join(dataDir, LAYOUT.diff(id, date)), stableJson(diffDoc));
  return diffDoc;
}

export async function readDiff(dataDir, id, date) {
  return readJsonLoose(join(dataDir, LAYOUT.diff(id, date)), null);
}

/** All archived diff dates for a source, newest first. */
export async function listDiffDates(dataDir, id) {
  const dir = join(dataDir, LAYOUT.diffDir(id));
  try {
    const entries = await readdir(dir);
    return entries
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map((name) => name.slice(0, 10))
      .sort()
      .reverse();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Read up to `limit` recent diffs, newest first. */
export async function readRecentDiffs(dataDir, id, limit = 14) {
  const dates = (await listDiffDates(dataDir, id)).slice(0, limit);
  const docs = [];
  for (const date of dates) {
    const doc = await readDiff(dataDir, id, date);
    if (doc) docs.push(doc);
  }
  return docs;
}

export async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(file) {
  try {
    const { readFile } = await import('node:fs/promises');
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function ensureDataDirs(dataDir, adapters) {
  await mkdir(join(dataDir, 'snapshots'), { recursive: true });
  await mkdir(join(dataDir, 'diffs'), { recursive: true });
  await mkdir(join(dataDir, 'status'), { recursive: true });
  for (const adapter of adapters) {
    await mkdir(join(dataDir, 'snapshots', adapter.id), { recursive: true });
    await mkdir(join(dataDir, 'diffs', adapter.id), { recursive: true });
  }
}
