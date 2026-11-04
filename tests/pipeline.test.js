import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { suite, testAsync, assert, assertEqual } from './harness.js';
import { runSource } from '../lib/run.js';
import { writeSnapshot, readSnapshot, readStatus, readDiff, listDiffDates } from '../lib/snapshots.js';

suite('pipeline');

const NOW = new Date('2026-11-04T12:00:00Z');

function makeAdapter(overrides = {}) {
  return {
    id: 'fake',
    title: 'Fake source',
    sourceUrl: 'https://example.com/data',
    fieldOrder: ['a', 'b'],
    requiredFields: ['a'],
    keyPattern: /^k-\d+$/,
    ignoreFields: [],
    caseInsensitiveFields: [],
    eventDateField: 'a',
    limits: { minRecords: 2, minCountRatio: 0.6, maxCountRatio: 1.8, maxChangeRatio: 0.35 },
    labelFor: (item) => item.key,
    linkFor: () => null,
    describe: (item) => item.kind,
    significance: () => ({ score: 1, label: 'test' }),
    normalize(raw) {
      return raw;
    },
    async fetchSnapshot() {
      return { raw: [], meta: { windowFrom: null, windowTo: '2026-11-04' } };
    },
    ...overrides,
  };
}

const records = (count, value = 'x') =>
  Array.from({ length: count }, (_, index) => ({
    key: `k-${index}`,
    fields: { a: '2026-11-03T00:00:00Z', b: value },
  }));

async function tempDir() {
  await mkdir(join(process.cwd(), '.cache'), { recursive: true });
  return mkdtemp(join(process.cwd(), '.cache', 'pipe-'));
}

await testAsync('a failed fetch records an error and leaves the last snapshot alone', async () => {
  const dir = await tempDir();
  try {
    const previous = records(4);
    const written = await writeSnapshot(dir, 'fake', previous, ['a', 'b']);

    const adapter = makeAdapter({
      async fetchSnapshot() {
        throw new Error('connect ECONNREFUSED');
      },
    });

    const result = await runSource({ adapter, dataDir: dir, now: NOW });
    assertEqual(result.status.result, 'error');
    assert(result.status.reason.includes('ECONNREFUSED'), result.status.reason);
    assertEqual(result.diff, null, 'a failed fetch must not produce a diff');

    const after = await readSnapshot(dir, 'fake');
    assertEqual(after.sha256, written.sha256, 'latest.ndjson must be untouched');
    assertEqual(await listDiffDates(dir, 'fake'), [], 'no diff may be archived');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await testAsync('a mass rewrite is quarantined and publishes no diff', async () => {
  const dir = await tempDir();
  try {
    await writeSnapshot(dir, 'fake', records(200), ['a', 'b']);
    const rewritten = records(200).map((record, index) => ({
      key: record.key,
      fields: { ...record.fields, b: index < 150 ? 'rewritten' : 'x' },
    }));
    const adapter = makeAdapter({
      async fetchSnapshot() {
        return { raw: rewritten, meta: { windowFrom: '2026-10-21', windowTo: '2026-11-04' } };
      },
    });

    const result = await runSource({ adapter, dataDir: dir, now: NOW });
    assertEqual(result.status.result, 'quarantined');
    assert(result.status.reason.includes('% of records changed'), result.status.reason);
    assertEqual(await listDiffDates(dir, 'fake'), [], 'a quarantined snapshot emits nothing');
    assertEqual((await readStatus(dir, 'fake')).rejectedRecordCount, 200);
    assertEqual((await readSnapshot(dir, 'fake')).records.length, 200, 'the previous snapshot is kept');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await testAsync('a normal change writes one diff, and a repeat run is idempotent', async () => {
  const dir = await tempDir();
  try {
    await writeSnapshot(dir, 'fake', records(100), ['a', 'b']);
    const next = [...records(100), { key: 'k-100', fields: { a: '2026-11-04T00:00:00Z', b: 'new' } }];
    const adapter = makeAdapter({
      async fetchSnapshot() {
        return { raw: next, meta: { windowFrom: '2026-10-21', windowTo: '2026-11-04' } };
      },
    });

    const first = await runSource({ adapter, dataDir: dir, now: NOW });
    assertEqual(first.status.result, 'ok');
    assertEqual(first.status.diffStats.added, 1);
    const diffPath = join(dir, 'diffs/fake/2026-11-04.json');
    const firstDiff = await readFile(diffPath, 'utf8');

    const second = await runSource({ adapter, dataDir: dir, now: NOW });
    assertEqual(second.status.result, 'unchanged');
    assertEqual(second.diff, null);
    assertEqual(await readFile(diffPath, 'utf8'), firstDiff, 'a repeat run must not rewrite the archive');
    assertEqual((await listDiffDates(dir, 'fake')).length, 1);
    assertEqual((await readDiff(dir, 'fake', '2026-11-04')).to.recordCount, 101);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await testAsync('the first run is a baseline, not a diff', async () => {
  const dir = await tempDir();
  try {
    const adapter = makeAdapter({
      async fetchSnapshot() {
        return { raw: records(5), meta: { windowFrom: '2026-10-21', windowTo: '2026-11-04' } };
      },
    });
    const result = await runSource({ adapter, dataDir: dir, now: NOW });
    assertEqual(result.status.result, 'baseline');
    assertEqual(result.diff, null);
    assertEqual(await listDiffDates(dir, 'fake'), []);
    assertEqual((await readSnapshot(dir, 'fake')).records.length, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await testAsync('records that age out of the rolling window are not removals', async () => {
  const dir = await tempDir();
  try {
    const previous = [
      { key: 'k-0', fields: { a: '2026-01-01T00:00:00Z', b: 'old' } },
      { key: 'k-1', fields: { a: '2026-01-02T00:00:00Z', b: 'old' } },
      { key: 'k-2', fields: { a: '2026-10-30T00:00:00Z', b: 'recent' } },
      { key: 'k-3', fields: { a: '2026-10-31T00:00:00Z', b: 'recent' } },
    ];
    await writeSnapshot(dir, 'fake', previous, ['a', 'b']);

    const current = [
      previous[2],
      previous[3],
      { key: 'k-4', fields: { a: '2026-11-04T00:00:00Z', b: 'new' } },
    ];
    const adapter = makeAdapter({
      async fetchSnapshot() {
        return { raw: current, meta: { windowFrom: '2026-10-21', windowTo: '2026-11-04' } };
      },
    });

    const result = await runSource({ adapter, dataDir: dir, now: NOW });
    const diff = result.diff;
    assertEqual(diff.stats.removed, 0, 'aging out is not a removal');
    assertEqual(diff.stats.expired, 2);
    assertEqual(diff.added.length, 1);
    assertEqual(
      diff.expired.map((entry) => entry.key),
      ['k-0', 'k-1'],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await testAsync('an unchanged publisher response (304) records no diff', async () => {
  const dir = await tempDir();
  try {
    await writeSnapshot(dir, 'fake', records(3), ['a', 'b']);
    const adapter = makeAdapter({
      async fetchSnapshot() {
        return { raw: null, meta: { notModified: true } };
      },
    });
    const result = await runSource({ adapter, dataDir: dir, now: NOW });
    assertEqual(result.status.result, 'unchanged');
    assertEqual(result.diff, null);
    assertEqual(await listDiffDates(dir, 'fake'), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
