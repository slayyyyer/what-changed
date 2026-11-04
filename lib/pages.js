// Every page the site ships. All rendering happens at build time; the front page
// is complete HTML before a single byte of JavaScript runs.

import { esc, layout, changeRow, countsStrip, chip, trendChart, rootPrefix } from './html.js';
import {
  dayView,
  trendRows,
  maxTotal,
  siteState,
  totalSummary,
  sourceSummary,
  isFresh,
  statusLabel,
} from './view.js';
import { atomFeed, toEntry, feedStamp } from './feeds.js';
import { formatEt, formatUtc, etDate, shortDate } from './time.js';

const TOP_ON_FRONT = 12;
const TOP_ON_SOURCE = 20;
const FEED_ENTRIES = 40;

/**
 * @param {object} ctx
 * @param {Array} ctx.sources  [{ adapter, status, diffs, today }]
 * @param {object} ctx.build   { builtAt, sha, repoUrl, baseUrl, ogImageUrl }
 * @returns {Map<string,string>} path relative to dist -> file contents
 */
export function renderAll(ctx) {
  const files = new Map();
  const shared = { build: ctx.build, sources: ctx.sources };

  files.set('index.html', renderFront({ ...ctx, ...shared }));
  files.set('all.html', renderEverything({ ...ctx, ...shared }));
  files.set('about.html', renderAbout({ ...ctx, ...shared }));
  files.set('404.html', renderNotFound({ ...ctx, ...shared }));

  for (const source of ctx.sources) {
    const { adapter } = source;
    files.set(`sources/${adapter.id}/index.html`, renderSourcePage({ ...ctx, ...shared, source }));
    files.set(`sources/${adapter.id}/all.html`, renderSourceAll({ ...ctx, ...shared, source }));
    files.set(`sources/${adapter.id}/archive/index.html`, renderArchiveIndex({ ...ctx, ...shared, source }));
    for (const doc of source.diffs) {
      files.set(
        `sources/${adapter.id}/archive/${doc.date}.html`,
        renderDayPage({ ...ctx, ...shared, source, doc }),
      );
    }
  }

  files.set('feed.xml', renderCombinedFeed(ctx));
  for (const source of ctx.sources) {
    files.set(`sources/${source.adapter.id}/feed.xml`, renderSourceFeed(ctx, source));
  }

  files.set('data/today.json', `${JSON.stringify(payloadToday(ctx), null, 2)}\n`);
  files.set('data/archive.json', `${JSON.stringify(payloadArchive(ctx), null, 2)}\n`);

  return files;
}

/* ---------------------------------------------------------------- front page */

function renderFront({ build, sources }) {
  const state = siteState(sources);
  const total = totalSummary(sources);
  const today = etDate(build.builtAt);
  const ranked = sources
    .flatMap((source) => source.today.items.map((item) => ({ source, item })))
    .sort((a, b) => {
      if (b.item.score !== a.item.score) return b.item.score - a.item.score;
      if (a.item.key !== b.item.key) return a.item.key < b.item.key ? -1 : 1;
      return a.source.adapter.id < b.source.adapter.id ? -1 : 1;
    });

  const top = ranked.slice(0, TOP_ON_FRONT);

  const body = `
<section class="hero">
  <p class="kicker">Daily diff · ${esc(today)}</p>
  <h1>What changed today</h1>
  <p class="lede">${esc(describeState(state, total, sources))}</p>
  ${stateBanner(state, sources, total)}
  ${ranked.length > TOP_ON_FRONT ? `<p class="hero__more"><a href="./all.html">All ${ranked.length} changes today →</a></p>` : ''}
</section>

<section class="sources" aria-labelledby="sources-heading">
  <h2 id="sources-heading" class="sectionhead">The datasets <span class="muted">${sources.length}</span></h2>
  <div class="sourcegrid">
${sources.map((source) => sourceCard(source, 0, build)).join('\n')}
  </div>
</section>

<section class="ledger" aria-labelledby="ledger-heading">
  <h2 id="ledger-heading" class="sectionhead">Today's changes <span class="muted">${ranked.length}</span></h2>
  ${top.length === 0 ? emptyLedger(state, sources) : `<ol class="changes">
${top.map(({ source, item }) => `<li class="changes__wrap"><p class="changes__source"><a href="./sources/${esc(source.adapter.id)}/">${esc(source.adapter.title)}</a></p>${changeRow(source.adapter, item, 'div')}</li>`).join('\n')}
  </ol>
  <p class="ledger__foot">Ranked by how much a record moved, not by importance to you. <a href="./all.html">Everything that changed today →</a></p>`}
</section>
`;

  return layout({
    title: null,
    description: 'A daily diff of public data: what changed in Charlotte 311 service requests and the Federal Register since the last snapshot. Every item shows the fields that moved.',
    depth: 0,
    body,
    build,
    sources,
    active: 'today',
    pageClass: 'page-front',
  });
}

