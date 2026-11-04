#!/usr/bin/env node
// A tiny static server for local viewing. No dependencies, no watcher.
//
//   node serve.js            http://localhost:8080/
//   node serve.js 9000       http://localhost:9000/

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, process.argv[3] || 'dist');
const port = Number(process.argv[2] || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/atom+xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));

  if (!file.startsWith(root)) {
    response.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    const body = await readFile(target);
    response.writeHead(200, {
      'Content-Type': TYPES[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    try {
      const body = await readFile(join(root, '404.html'));
      response.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://localhost:${port}/`);
});
