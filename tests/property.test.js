// Property-style checks over generated snapshots. Small, seeded, deterministic:
// a failure is reproducible from the seed in the message.

import { suite, test, assert, assertEqual, rng } from './harness.js';
import { diffRecords, applyDiff, isEmptyDiff } from '../lib/diff.js';

suite('property');

const WORDS = ['open', 'closed', 'issued', 'pending', 'north', 'south', 'ward 3', 'Rule', 'Notice'];
const FIELDS = ['status', 'department', 'type', 'note', 'count'];

function randomRecords(random, size) {
  const records = [];
  for (let index = 0; index < size; index += 1) {
    const fields = {};
    for (const name of FIELDS) {
      if (random() < 0.25) continue;
      fields[name] = WORDS[Math.floor(random() * WORDS.length)] + (random() < 0.3 ? ` ${Math.floor(random() * 5)}` : '');
    }
    records.push({ key: `k-${index}`, fields });
  }
  return records;
}

function mutate(random, records) {
  const next = records
    .filter(() => random() > 0.12)
    .map((record) => {
      if (random() > 0.3) return record;
      const fields = { ...record.fields };
      const name = FIELDS[Math.floor(random() * FIELDS.length)];
      if (random() < 0.5) fields[name] = WORDS[Math.floor(random() * WORDS.length)];
      else delete fields[name];
      return { key: record.key, fields };
    });

  const extra = Math.floor(random() * 4);
  for (let index = 0; index < extra; index += 1) {
    next.push({ key: `new-${index}`, fields: { status: 'open' } });
  }

  return next.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

test('diff(a, a) is empty for generated snapshots', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const random = rng(seed);
    const records = randomRecords(random, 30);
    assert(isEmptyDiff(diffRecords(records, records)), `seed ${seed} reported changes on identical input`);
  }
});

test('applying diff(a, b) to a reproduces b', () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const random = rng(seed * 7);
    const before = randomRecords(random, 25);
    const after = mutate(random, before);
    const diff = diffRecords(before, after);
    const rebuilt = applyDiff(before, diff);
    assertEqual(rebuilt, after, `seed ${seed} failed the round trip`);
  }
});

test('the same inputs always produce the same bytes', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const random = rng(seed * 13);
    const before = randomRecords(random, 20);
    const after = mutate(random, before);
    const one = JSON.stringify(diffRecords(before, after));
    const two = JSON.stringify(diffRecords(before, after));
    assertEqual(one, two, `seed ${seed} was not deterministic`);
  }
});

test('every changed record has at least one field and none are duplicated', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const random = rng(seed * 29);
    const before = randomRecords(random, 20);
    const after = mutate(random, before);
    const diff = diffRecords(before, after);
    for (const record of diff.changed) {
      assert(record.changes.length > 0, `seed ${seed}: empty change list`);
      const names = record.changes.map((change) => change.name);
      assertEqual(names.length, new Set(names).size, `seed ${seed}: duplicate field in one record`);
    }
  }
});
