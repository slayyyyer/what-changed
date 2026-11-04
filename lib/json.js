// Canonical JSON, hashing, and the value normalization used by the diff engine.
//
// Everything written to the `data` branch goes through these helpers so that the
// same inputs always produce byte-identical output: stable key order, stable
// field order, stable line endings, one trailing newline.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Recursively sort object keys. Arrays keep their order. */
export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
    return out;
  }
  return value;
}

/** Stable, indented JSON with a trailing newline. */
export function stableJson(value, indent = 2) {
  return `${JSON.stringify(stableValue(value), null, indent)}\n`;
}

/** Compact stable JSON, for NDJSON lines and inline script islands. */
export function compactJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Canonical comparison form for a field value.
 *
 * Collapses whitespace, applies Unicode NFKC, and normalizes line endings so
 * that publisher formatting churn (a double space, a non-breaking space, CRLF)
 * is not reported as a change. Case is preserved here; adapters opt specific
 * fields into case-insensitive comparison via `caseInsensitiveFields`.
 */
export function canonicalValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return String(value)
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

/** Display form: canonical whitespace, original case. */
export function displayValue(value) {
  if (value === null || value === undefined) return null;
  const text = canonicalValue(value);
  return text === '' ? null : text;
}

/**
 * Canonical record fields: a name is present only when it has a value. This is
 * the single definition of "empty" used by the adapters, the serializer and the
 * patch applier, so a null can never masquerade as a distinct value.
 */
export function dropEmpty(fields) {
  const out = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (canonicalValue(value) === '') continue;
    out[name] = value;
  }
  return out;
}

export function readJson(file) {
  return readFile(file, 'utf8').then((text) => JSON.parse(text));
}

export async function readJsonSafe(file, fallback = null) {
  try {
    return await readJson(file);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeText(file, text) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
}

export async function writeJson(file, value) {
  await writeText(file, stableJson(value));
}

/** Parse a JSON file, returning `fallback` when it is missing or malformed. */
export async function readJsonLoose(file, fallback = null) {
  try {
    return await readJson(file);
  } catch {
    return fallback;
  }
}