function describeState(state, total, sources) {
  if (state === 'none') {
    const anySnapshot = sources.some((source) => source.status?.lastSuccessAt);
    return anySnapshot
      ? 'The first snapshots are recorded. Comparisons begin with the next run, so there is nothing to diff yet — and nothing is claimed.'
      : 'No snapshot has been taken yet. The first run records a baseline; there is nothing to compare until the run after that.';
  }
  if (state === 'partial') {
    const missing = sources.filter((source) => !isFresh(source.status));
    return `A partial picture: ${missing.length} of ${sources.length} datasets has no usable snapshot today. What is shown for the others is real; what is missing is labelled as missing, not as zero.`;
  }
  if (state === 'quiet') return 'Every dataset we watch looked the same as its previous snapshot. That is a quiet day, not an empty one — it means the publishers did not change these records, not that nothing happened.';
  const bits = [];
  if (total.added) bits.push(`${total.added} new`);
  if (total.changed) bits.push(`${total.changed} changed`);
  if (total.removed) bits.push(`${total.removed} gone`);
  return `${bits.join(', ')} across ${sources.length} public datasets since the previous snapshot.`;
}

function stateBanner(state, sources, total) {
  if (state === 'partial') {
    const missing = sources.filter((source) => !isFresh(source.status));
    return `<div class="banner banner--warn">
      <p class="banner__title">No snapshot today for ${missing.length === 1 ? 'one dataset' : `${missing.length} datasets`}</p>
      <ul class="banner__list">
        ${missing
          .map(
            (source) => `<li><strong>${esc(source.adapter.title)}</strong> — ${esc(source.status?.reason || 'the run did not produce a usable snapshot')}.
          <span class="muted">Last good snapshot: ${source.status?.lastSuccessAt ? esc(formatEt(source.status.lastSuccessAt)) : 'never'}.</span></li>`,
          )
          .join('\n        ')}
      </ul>
      <p class="banner__note">Nothing is inferred from a failed fetch. No diff is published for a dataset without a snapshot.</p>
    </div>`;
  }
  if (state === 'quiet') {
    return `<div class="banner banner--quiet">
      <p class="banner__title">Quiet day</p>
      <p>${sources.map((source) => esc(source.adapter.title)).join(' and ')} matched ${sources.length === 1 ? 'its' : 'their'} previous snapshot exactly. That comparison is the whole result.</p>
    </div>`;
  }
  if (state === 'none') {
    return `<div class="banner banner--quiet"><p class="banner__title">Waiting for the first snapshot</p><p>Nothing is claimed about these datasets yet.</p></div>`;
  }
  return `<div class="stats">
    <span class="stats__item"><strong>${total.added}</strong><span>new records</span></span>
    <span class="stats__item"><strong>${total.changed}</strong><span>records changed</span></span>
    <span class="stats__item"><strong>${total.removed}</strong><span>records gone</span></span>
    ${total.late ? `<span class="stats__item stats__item--late"><strong>${total.late}</strong><span>backfilled</span></span>` : ''}
  </div>`;
}

function emptyLedger(state, sources) {
  if (state === 'none') {
    return `<p class="empty">There is no diff yet. The pipeline records a baseline on its first run and starts comparing on the second.</p>`;
  }
  if (state === 'partial') {
    return `<p class="empty">No dataset produced a comparable diff today. The details above say why for each one.</p>`;
  }
  return `<p class="empty">Nothing changed. All ${sources.length} datasets matched their previous snapshots byte for byte after normalization.</p>`;
}

