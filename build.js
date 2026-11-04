#!/usr/bin/env node
// Build the whole site: run each adapter, write the data branch, render dist/.
//
//   node build.js                 fetch, diff, store, render
//   node build.js --offline       no network; render from what is already stored
//   node build.js --out dist      output directory (default dist)
//   node build.js --data-dir _data
//
// Only Node 20 is required. No install step, no dependencies.

import { mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { adapters } from './adapters/index.js';
import { runSource } from './lib/run.js';
import { ensureDataDirs, readRecentDiffs, readStatus, readDiff, listDiffDates } from './lib/snapshots.js';
import { renderAll } from './lib/pages.js';
import { dayView, isFresh } from './lib/view.js';
import { isoDate, isoStamp, etDate } from './lib/time.js';
import { writeText, writeJson } from './lib/json.js';

const here = dirname(fileURLToPath(import.meta.url));

const args = parseArgs(process.argv.slice(2));
const dataDir = join(here, args['data-dir'] || '_data');
const outDir = join(here, args.out || 'dist');
const baseUrl = normalizeBase(args['base-url'] || 'https://slayyyyer.github.io/what-changed/');
const offline = args.offline === true;
const now = args.now ? new Date(args.now) : new Date();

if (Number.isNaN(now.getTime())) {
  console.error('invalid --now value');
  process.exit(1);
}

const log = (message) => console.log(`[${isoStamp(new Date()).slice(11, 19)}] ${message}`);

main().catch((error) => {
  console.error('build failed:', error);
  process.exit(1);
});

async function main() {
  await ensureDataDirs(dataDir, adapters);

  // 1. Run every adapter independently. One failure never blocks another.
  const runs = [];
  for (const adapter of adapters) {
    try {
      runs.push(await runSource({ adapter, dataDir, now, offline, log }));
    } catch (error) {
      // runSource handles network and normalize failures itself; this is the
      // last resort so an adapter bug cannot take the whole build down.
      log(`${adapter.id}: unexpected failure — ${error.message}`);
      runs.push({ adapter, status: null, diff: null, error });
    }
  }

  // 2. Assemble the view model from disk. Reading back rather than trusting the
  //    in-memory result means an offline build renders exactly what is stored.
  const todayUtc = isoDate(now);
  const sources = [];
  for (const adapter of adapters) {
    const status = await readStatus(dataDir, adapter.id);
    const dates = await listDiffDates(dataDir, adapter.id);
    const diffs = await readRecentDiffs(dataDir, adapter.id, dates.length);
    const effective = status ? { ...status, stale: status.date !== todayUtc } : null;
    // Status is authoritative: a diff file is only shown for today when the run
    // that produced it succeeded. A quarantined or failed source shows no
    // diff even if an older file for the same date is lying around.
    const todayDoc = isFresh(effective) ? diffs.find((doc) => doc.date === todayUtc) || null : null;
    sources.push({
      adapter,
      status: effective,
      diffs,
      today: todayDoc ? dayView(adapter, todayDoc) : { items: [], counts: { added: 0, removed: 0, changed: 0, late: 0 }, diff: null },
    });
  }

  // 3. Build metadata: commit sha, build time, absolute base for feeds and og.
  const sha = currentSha();
  const build = {
    builtAt: isoStamp(now),
    sha,
    repoUrl: 'https://github.com/slayyyyer/what-changed',
    baseUrl,
    ogImageUrl: `${baseUrl}og.png`,
  };

  // 4. Render.
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const files = renderAll({ sources, build });
  for (const [path, contents] of files) {
    await writeText(join(outDir, path), contents);
  }

  await copyAssets(outDir);
  await writeText(join(outDir, '.nojekyll'), '');
  await writeJson(join(outDir, 'build.json'), {
    builtAt: build.builtAt,
    commit: sha,
    date: etDate(now),
    offline,
    sources: sources.map((source) => ({
      id: source.adapter.id,
      result: source.status?.result ?? 'never',
      recordCount: source.status?.recordCount ?? 0,
      lastSuccessAt: source.status?.lastSuccessAt ?? null,
      fresh: isFresh(source.status),
    })),
  });

  // 5. Report.
  console.log('');
  for (const source of sources) {
    const label = source.status?.result ?? 'never';
    const counts = source.today.items.length;
    console.log(`  ${source.adapter.id.padEnd(18)} ${label.padEnd(12)} ${String(counts).padStart(4)} item(s) today`);
  }
  console.log(`\nwrote ${files.size + 2} files to ${outDir}`);
  if (sources.some((source) => !isFresh(source.status))) {
    console.log('note: at least one source has no usable snapshot today — the site says so instead of showing zero.');
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=');
    if (inline !== undefined) {
      parsed[key] = inline;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      parsed[key] = argv[index + 1];
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

async function copyAssets(outDir) {
  const assets = ['style.css', 'app.js', 'favicon.svg', 'og.png'];
  for (const name of assets) {
    const from = join(here, 'site', name);
    if (!existsSync(from)) {
      if (name === 'og.png') {
        console.warn('warning: site/og.png is missing — run `node scripts/make-og.js`');
        continue;
      }
      throw new Error(`missing site asset: site/${name}`);
    }
    await copyFile(from, join(outDir, name));
  }
}

function currentSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: here, encoding: 'utf8' });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return 'uncommitted';
}

function normalizeBase(value) {
  return value.endsWith('/') ? value : `${value}/`;
}
