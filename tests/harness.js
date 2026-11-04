// A 60-line test harness. Mirrors the sibling projects: no runner dependency, no
// config, `node tests/run.js` and a non-zero exit code on failure.

const state = { passed: 0, failed: 0, failures: [] };
let currentFile = '';

export function suite(name) {
  currentFile = name;
}

export function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      throw new Error('async test passed to sync runner');
    }
    state.passed += 1;
    process.stdout.write('.');
  } catch (error) {
    state.failed += 1;
    state.failures.push({ file: currentFile, name, error });
    process.stdout.write('F');
  }
}

export async function testAsync(name, fn) {
  try {
    await fn();
    state.passed += 1;
    process.stdout.write('.');
  } catch (error) {
    state.failed += 1;
    state.failures.push({ file: currentFile, name, error });
    process.stdout.write('F');
  }
}

export function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

export function assertEqual(actual, expected, message) {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${message || 'values differ'}\n  actual:   ${preview(actual)}\n  expected: ${preview(expected)}`,
    );
  }
}

export function assertNotEqual(actual, expected, message) {
  if (deepEqual(actual, expected)) throw new Error(message || 'values should differ');
}

export function assertMatch(value, pattern, message) {
  if (!pattern.test(String(value))) {
    throw new Error(`${message || 'value did not match'} (${preview(value)} vs ${pattern})`);
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let index = 0; index < aKeys.length; index += 1) {
    if (aKeys[index] !== bKeys[index]) return false;
    if (!deepEqual(a[aKeys[index]], b[bKeys[index]])) return false;
  }
  return true;
}

function preview(value) {
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 320 ? `${text.slice(0, 320)}…` : text;
}

export function report() {
  process.stdout.write('\n');
  if (state.failed === 0) {
    console.log(`\n${state.passed} tests passed`);
    return 0;
  }
  console.log(`\n${state.passed} passed, ${state.failed} failed\n`);
  for (const failure of state.failures) {
    console.log(`✗ ${failure.file} — ${failure.name}`);
    console.log(`  ${String(failure.error.stack || failure.error.message).split('\n').join('\n  ')}\n`);
  }
  return 1;
}

/** Small deterministic PRNG for property tests. */
export function rng(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}