function sourceCard(source, depth, build) {
  const root = rootPrefix(depth);
  const counts = sourceSummary(source);
  const label = statusLabel(source.status);
  const href = `${root}sources/${esc(source.adapter.id)}/`;
  const last = source.status?.lastSuccessAt
    ? `last good ${esc(formatEt(source.status.lastSuccessAt))}`
    : 'no snapshot yet';

  const metric = counts
    ? countsStrip(counts)
    : `<p class="counts counts--none">${esc(label.text)}</p>`;

  return `<article class="sourcecard">
    <p class="sourcecard__path"><a href="${href}">${esc(source.adapter.shortTitle || source.adapter.title)}</a></p>
    <h3><a href="${href}">${esc(source.adapter.subtitle || source.adapter.title)}</a></h3>
    ${metric}
    <p class="sourcecard__meta"><span class="chip chip--${label.tone}">${esc(label.text)}</span> <span class="muted">${last} · ${source.status?.recordCount ?? 0} rows in window</span></p>
  </article>`;
}

/* ------------------------------------------------------------- source pages */

function renderSourcePage({ build, sources, source }) {
  const { adapter, status, today, diffs } = source;
  const rows = trendRows(diffs, 14);
  const max = maxTotal(rows);
  const label = statusLabel(status);
  const items = today?.items || [];
  const top = items.slice(0, TOP_ON_SOURCE);
  const compared = today?.diff || null;

  const body = `
<section class="sourcehead">
  <p class="kicker"><a href="../../">Today</a> · dataset</p>
  <h1>${esc(adapter.title)}</h1>
  <p class="lede">${esc(adapter.subtitle || '')}</p>
  <p class="sourcehead__meta">
    <span class="chip chip--${label.tone}">${esc(label.text)}</span>
    <span class="muted">${esc(adapter.publisher || '')} · license ${esc(adapter.license || 'unstated')} · <a href="${esc(adapter.sourceUrl)}" rel="noopener">source<span aria-hidden="true"> ↗</span></a></span>
  </p>
  ${status?.reason ? `<p class="notice notice--fail"><strong>Why there is no diff today:</strong> ${esc(status.reason)}</p>` : ''}
  ${(status?.notes || []).length ? `<ul class="notices">${status.notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}
</section>

<div class="split">
  <section class="panel" aria-labelledby="compare-heading">
    <h2 id="compare-heading">What is being compared</h2>
    <dl class="compare">
      <div><dt>Previous snapshot</dt><dd>${compared ? esc(formatEt(compared.from.takenAt)) : '<span class="muted">none today</span>'}</dd></div>
      <div><dt>This snapshot</dt><dd>${compared ? esc(formatEt(compared.to.takenAt)) : '<span class="muted">none today</span>'}</dd></div>
      <div><dt>UTC</dt><dd>${compared ? `${esc(formatUtc(compared.from.takenAt))} → ${esc(formatUtc(compared.to.takenAt))}` : '—'}</dd></div>
      <div><dt>Window</dt><dd>${status?.windowFrom ? `${esc(status.windowFrom)} → ${esc(status.windowTo)}` : '—'}</dd></div>
      <div><dt>Rows</dt><dd>${compared ? `${compared.from.recordCount} → ${compared.to.recordCount}` : '—'}</dd></div>
    </dl>
    <p class="panel__note">${esc(adapter.notesForHumans || '')}</p>
  </section>

  <section class="panel" aria-labelledby="trend-heading">
    <h2 id="trend-heading">Changes per day</h2>
    ${trendChart(rows, max, { depth: 1, sourceId: adapter.id, currentDate: compared?.date || null })}
    <p class="panel__note"><a href="archive/">Full archive →</a></p>
  </section>
</div>

<section class="ledger" aria-labelledby="today-heading">
  <h2 id="today-heading" class="sectionhead">Today <span class="muted">${items.length}</span></h2>
  ${items.length === 0
    ? `<p class="empty">${emptySourceText(source)}</p>`
    : `<ol class="changes">
${top.map((item) => changeRow(adapter, item)).join('\n')}
  </ol>
  ${items.length > TOP_ON_SOURCE ? `<p class="ledger__foot"><a href="all.html">All ${items.length} changes in this dataset today →</a></p>` : ''}`}
</section>

<section class="limits" aria-labelledby="limits-heading">
  <h2 id="limits-heading">Limits of this source</h2>
  <ul>
    <li>${esc(adapter.notesForHumans || '')}</li>
    <li>Published under ${esc(adapter.license || 'an unstated license')}. Every item links back to ${esc(adapter.publisher || 'the publisher')}.</li>
    <li>Only the fields listed on this page are compared. ${esc(describeIgnored(adapter))}</li>
  </ul>
</section>
`;

  return layout({
    title: adapter.title,
    description: `${adapter.title}: today's changes and the archive. ${adapter.subtitle || ''}`,
    depth: 1,
    body,
    build,
    sources,
    active: 'today',
  });
}

