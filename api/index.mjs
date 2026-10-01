// API del Globo RDS · AWS Lambda (Node.js 20+) publicada con una "URL de función".
// La página (GitHub Pages) no puede hablar con PostgreSQL directamente: habla con esta API,
// y la API habla con RDS. La contraseña de la base vive aquí (variables de entorno), nunca en GitHub.
import fs from 'node:fs';
import pg from 'pg';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^[A-Z]{3}$/;
const COLOR_RE = /^#[0-9A-F]{6}$/;
const NOMBRE_RE = /^[\p{L}\p{N} ._-]{2,20}$/u;

// La conexión se crea una vez por contenedor de Lambda y se reutiliza entre invocaciones.
let pool;
function obtenerPool() {
  if (pool) return pool;
  const ca = new URL('./global-bundle.pem', import.meta.url);
  const ssl = fs.existsSync(ca)
    ? { ca: fs.readFileSync(ca, 'utf8') }   // verifica que el servidor sea realmente RDS
    : { rejectUnauthorized: false };        // cifra, pero sin verificar el certificado
  pool = new pg.Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'escuela',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl,
    max: Number(process.env.PG_POOL_MAX || 2),   // Lambda atiende 1 petición por contenedor; el servidor local usa más
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (e) => console.error('pool', e.message));
  return pool;
}

function origenPermitido(origin) {
  const lista = (process.env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
  if (lista.includes('*')) return '*';
  return lista.includes(origin) ? origin : lista[0];
}

function responder(status, cuerpo, origin) {
  return {
    statusCode: status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origenPermitido(origin),
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
      'cache-control': 'no-store',
      vary: 'Origin',
    },
    body: status === 204 ? '' : JSON.stringify(cuerpo),
  };
}

function leerCuerpo(event) {
  if (!event.body) return {};
  const texto = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try { return JSON.parse(texto) ?? {}; } catch { return null; }
}

const tokenValido = (t) => typeof t === 'string' && UUID_RE.test(t);

