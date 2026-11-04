// Atom feeds: one per source, one combined. Entries are the same ranked items the
// pages show; the feed is a convenience, not a different truth.

import { esc } from './html.js';
import { isoStamp } from './time.js';

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.subtitle
 * @param {string} options.id absolute feed id
 * @param {string} options.selfUrl absolute feed URL
 * @param {string} options.siteUrl absolute HTML URL
 * @param {string} options.updated ISO timestamp
 * @param {Array<{title:string, link:string, id:string, updated:string, summary:string, source:string}>} options.entries
 */
export function atomFeed({ title, subtitle, id, selfUrl, siteUrl, updated, entries }) {
  const items = entries
    .map(
      (entry) => `  <entry>
    <title type="text">${esc(entry.title)}</title>
    <id>${esc(entry.id)}</id>
    <link rel="alternate" type="text/html" href="${esc(entry.link)}"/>
    <updated>${esc(entry.updated)}</updated>
    <category term="${esc(entry.source)}"/>
    <summary type="text">${esc(entry.summary)}</summary>
  </entry>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">${esc(title)}</title>
  <subtitle type="text">${esc(subtitle)}</subtitle>
  <id>${esc(id)}</id>
  <link rel="self" type="application/atom+xml" href="${esc(selfUrl)}"/>
  <link rel="alternate" type="text/html" href="${esc(siteUrl)}"/>
  <updated>${esc(updated)}</updated>
  <author><name>Justin Baker</name><uri>https://slayyyyer.github.io/</uri></author>
  <generator uri="https://github.com/slayyyyer/what-changed">what-changed</generator>
${items}
</feed>
`;
}

/** Entry ids are stable per source, day, record and field set. */
export function entryId(sourceId, date, item) {
  const suffix = item.kind === 'changed' ? item.changes.map((change) => change.name).sort().join('+') : item.kind;
  return `urn:what-changed:${sourceId}:${date}:${item.key}:${suffix}`;
}

export function toEntry(source, item, { baseUrl, builtAt }) {
  const date = source.today?.diff?.date || builtAt.slice(0, 10);
  return {
    title: `${item.late ? 'backfilled: ' : ''}${item.recordLabel || item.key} — ${item.label}`,
    link: item.link || `${baseUrl}sources/${source.adapter.id}/`,
    id: entryId(source.adapter.id, date, item),
    updated: source.today?.diff?.to?.takenAt || builtAt,
    summary: item.description,
    source: source.adapter.id,
  };
}

export function feedStamp(builtAt) {
  return isoStamp(builtAt);
}
