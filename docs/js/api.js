// Cliente de la API. Todas las peticiones son "simples" para el navegador
// (GET normal o POST con Content-Type text/plain), así se evita la petición
// previa de CORS (preflight) y hay menos cosas que puedan fallar en el celular.

function resolverBase() {
  const params = new URLSearchParams(location.search);
  const desdeUrl = params.get('api');
  if (desdeUrl) {
    try { localStorage.setItem('globo-rds:api', desdeUrl); } catch { /* nada */ }
    return desdeUrl.replace(/\/+$/, '');
  }
  // Servidor local de pruebas (npm run local): la API vive en /api del mismo sitio.
  if (location.port === '8787') return `${location.origin}/api`;
  try {
    const guardada = localStorage.getItem('globo-rds:api');
    if (guardada) return guardada.replace(/\/+$/, '');
  } catch { /* nada */ }
  const conf = (window.GLOBO_CONFIG && window.GLOBO_CONFIG.API_URL) || '';
  return conf.replace(/\/+$/, '');
}

export const BASE = resolverBase();
export const configurada = /^https?:\/\//.test(BASE);

class ErrorApi extends Error {
  constructor(codigo, status = 0, datos = {}) { super(codigo); this.codigo = codigo; this.status = status; this.datos = datos; }
}

async function pedir(ruta, { cuerpo, timeout = 9000 } = {}) {
  if (!configurada) throw new ErrorApi('sin_configurar');
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeout);
  try {
    const res = await fetch(BASE + ruta, {
      method: cuerpo ? 'POST' : 'GET',
      headers: cuerpo ? { 'content-type': 'text/plain;charset=UTF-8' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      cache: 'no-store',
      signal: control.signal,
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw new ErrorApi(datos.error || `http_${res.status}`, res.status, datos);
    return datos;
  } catch (e) {
    if (e instanceof ErrorApi) throw e;
    if (e.name === 'AbortError') throw new ErrorApi('tiempo_agotado');
    throw new ErrorApi('sin_conexion');
  } finally {
    clearTimeout(reloj);
  }
}

export const api = {
  salud: () => pedir('/salud'),
  estado: (version) => pedir(version == null ? '/estado' : `/estado?v=${version}`),
  colores: () => pedir('/colores'),
  registrar: (nombre, color) => pedir('/jugadores', { cuerpo: { nombre, color } }),
  yo: (token) => pedir('/yo', { cuerpo: { token } }),
  reclamar: (token, iso) => pedir('/reclamar', { cuerpo: { token, iso } }),
  liberar: (token, iso) => pedir('/liberar', { cuerpo: { token, iso } }),
  admin: (clave, accion, extra = {}) => pedir('/admin', { cuerpo: { clave, accion, ...extra } }),
  salaCrear: (oferta) => pedir('/salas', { cuerpo: { oferta } }),
  salaLeer: (codigo) => pedir(`/salas?codigo=${encodeURIComponent(codigo)}`),
  salaResponder: (codigo, respuesta) => pedir('/salas/respuesta', { cuerpo: { codigo, respuesta } }),
};