export async function handler(event) {
  const metodo = event.requestContext?.http?.method || 'GET';
  const ruta = (event.rawPath || '/').replace(/\/+$/, '') || '/';
  const origin = event.headers?.origin || '';
  const ok = (cuerpo, status = 200) => responder(status, cuerpo, origin);
  const falla = (status, error, extra = {}) => responder(status, { error, ...extra }, origin);

  if (metodo === 'OPTIONS') return ok({}, 204);

  const cuerpo = metodo === 'POST' ? leerCuerpo(event) : {};
  if (cuerpo === null) return falla(400, 'json_invalido');

  try {
    const db = obtenerPool();

    // GET /  → prueba rápida de que la API y la base responden
    if (metodo === 'GET' && (ruta === '/' || ruta === '/salud')) {
      const { rows } = await db.query('SELECT now() AS hora, version_juego() AS version');
      return ok({ ok: true, servicio: 'globo-rds', hora: rows[0].hora, version: Number(rows[0].version) });
    }

    // GET /estado?v=N → si la versión no cambió responde casi vacío (ahorra datos en el celular)
    if (metodo === 'GET' && ruta === '/estado') {
      const v = event.queryStringParameters?.v;
      const version = v != null && /^\d+$/.test(v) ? v : null;
      const { rows } = await db.query(
        `SELECT version_juego() AS v,
                CASE WHEN version_juego() = $1::bigint THEN NULL ELSE estado_juego() END AS e`,
        [version],
      );
      const actual = Number(rows[0].v);
      if (!rows[0].e) return ok({ version: actual, sinCambios: true });
      return ok({ ...rows[0].e, version: actual });
    }

    // GET /colores → paleta con los colores libres
    if (metodo === 'GET' && ruta === '/colores') {
      const { rows } = await db.query('SELECT hex, nombre, libre FROM colores_disponibles()');
      return ok({ colores: rows });
    }

    // POST /jugadores {nombre, color} → crea al jugador y devuelve su token secreto
    if (metodo === 'POST' && ruta === '/jugadores') {
      const nombre = String(cuerpo.nombre ?? '').trim().replace(/\s+/g, ' ');
      const color = String(cuerpo.color ?? '').trim().toUpperCase();
      if (!NOMBRE_RE.test(nombre)) return falla(400, 'nombre_invalido');
      if (!COLOR_RE.test(color)) return falla(400, 'color_invalido');
      try {
        const { rows } = await db.query('SELECT * FROM registrar_jugador($1, $2)', [nombre, color]);
        const j = rows[0];
        return ok({ id: j.jugador_id, nombre: j.jugador_nombre, color: j.jugador_color, token: j.jugador_token }, 201);
      } catch (e) {
        if (e.code === '23505' && e.constraint === 'jugadores_nombre_uq') return falla(409, 'nombre_ocupado');
        if (e.code === '23505' && e.constraint === 'jugadores_color_uq') return falla(409, 'color_ocupado');
        if (e.code === '23503') return falla(400, 'color_invalido');
        if (e.code === '23514') return falla(400, 'nombre_invalido');
        throw e;
      }
    }

    // POST /yo {token} → ¿este celular sigue siendo un jugador válido?
    if (metodo === 'POST' && ruta === '/yo') {
      if (!tokenValido(cuerpo.token)) return falla(404, 'jugador_invalido');
      const { rows } = await db.query('SELECT * FROM jugador_por_token($1)', [cuerpo.token]);
      if (!rows.length) return falla(404, 'jugador_invalido');
      return ok({ id: rows[0].jugador_id, nombre: rows[0].jugador_nombre, color: rows[0].jugador_color });
    }

    // POST /reclamar {token, iso}
    if (metodo === 'POST' && ruta === '/reclamar') {
      const iso = String(cuerpo.iso ?? '').toUpperCase();
      if (!tokenValido(cuerpo.token)) return falla(401, 'jugador_invalido');
      if (!ISO_RE.test(iso)) return falla(400, 'pais_invalido');
      const { rows } = await db.query('SELECT * FROM reclamar_pais($1, $2)', [cuerpo.token, iso]);
      const r = rows[0] || { resultado: 'pais_invalido' };
      // resultado: ok | robado (dueno = a quién se lo quitaste) | ya_es_tuyo | protegido (espera = segundos) | …
      return ok({ resultado: r.resultado, dueno: r.dueno, color: r.dueno_color, espera: r.espera ?? null });
    }

    // POST /liberar {token, iso}
    if (metodo === 'POST' && ruta === '/liberar') {
      const iso = String(cuerpo.iso ?? '').toUpperCase();
      if (!tokenValido(cuerpo.token)) return falla(401, 'jugador_invalido');
      if (!ISO_RE.test(iso)) return falla(400, 'pais_invalido');
      const { rows } = await db.query('SELECT liberar_pais($1, $2) AS resultado', [cuerpo.token, iso]);
      return ok({ resultado: rows[0].resultado });
    }

    // POST /admin {clave, accion: "reiniciar" | "config" | "ronda", max?, abierto?, ronda?, minutos?}
    if (metodo === 'POST' && ruta === '/admin') {
      const clave = process.env.ADMIN_KEY || '';
      if (clave.length < 8 || cuerpo.clave !== clave) return falla(403, 'clave_incorrecta');
      if (cuerpo.accion === 'entrar') return ok({ resultado: 'ok' }); // solo valida la clave (inicio de sesión)
      if (cuerpo.accion === 'ronda') {
        if (!['iniciar', 'preparar', 'terminar', 'libre'].includes(cuerpo.ronda)) return falla(400, 'accion_invalida');
        const minutos = Number.isInteger(cuerpo.minutos) ? cuerpo.minutos : null;
        const { rows } = await db.query('SELECT controlar_ronda($1, $2) AS resultado', [cuerpo.ronda, minutos]);
        return ok({ resultado: rows[0].resultado });
      }
      if (cuerpo.accion === 'reiniciar') {
        await db.query('SELECT reiniciar_juego()');
        return ok({ resultado: 'ok' });
      }
      if (cuerpo.accion === 'config') {
        const max = Number.isInteger(cuerpo.max) ? cuerpo.max : null;
        const abierto = typeof cuerpo.abierto === 'boolean' ? cuerpo.abierto : null;
        if (max !== null || abierto !== null) await db.query('SELECT configurar_juego($1, $2)', [max, abierto]);
        if (Number.isInteger(cuerpo.proteccion)) await db.query('SELECT configurar_proteccion($1)', [cuerpo.proteccion]);
        return ok({ resultado: 'ok' });
      }
      return falla(400, 'accion_invalida');
    }

    return falla(404, 'ruta_no_encontrada');
  } catch (e) {
    console.error('error', e.code, e.message);
    if (['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', '28P01', '3D000'].includes(e.code) || /timeout/i.test(e.message)) {
      return falla(503, 'base_no_disponible');
    }
    return falla(500, 'error_servidor');
  }
}
