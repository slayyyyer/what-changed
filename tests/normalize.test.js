import { suite, test, assert, assertEqual } from './harness.js';
import { canonicalValue, displayValue, stableJson, stableValue, sha256, dropEmpty } from '../lib/json.js';
import { serializeSnapshot, parseSnapshot } from '../lib/snapshots.js';

suite('normalize');

test('canonicalValue collapses whitespace and normalizes unicode', () => {
  assertEqual(canonicalValue('  a   b\tc '), 'a b c');
  assertEqual(canonicalValue('a\r\nb'), 'a b', 'line breaks collapse like any other whitespace');
  assertEqual(canonicalValue('Ａ'), 'A', 'full-width characters are folded');
  assertEqual(canonicalValue(null), '');
  assertEqual(canonicalValue(42), '42');
});

test('displayValue returns null instead of an empty string', () => {
  assertEqual(displayValue('   '), null);
  assertEqual(displayValue(null), null);
  assertEqual(displayValue(' Rule '), 'Rule');
});

test('stableJson sorts keys at every level', () => {
  const one = stableJson({ b: 1, a: { d: 2, c: 3 } });
  const two = stableJson({ a: { c: 3, d: 2 }, b: 1 });
  assertEqual(one, two);
  assert(one.endsWith('\n'), 'files end with a newline');
});

test('stableValue keeps array order', () => {
  assertEqual(stableValue([{ b: 1, a: 2 }]), [{ a: 2, b: 1 }]);
});

test('sha256 is stable across runs', () => {
  assertEqual(sha256('abc'), sha256('abc'));
  assertEqual(sha256('abc').length, 64);
});

test('snapshot serialization is byte-identical for shuffled input', () => {
  const fieldOrder = ['a', 'b'];
  const records = [
    { key: 'k-2', fields: { b: '2', a: '1' } },
    { key: 'k-1', fields: { a: '1', b: '2' } },
  ];
  const forward = serializeSnapshot(records, fieldOrder);
  const backward = serializeSnapshot([...records].reverse(), fieldOrder);
  assertEqual(forward, backward);
  assertEqual(forward, '{"key":"k-1","fields":{"a":"1","b":"2"}}\n{"key":"k-2","fields":{"a":"1","b":"2"}}\n');
});

test('snapshots round-trip through NDJSON', () => {
  const records = [
    { key: 'k-1', fields: { a: 'x' } },
    { key: 'k-2', fields: { a: 'y', b: 'z' } },
  ];
  assertEqual(parseSnapshot(serializeSnapshot(records, ['a', 'b'])), records);
});

test('a field with no value is not written at all', () => {
  const text = serializeSnapshot([{ key: 'k-1', fields: { a: 'x', b: null, c: '  ' } }], ['a', 'b', 'c']);
  assertEqual(text, '{"key":"k-1","fields":{"a":"x"}}\n');
  assertEqual(dropEmpty({ a: 'x', b: null, c: '   ' }), { a: 'x' });
});

test('a record with no fields still round-trips', () => {
  const text = serializeSnapshot([{ key: 'k-1', fields: {} }], ['a']);
  assertEqual(parseSnapshot(text), [{ key: 'k-1', fields: {} }]);
});

test('a malformed snapshot line is rejected, not skipped', () => {
  let threw = false;
  try {
    parseSnapshot('{"fields":{}}\n');
  } catch {
    threw = true;
  }
  assert(threw, 'a line without a key must fail loudly');
});
