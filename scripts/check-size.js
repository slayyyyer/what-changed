#!/usr/bin/env node
// Storage alarm for the data branch. The pipeline refuses to push a data branch
// that has grown past a hard ceiling, so a runaway source cannot quietly turn the
// repository into something GitHub will not host.
//
//   node scripts/check-size.js _data
//
// Thresholds are deliberately far below GitHub's limits: 1 GB is the size GitHub
// recommends staying under, 5 GB is a hard block, and a repository is "large"
// long before either.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const WARN_BYTES = 150 * 1024 * 1024;
const FAIL_BYTES = 500 * 1024 * 1024;
const target = process.argv[2] || '_data';

async function dirSize(dir) {
  let total = 0;
  let files = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await dirSize(path);
      total += nested.total;
      files += nested.files;
    } else {
      const info = await stat(path);
      total += info.size;
      files += 1;
    }
  }
  return { total, files };
}

const { total, files } = await dirSize(target);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`data branch: ${files} files, ${mb(total)} (warn at ${mb(WARN_BYTES)}, fail at ${mb(FAIL_BYTES)})`);

if (total > FAIL_BYTES) {
  console.error('FATAL: the data branch has passed its hard size ceiling.');
  console.error('Squash the archive (docs/adr/0001) or narrow a source window before pushing.');
  process.exit(1);
}

if (total > WARN_BYTES) {
  console.warn('warning: the data branch is larger than expected; plan a history squash.');
}
