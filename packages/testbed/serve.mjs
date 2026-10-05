/**
 * Zero-dependency dev server for the testbed.
 *  - serves the repo root as static files (with HTTP Range support, so
 *    video seeking in the extractor is reliable)
 *  - POST /api/eval-results  -> writes eval/<timestamp>_<model>.json
 *
 * Run: node serve.mjs   (PORT env var optional, default 8080)
 */

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[/\\]+$/, '');
const PORT = Number(process.env.PORT ?? 8080);
const MAX_REPORT_BYTES = 5_000_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function saveEval(req, res) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_REPORT_BYTES) return send(res, 413, { error: 'report too large' });
  }
  let report;
  try {
    report = JSON.parse(body);
  } catch {
    return send(res, 400, { error: 'invalid JSON' });
  }
  const model = String(report.model ?? 'unknown').replace(/[^a-z0-9-]/gi, '') || 'unknown';
  const ts = String(report.timestamp ?? new Date().toISOString()).replace(/[:.]/g, '-');
  const rel = join('eval', `${ts}_${model}.json`);
  await mkdir(join(ROOT, 'eval'), { recursive: true });
  await writeFile(join(ROOT, rel), JSON.stringify(report, null, 2));
  send(res, 200, { saved: rel });
}

function serveStatic(req, res, pathname) {
  const path = normalize(join(ROOT, pathname));
  if (!path.startsWith(ROOT + sep)) return send(res, 403, { error: 'forbidden' });

  let file = path;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: 'not found' });

  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const size = statSync(file).size;

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
      const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      });
      return createReadStream(file, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/eval-results') {
      saveEval(req, res).catch((err) => send(res, 500, { error: String(err) }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (err) {
    send(res, 400, { error: String(err) });
  }
});

server.listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