function emptySourceText(source) {
  const { status } = source;
  if (!isFresh(status)) {
    return `No snapshot today, so there is no diff and none is implied. ${status?.lastSuccessAt ? `Last good snapshot: ${formatEt(status.lastSuccessAt)}.` : 'This source has never produced a snapshot.'}`;
  }
  if (status.result === 'baseline') return 'This is the baseline snapshot. Comparisons begin with the next run.';
  return 'Quiet day: the normalized snapshot matched the previous one exactly.';
}

function describeIgnored(adapter) {
  if (adapter.ignoreFields?.length) {
    return `Excluded from comparison: ${adapter.ignoreFields.join(', ')}.`;
  }
  return 'Timestamps, counters and formatting churn are collapsed before comparison.';
}

function renderSourceAll({ build, sources, source }) {
  const { adapter, today } = source;
  const items = today?.items || [];
  const body = `
<section class="pagehead">
  <p class="kicker"><a href="./">${esc(adapter.shortTitle || adapter.title)}</a> · everything</p>
  <h1>Every change in ${esc(adapter.shortTitle || adapter.title)} today</h1>
  <p class="lede">${items.length} item${items.length === 1 ? '' : 's'}, in the same order as the summary, with search. Nothing here is hidden by rank — ranking only decides what appears first.</p>
</section>
${filterBar()}
${items.length === 0 ? '<p class="empty">No changes to list today.</p>' : `<ol class="changes">
${items.map((item) => changeRow(adapter, item)).join('\n')}
</ol>`}
`;
  return layout({
    title: `Everything in ${adapter.title}`,
    description: `Every change detected in ${adapter.title} today, searchable.`,
    depth: 1,
    body,
    build,
    sources,
    active: 'all',
  });
}

function renderEverything({ build, sources }) {
  const ranked = sources
    .flatMap((source) => source.today.items.map((item) => ({ source, item })))
    .sort((a, b) => {
      if (b.item.score !== a.item.score) return b.item.score - a.item.score;
      if (a.item.key !== b.item.key) return a.item.key < b.item.key ? -1 : 1;
      return a.source.adapter.id < b.source.adapter.id ? -1 : 1;
    });

  const grouped = sources
    .map((source) => {
      const items = source.today.items;
      if (items.length === 0) return '';
      return `<section class="ledger" aria-labelledby="src-${esc(source.adapter.id)}">
  <h2 id="src-${esc(source.adapter.id)}" class="sectionhead">${esc(source.adapter.title)} <span class="muted">${items.length}</span></h2>
  <ol class="changes">
${items.map((item) => changeRow(source.adapter, item)).join('\n')}
  </ol>
</section>`;
    })
    .filter(Boolean)
    .join('\n');

  const body = `
<section class="pagehead">
  <p class="kicker"><a href="./">Today</a> · everything</p>
  <h1>Everything that changed today</h1>
  <p class="lede">${ranked.length} item${ranked.length === 1 ? '' : 's'} across ${sources.length} datasets, grouped by source and ordered by significance within each. Use the box below to search; it filters what is already on the page.</p>
</section>
${filterBar()}
${grouped || '<p class="empty">Nothing changed in any dataset today, or no dataset produced a snapshot. The page above says which.</p>'}
`;
  return layout({
    title: 'Everything that changed today',
    description: 'The complete list of changes detected across every dataset today, searchable without a server.',
    depth: 0,
    body,
    build,
    sources,
    active: 'all',
  });
}

