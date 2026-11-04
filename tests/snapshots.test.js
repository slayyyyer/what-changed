import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { suite, testAsync, assert, assertEqual } from './harness.js';
import {
  serializeSnapshot,
  parseSnapshot,
  writeSnapshot,
  readSnapshot,
  writeDiff,
  readDiff,
  listDiffDates,
  readRecentDiffs,
  writeStatus,
  readStatus,
} from '../lib/snapshots.js';

suite('snapshots');

async function tempDir() {
  await mkdir(join(process.cwd(), '.cache'), { recursive: true });
  return mkdtemp(join(process.cwd(), '.cache', 'snap-'));
}

const records = [
  { key: 'k-2', fields: { a: '2' } },
  { key: 'k-1', fields: { a: '1' } },
];

await testAsync('a snapshot can be written and read back with a stable hash', async () => {
  const dir = await tempDir();
  try {
    const written = await writeSnapshot(dir, 'demo', records, ['a']);
    const read = await readSnapshot(dir, 'demo');
    assertEqual(read.records, parseSnapshot(serializeSnapshot(records, ['a'])));
    assertEqual(read.sha256, written.sha256);
    const onDisk = await readFile(join(dir, 'snapshots/demo/latest.ndjson'), 'utf8');
    assertEqual(onDisk, written.text);
    assertEqual(onDisk.split('\n').filter(Boolean).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await testAsync('a missing snapshot reads as null instead of throwing', async () => {
  const dir = await tempDir();
  try {
    const read = await readSnapshot(dir, 'nothing');
    assertEqual(read.records, null);
    assertEqual(read.sha256, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await testAsync('diffs are archived by date, newest first', async () => {
  const dir = await tempDir();
  try {
    await writeDiff(dir, 'demo', '2026-11-02', { date: '2026-11-02', stats: { added: 1 } });
    await writeDiff(dir, 'demo', '2026-11-04', { date: '2026-11-04', stats: { added: 2 } });
    await writeDiff(dir, 'demo', '2026-11-03', { date: '2026-11-03', stats: { added: 3 } });
    assertEqual(await listDiffDates(dir, 'demo'), ['2026-11-04', '2026-11-03', '2026-11-02']);
    const recent = await readRecentDiffs(dir, 'demo', 2);
    assertEqual(recent.map((doc) => doc.date), ['2026-11-04', '2026-11-03']);
    assertEqual((await readDiff(dir, 'demo', '2026-11-02')).stats.added, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await testAsync('status files are JSON and survive a round trip', async () => {
  const dir = await tempDir();
  try {
    const status = { id: 'demo', result: 'ok', recordCount: 12, notes: ['a'] };
    await writeStatus(dir, 'demo', status);
    assertEqual(await readStatus(dir, 'demo'), status);
    assertEqual(await readStatus(dir, 'absent'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
