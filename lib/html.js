// HTML building blocks: escaping, the shared layout, and small components.
// No templating library; the site is pre-rendered to plain HTML at build time.

import { formatEt, formatUtc, shortDate } from './time.js';
import { statusLabel } from './view.js';

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function rootPrefix(depth) {
  return depth <= 0 ? './' : '../'.repeat(depth);
}

/**
 * Shared page shell.
 *
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.description
 * @param {number} options.depth 0 for /, 1 for /sources/x/, 2 for /sources/x/archive/
 * @param {string} options.body
 * @param {object} options.build { builtAt, sha, repoUrl }
 * @param {Array} options.sources
 * @param {string} [options.active]
 * @param {string} [options.pageClass]
 */
export function layout({ title, description, depth, body, build, sources, active = '', pageClass = '' }) {
  const root = rootPrefix(depth);
  const pageTitle = title ? `${title} · What Changed Today` : 'What Changed Today';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#dcefff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b1b2b" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(build.ogImageUrl)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="What Changed Today">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="Everything that changed" href="${root}feed.xml">
<link rel="stylesheet" href="${root}style.css">
</head>
<body class="${esc(pageClass)}">
<a class="skip" href="#main">Skip to the changes</a>
<header class="site-header">
  <div class="shell site-header__inner">
    <a class="brand" href="${root}">
      <span class="brand__mark" aria-hidden="true">±</span>
      <span class="brand__text"><strong>What Changed Today</strong><span class="brand__path">/what-changed/</span></span>
    </a>
    <nav class="nav" aria-label="Sections">
      <a href="${root}"${active === 'today' ? ' aria-current="page"' : ''}>Today</a>
      <a href="${root}all.html"${active === 'all' ? ' aria-current="page"' : ''}>Everything</a>
      <a href="${root}about.html"${active === 'about' ? ' aria-current="page"' : ''}>About</a>
      <a href="${root}feed.xml">Feed</a>
    </nav>
  </div>
</header>
<main id="main" class="shell">
${body}
</main>
${footer({ build, sources, depth })}
<script src="${root}app.js" defer></script>
</body>
</html>
`;
}

function footer({ build, sources, depth = 0 }) {
  const root = rootPrefix(depth);
  const rows = sources
    .map((source) => {
      const status = source.status;
      const label = statusLabel(status);
      const last = status?.lastSuccessAt
        ? `${formatEt(status.lastSuccessAt)} <span class="muted">(${status.lastSuccessRecordCount ?? 0} records)</span>`
        : '<span class="muted">no successful snapshot yet</span>';
      return `<tr>
        <th scope="row"><a href="${root}sources/${esc(source.adapter.id)}/">${esc(source.adapter.title)}</a></th>
        <td><span class="chip chip--${label.tone}">${esc(label.text)}</span></td>
        <td>${last}</td>
        <td class="num">${status?.recordCount ? esc(status.recordCount) : '—'}</td>
      </tr>`;
    })
    .join('\n');

  return `<footer class="site-footer">
  <div class="shell site-footer__inner">
    <section class="footnote" aria-labelledby="what-this-is">
      <h2 id="what-this-is">What this is, and what it is not</h2>
      <p><strong>This is</strong> a daily snapshot of public datasets, compared against the previous snapshot. Each item shows the fields that moved, the two snapshot times being compared, and a link back to the publisher.</p>
      <p><strong>This is not</strong> a live view, a complete record of the publisher's data, or a claim about what happened in the world. It reports that a record changed, never why. A quiet day means the publisher's data looked the same, not that nothing happened. A missing snapshot is shown as a missing snapshot, never as zero changes.</p>
      <p class="footnote__meta">Build ${esc(formatEt(build.builtAt))} · ${esc(formatUtc(build.builtAt))} · commit <a href="${esc(build.repoUrl)}/commit/${esc(build.sha)}"><code>${esc(build.sha.slice(0, 7))}</code></a> · sources: ${sources.length} · <a href="${root}about.html">how this works</a></p>
    </section>
    <section class="status" aria-labelledby="snapshot-status">
      <h2 id="snapshot-status">Snapshot status</h2>
      <table>
        <caption class="sr-only">Last successful snapshot per source</caption>
        <thead><tr><th scope="col">Source</th><th scope="col">Today</th><th scope="col">Last good snapshot</th><th scope="col" class="num">Rows</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </section>
  </div>
</footer>`;
}

/** A status pill for a source. */
export function chip(status) {
  const label = statusLabel(status);
  return `<span class="chip chip--${label.tone}">${esc(label.text)}</span>`;
}

/** One change, as a row. `search` is pre-lowercased so client filtering is trivial. */
export function changeRow(adapter, item, tag = 'li') {
  const kindText = item.kind === 'added' ? 'appeared' : item.kind === 'removed' ? 'disappeared' : 'changed';
  const parts = [adapter.title, item.recordLabel || item.key, item.label, item.description];
  if (item.kind === 'changed') {
    for (const change of item.changes) {
      parts.push(`${adapter.fieldLabels?.[change.name] || change.name} ${change.from ?? ''} ${change.to ?? ''}`);
    }
  }
  const search = parts.join(' ').toLowerCase();

  const fieldRows = item.kind === 'changed'
    ? `<table class="fields">
        <caption class="sr-only">Fields that changed</caption>
        <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
        <tbody>
        ${item.changes
          .map(
            (change) => `<tr>
            <th scope="row">${esc(adapter.fieldLabels?.[change.name] || change.name)}</th>
            <td class="from">${change.from === null ? '<span class="muted">empty</span>' : esc(change.from)}</td>
            <td class="to">${change.to === null ? '<span class="muted">empty</span>' : esc(change.to)}</td>
          </tr>`,
          )
          .join('\n        ')}
        </tbody>
      </table>`
    : '';

  const link = item.link
    ? `<a class="change__link" href="${esc(item.link)}" rel="noopener">open the record<span aria-hidden="true"> ↗</span></a>`
    : '';

  return `<${tag} class="change change--${item.kind}" data-kind="${item.kind}" data-source="${esc(adapter.id)}" data-search="${esc(search)}">
  <div class="change__top">
    <span class="change__kind">${esc(kindText)}</span>
    <span class="change__label">${esc(item.label)}</span>
    ${item.late ? '<span class="change__late" title="In the snapshot for the first time, but dated before the previous snapshot">backfilled</span>' : ''}
  </div>
  <h3 class="change__title">${esc(item.recordLabel || item.key)}</h3>
  <p class="change__desc">${esc(item.description)}</p>
  ${fieldRows}
  <div class="change__foot">
    <code class="change__key">${esc(item.key)}</code>
    ${link}
  </div>
</${tag}>`;
}

/** Compact counts strip. */
export function countsStrip(counts) {
  if (!counts) return '';
  return `<p class="counts">
    <span class="counts__item"><strong>${counts.added}</strong> new</span>
    <span class="counts__item"><strong>${counts.changed}</strong> changed</span>
    <span class="counts__item"><strong>${counts.removed}</strong> gone</span>
    ${counts.late ? `<span class="counts__item counts__item--late"><strong>${counts.late}</strong> backfilled</span>` : ''}
  </p>`;
}

/** Bar chart of the last two weeks, pure CSS, no JS. */
export function trendChart(rows, max, { depth, sourceId, currentDate }) {
  if (rows.length === 0) {
    return '<p class="muted">No archived diffs yet. The first comparison happens on the next run.</p>';
  }
  const root = rootPrefix(depth);
  const bars = rows
    .map((row) => {
      const width = max === 0 ? 0 : Math.round((row.total / max) * 100);
      const title = `${row.date}: ${row.added} new, ${row.changed} changed, ${row.removed} gone`;
      const isToday = row.date === currentDate;
      return `<li class="trend__row${isToday ? ' is-today' : ''}">
        <a class="trend__date" href="${root}sources/${esc(sourceId)}/archive/${esc(row.date)}.html" title="${esc(title)}">${esc(shortDate(row.date))}</a>
        <span class="trend__bar" aria-hidden="true"><span class="trend__fill" style="width:${width}%"></span></span>
        <span class="trend__value">${row.total}${row.expired ? `<span class="muted"> (+${row.expired} aged out)</span>` : ''}</span>
        <span class="sr-only">${esc(title)}</span>
      </li>`;
    })
    .join('\n');
  return `<ol class="trend">
${bars}
  </ol>`;
}