function filterBar() {
  return `<form class="filterbar" role="search" data-role="filter">
  <label class="sr-only" for="q">Search today's changes</label>
  <input id="q" name="q" type="search" placeholder="Search types, agencies, fields, keys…" autocomplete="off" data-role="query">
  <div class="filterbar__kinds" role="group" aria-label="Filter by kind">
    <button type="button" class="pill is-on" data-kind="all" aria-pressed="true">All</button>
    <button type="button" class="pill" data-kind="added" aria-pressed="false">New</button>
    <button type="button" class="pill" data-kind="changed" aria-pressed="false">Changed</button>
    <button type="button" class="pill" data-kind="removed" aria-pressed="false">Gone</button>
  </div>
  <p class="filterbar__count" data-role="count" aria-live="polite"></p>
</form>`;
}

/* ------------------------------------------------------------ archive pages */

function renderArchiveIndex({ build, sources, source }) {
  const { adapter, diffs } = source;
  const rows = diffs
    .map(
      (doc) => `<tr>
      <th scope="row"><a href="${esc(doc.date)}.html">${esc(shortDate(doc.date))} ${esc(doc.date.slice(0, 4))}</a></th>
      <td class="num">${doc.stats?.added ?? 0}</td>
      <td class="num">${doc.stats?.changed ?? 0}</td>
      <td class="num">${doc.stats?.removed ?? 0}</td>
      <td class="num muted">${doc.stats?.expired ?? 0}</td>
      <td class="num">${doc.to?.recordCount ?? '—'}</td>
    </tr>`,
    )
    .join('\n');

  const body = `
<section class="pagehead">
  <p class="kicker"><a href="../">${esc(adapter.shortTitle || adapter.title)}</a> · archive</p>
  <h1>Every day this dataset was compared</h1>
  <p class="lede">${diffs.length} archived diff${diffs.length === 1 ? '' : 's'}. Each row is one comparison between two snapshots; “aged out” counts records that left the rolling window and are not deletions.</p>
</section>
${diffs.length === 0
  ? '<p class="empty">No diffs archived yet.</p>'
  : `<div class="tablewrap"><table class="archive">
  <caption class="sr-only">Archived diffs, newest first</caption>
  <thead><tr><th scope="col">Date</th><th scope="col" class="num">New</th><th scope="col" class="num">Changed</th><th scope="col" class="num">Gone</th><th scope="col" class="num">Aged out</th><th scope="col" class="num">Rows</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table></div>`}
`;
  return layout({
    title: `Archive · ${adapter.title}`,
    description: `Every archived daily diff for ${adapter.title}.`,
    depth: 2,
    body,
    build,
    sources,
    active: 'today',
  });
}

function renderDayPage({ build, sources, source, doc }) {
  const { adapter } = source;
  const view = dayView(adapter, doc);
  const items = view.items;

  const body = `
<section class="pagehead">
  <p class="kicker"><a href="../../">${esc(adapter.shortTitle || adapter.title)}</a> · <a href="../">archive</a> · ${esc(doc.date)}</p>
  <h1>${esc(shortDate(doc.date))}, ${esc(doc.date.slice(0, 4))}</h1>
  <p class="lede">What changed in ${esc(adapter.title)} between two snapshots.</p>
  ${countsStrip(view.counts)}
</section>

<section class="panel panel--wide" aria-labelledby="snapshots-heading">
  <h2 id="snapshots-heading">The two snapshots</h2>
  <dl class="compare">
    <div><dt>Previous</dt><dd>${esc(formatEt(doc.from.takenAt))} · ${doc.from.recordCount} rows</dd></div>
    <div><dt>This one</dt><dd>${esc(formatEt(doc.to.takenAt))} · ${doc.to.recordCount} rows</dd></div>
    <div><dt>UTC</dt><dd>${esc(formatUtc(doc.from.takenAt))} → ${esc(formatUtc(doc.to.takenAt))}</dd></div>
    <div><dt>Window</dt><dd>${esc(doc.window?.from || '—')} → ${esc(doc.window?.to || '—')}</dd></div>
    ${doc.stats?.expired ? `<div><dt>Aged out</dt><dd>${doc.stats.expired} record(s) left the rolling window; not counted as deletions</dd></div>` : ''}
  </dl>
</section>

${items.length === 0
  ? '<p class="empty">Nothing changed in this comparison.</p>'
  : `<ol class="changes">
${items.map((item) => changeRow(adapter, item)).join('\n')}
</ol>`}
`;
  return layout({
    title: `${doc.date} · ${adapter.title}`,
    description: `The archived diff for ${adapter.title} on ${doc.date}.`,
    depth: 2,
    body,
    build,
    sources,
    active: 'today',
  });
}

