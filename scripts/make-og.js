#!/usr/bin/env node
// Generates site/og.png (1200x630) with zero dependencies: a small PNG encoder
// and a 5x7 bitmap font. Deterministic — the same script always emits the same
// bytes, so the file can live in the repo without churning.

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WIDTH = 1200;
const HEIGHT = 630;

const BG = [11, 27, 43, 255];
const INK = [232, 242, 251, 255];
const MUTED = [147, 174, 196, 255];
const AQUA = [70, 208, 230, 255];
const PINK = [255, 157, 203, 255];
const GREEN = [127, 227, 155, 255];

const buffer = Buffer.alloc(WIDTH * HEIGHT * 4);
for (let index = 0; index < buffer.length; index += 4) {
  buffer[index] = BG[0];
  buffer[index + 1] = BG[1];
  buffer[index + 2] = BG[2];
  buffer[index + 3] = BG[3];
}

function pixel(x, y, color) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * 4;
  buffer[offset] = color[0];
  buffer[offset + 1] = color[1];
  buffer[offset + 2] = color[2];
  buffer[offset + 3] = color[3];
}

function rect(x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) pixel(column, row, color);
  }
}

function drawText(text, x, y, scale, color, tracking = 1) {
  let cursor = x;
  for (const character of text.toUpperCase()) {
    const glyph = FONT[character] || FONT[' '];
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if (glyph[row][column] !== '#') continue;
        rect(cursor + column * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += (5 + tracking) * scale;
  }
}

function render() {
// Background furniture: a soft band, a rule, and a vertical accent.
rect(0, 0, WIDTH, 6, AQUA);
rect(72, 96, 9, 402, AQUA);
rect(112, 96, 520, 2, [70, 208, 230, 90]);

drawText('WHAT CHANGED', 116, 122, 9, INK);
drawText('TODAY', 116, 216, 9, PINK);

drawText('A DAILY DIFF OF PUBLIC DATA', 118, 322, 3, MUTED);
drawText('CHARLOTTE 311 + FEDERAL REGISTER', 118, 352, 3, MUTED);

// A miniature diff: one added row, one changed row, one removed row.
const rows = [
  { y: 420, color: GREEN, label: 'NEW' },
  { y: 462, color: AQUA, label: 'CHANGED' },
  { y: 504, color: PINK, label: 'GONE' },
];
for (const row of rows) {
  rect(118, row.y, 5, 26, row.color);
  drawText(row.label, 140, row.y + 5, 3, row.color);
  rect(320, row.y + 9, 500, 7, [70, 208, 230, 60]);
  rect(320, row.y + 9, 190, 7, [147, 174, 196, 120]);
}

drawText('SLAYYYER.GITHUB.IO/WHAT-CHANGED', 118, 566, 2, MUTED);

writeFileSync(join(here, '..', 'site', 'og.png'), encodePng(WIDTH, HEIGHT, buffer));
console.log('wrote site/og.png (1200x630)');
}

/* ------------------------------------------------------------- PNG writer */

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 4 + 1)] = 0;
    rgba.copy(raw, row * (width * 4 + 1) + 1, row * width * 4, (row + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

/* -------------------------------------------------------------- 5x7 font */

const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
};

render();
