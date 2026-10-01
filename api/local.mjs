// Servidor local para probar TODO en tu laptop (y también es el "plan B" del día de la exposición).
//   http://localhost:8787        → la página (carpeta docs)
//   http://localhost:8787/api/…  → la misma API que corre en Lambda
// Uso: copia .env.example a .env, llénalo y ejecuta:  npm run local
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

// Carga el archivo .env (formato CLAVE=valor) sin dependencias extra.
const archivoEnv = path.join(aqui, '.env');
if (fs.existsSync(archivoEnv)) {
  for (const linea of fs.readFileSync(archivoEnv, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} else {
  console.warn('No existe api/.env — copia .env.example a .env y llénalo.');
}

const { handler } = await import('./index.mjs');
const PUERTO = Number(process.env.PORT || 8787);
const DOCS = path.resolve(aqui, '..', 'docs');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');

  if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
    let body = '';
    for await (const trozo of req) body += trozo;
    const evento = {
      rawPath: url.pathname.slice(4) || '/',
      rawQueryString: url.search.slice(1),
      queryStringParameters: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)])),
      requestContext: { http: { method: req.method } },
      body,
      isBase64Encoded: false,
    };
    const r = await handler(evento);
    res.writeHead(r.statusCode, r.headers);
    res.end(r.body);
    return;
  }

  let archivo = path.normalize(path.join(DOCS, decodeURIComponent(url.pathname)));
  if (!archivo.startsWith(DOCS)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(archivo) && fs.statSync(archivo).isDirectory()) archivo = path.join(archivo, 'index.html');
  if (!fs.existsSync(archivo)) { res.writeHead(404); res.end('No encontrado'); return; }
  res.writeHead(200, { 'content-type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(archivo).pipe(res);
});

servidor.listen(PUERTO, '0.0.0.0', () => {
  console.log(`\nGlobo RDS local listo:`);
  console.log(`  En esta laptop:  http://localhost:${PUERTO}`);
  for (const red of Object.values(os.networkInterfaces()).flat()) {
    if (red && red.family === 'IPv4' && !red.internal) console.log(`  En tu Wi-Fi:     http://${red.address}:${PUERTO}`);
  }
  console.log('\nCtrl + C para detener.\n');
});