/* ------------------------------------------------------------------- about */

function renderAbout({ build, sources }) {
  const rows = sources
    .map(
      (source) => `<tr>
      <th scope="row"><a href="./sources/${esc(source.adapter.id)}/">${esc(source.adapter.title)}</a></th>
      <td>${esc(source.adapter.publisher || '')}</td>
      <td>${esc(source.adapter.license || 'unstated')}</td>
      <td>${esc(String(source.adapter.windowDays || '—'))} days</td>
      <td><a href="${esc(source.adapter.sourceUrl)}" rel="noopener">source ↗</a></td>
    </tr>`,
    )
    .join('\n');

  const body = `
<section class="pagehead">
  <p class="kicker">About</p>
  <h1>What this is, and what it is not</h1>
  <p class="lede">A static site that snapshots a handful of public datasets once a day and publishes only what changed between two snapshots.</p>
</section>

<section class="prose">
  <h2>The diff is the product</h2>
  <p>Each morning a GitHub Actions job fetches each dataset, normalizes it into records with stable keys, and compares it to the previous snapshot field by field. The result is stored three ways: the full normalized snapshot (overwritten), the day's diff (kept forever), and a status file per source. The site you are reading is rendered from that archive — no database, no server, no runtime dependencies.</p>

  <h2>Five rules the pipeline will not break</h2>
  <ol>
    <li><strong>“No snapshot” is not “no changes.”</strong> A failed fetch shows as a failed fetch, with the last good time, and produces no diff at all.</li>
    <li><strong>A snapshot must earn acceptance.</strong> Record counts, required fields, key shapes and the share of records that moved are checked before anything is stored. A snapshot that fails is quarantined: yesterday's records stay, the reason is published, and no diff is emitted.</li>
    <li><strong>Schema drift is announced.</strong> Each adapter declares the fields it expects. New or vanished fields produce a visible notice rather than silently rewriting the diff.</li>
    <li><strong>Nothing is inferred.</strong> Every item shows the two snapshot times it came from. The site reports that a record changed; it never says why.</li>
    <li><strong>Backfills are labelled.</strong> A record that appears today but carries an older event date is marked “backfilled”, not “new”.</li>
  </ol>

  <h2>The datasets</h2>
  <div class="tablewrap"><table class="archive">
    <caption class="sr-only">Configured sources</caption>
    <thead><tr><th scope="col">Dataset</th><th scope="col">Publisher</th><th scope="col">License</th><th scope="col">Window</th><th scope="col">Link</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table></div>

  <h2>Privacy</h2>
  <p>311 requests and permit records can carry names and precise addresses. Personal fields are dropped or coarsened at normalization time, before anything reaches the repository. Which fields are kept, dropped or coarsened is written down per source in <a href="${esc(build.repoUrl)}/blob/main/docs/privacy.md">docs/privacy.md</a>.</p>

  <h2>Being a good citizen</h2>
  <p>One request per source per day, a descriptive User-Agent with a contact address, conditional requests where the publisher supports them, and backoff that honors <code>Retry-After</code>. Terms, licenses and update cadence for each source are recorded in <a href="${esc(build.repoUrl)}/blob/main/docs/sources.md">docs/sources.md</a>.</p>

  <h2>Reading the terms used here</h2>
  <ul class="glossary">
    <li><strong>appeared</strong> — in today's snapshot and not yesterday's.</li>
    <li><strong>changed</strong> — present in both, with at least one comparable field different.</li>
    <li><strong>disappeared</strong> — present yesterday, absent today and still inside the rolling window.</li>
    <li><strong>aged out</strong> — left the rolling window because the window moved. Never counted as a deletion.</li>
    <li><strong>backfilled</strong> — new to the snapshot, but dated before the previous snapshot was taken.</li>
    <li><strong>quarantined</strong> — the snapshot failed a sanity gate and was not published at all.</li>
  </ul>

  <h2>Source and paper</h2>
  <p>Everything is on GitHub: <a href="${esc(build.repoUrl)}">${esc(build.repoUrl.replace('https://', ''))}</a>. The technical write-up is <a href="${esc(build.repoUrl)}/blob/main/docs/paper.md">docs/paper.md</a>; the decisions are in <a href="${esc(build.repoUrl)}/tree/main/docs/adr">docs/adr/</a>.</p>
  <p class="muted">Built ${esc(formatEt(build.builtAt))} from commit <code>${esc(build.sha.slice(0, 7))}</code>.</p>
</section>
`;
  return layout({
    title: 'About',
    description: 'How What Changed Today works: daily snapshots, field-level diffs, sanity gates, and the limits of both.',
    depth: 0,
    body,
    build,
    sources,
    active: 'about',
  });
}

