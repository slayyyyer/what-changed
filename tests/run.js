// Test entry point: `node tests/run.js`
//
// Everything here is offline. The diff engine, normalization, ranking, sanity
// gates and the pipeline's failure behaviour are tested without touching the
// network, and CI runs this before any fetch.

import { report } from './harness.js';

const files = [
  './diff.test.js',
  './normalize.test.js',
  './rank.test.js',
  './gates.test.js',
  './adapters.test.js',
  './snapshots.test.js',
  './pipeline.test.js',
  './property.test.js',
];

for (const file of files) {
  await import(file);
}

process.exit(report());