function renderNotFound({ build, sources }) {
  const body = `
<section class="pagehead">
  <p class="kicker">404</p>
  <h1>That page is not here</h1>
  <p class="lede">Archives are per day and per source. Try <a href="./">today's changes</a>, or <a href="./all.html">everything</a>.</p>
</section>`;
  return layout({
    title: 'Not found',
    description: 'Page not found.',
    depth: 0,
    body,
    build,
    sources,
    active: '',
  });
}

/* ------------------------------------------------------------------- feeds */

function renderCombinedFeed(ctx) {
  const { build, sources } = ctx;
  const entries = sources
    .flatMap((source) => source.today.items.map((item) => toEntry(source, item, build)))
    .sort((a, b) => (a.updated === b.updated ? (a.id < b.id ? -1 : 1) : a.updated < b.updated ? 1 : -1))
    .slice(0, FEED_ENTRIES);
  return atomFeed({
    title: 'What Changed Today',
    subtitle: 'What changed in the public datasets we watch, once a day.',
    id: `${build.baseUrl}feed.xml`,
    selfUrl: `${build.baseUrl}feed.xml`,
    siteUrl: build.baseUrl,
    updated: feedStamp(build.builtAt),
    entries,
  });
}

function renderSourceFeed(ctx, source) {
  const { build } = ctx;
  const entries = source.today.items.slice(0, FEED_ENTRIES).map((item) => toEntry(source, item, build));
  return atomFeed({
    title: `${source.adapter.title} — what changed`,
    subtitle: source.adapter.subtitle || 'Daily diff',
    id: `${build.baseUrl}sources/${source.adapter.id}/feed.xml`,
    selfUrl: `${build.baseUrl}sources/${source.adapter.id}/feed.xml`,
    siteUrl: `${build.baseUrl}sources/${source.adapter.id}/`,
    updated: feedStamp(build.builtAt),
    entries,
  });
}

/* ------------------------------------------------------------------ payloads */

function payloadToday(ctx) {
  return {
    builtAt: ctx.build.builtAt,
    commit: ctx.build.sha,
    date: etDate(ctx.build.builtAt),
    sources: ctx.sources.map((source) => ({
      id: source.adapter.id,
      title: source.adapter.title,
      sourceUrl: source.adapter.sourceUrl,
      status: {
        result: source.status?.result ?? 'never',
        reason: source.status?.reason ?? null,
        lastSuccessAt: source.status?.lastSuccessAt ?? null,
        recordCount: source.status?.recordCount ?? 0,
        windowFrom: source.status?.windowFrom ?? null,
        windowTo: source.status?.windowTo ?? null,
        notes: source.status?.notes ?? [],
      },
      diff: source.today?.diff
        ? {
            date: source.today.diff.date,
            from: source.today.diff.from,
            to: source.today.diff.to,
            stats: source.today.diff.stats,
            items: source.today.items.map((item) => ({
              kind: item.kind,
              key: item.key,
              label: item.label,
              description: item.description,
              score: item.score,
              late: item.late,
              link: item.link,
              recordLabel: item.recordLabel,
              changes: item.changes,
            })),
          }
        : null,
    })),
  };
}

function payloadArchive(ctx) {
  return {
    builtAt: ctx.build.builtAt,
    sources: ctx.sources.map((source) => ({
      id: source.adapter.id,
      title: source.adapter.title,
      days: source.diffs.map((doc) => ({
        date: doc.date,
        added: doc.stats?.added ?? 0,
        changed: doc.stats?.changed ?? 0,
        removed: doc.stats?.removed ?? 0,
        expired: doc.stats?.expired ?? 0,
        url: `${ctx.build.baseUrl}sources/${source.adapter.id}/archive/${doc.date}.html`,
      })),
    })),
  };
}
