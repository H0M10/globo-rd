// Utilidades compartidas por la página del globo, la de VR y la de administración.

const CLAVE_IDENTIDAD = 'globo-rds:yo';
let identidadEnMemoria = null; // por si el navegador bloquea localStorage (modo incógnito estricto)

export function leerIdentidad() {
  try {
    const txt = localStorage.getItem(CLAVE_IDENTIDAD);
    if (txt) return JSON.parse(txt);
  } catch { /* sin almacenamiento */ }
  return identidadEnMemoria;
}

export function guardarIdentidad(yo) {
  identidadEnMemoria = yo;
  try { localStorage.setItem(CLAVE_IDENTIDAD, JSON.stringify(yo)); return true; } catch { return false; }
}

export function borrarIdentidad() {
  identidadEnMemoria = null;
  try { localStorage.removeItem(CLAVE_IDENTIDAD); } catch { /* nada */ }
}

// Los nombres los escribe la gente: SIEMPRE escaparlos antes de meterlos en HTML.
export function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Texto negro o blanco según qué tan claro es el color de fondo.
export function textoSobre(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#10131A' : '#FFFFFF';
}

// Oscurece un color (para los costados de los países en 3D).
export function oscurecer(hex, factor = 0.55) {
  const n = parseInt(String(hex).slice(1), 16);
  const c = (v) => Math.round(v * factor).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

let paisesCache = null;
export async function cargarPaises() {
  if (!paisesCache) {
    paisesCache = fetch(new URL('../data/paises.geojson', import.meta.url))
      .then((r) => { if (!r.ok) throw new Error('No se pudo cargar el mapa'); return r.json(); })
      .then((g) => g.features);
  }
  return paisesCache;
}

export const MENSAJES = {
  sin_conexion: 'Sin conexión con el servidor. Reintentando…',
  tiempo_agotado: 'El servidor tardó demasiado. Reintentando…',
  base_no_disponible: 'La base de datos no responde (¿está detenida en AWS?).',
  sin_configurar: 'Falta configurar la URL de la API en js/config.js.',
  nombre_ocupado: 'Ese nombre ya lo usa alguien más.',
  nombre_invalido: 'El nombre debe tener de 2 a 20 letras o números.',
  color_ocupado: 'Alguien acaba de elegir ese color. Escoge otro.',
  color_invalido: 'Ese color no está en la paleta.',
  ocupado: 'Ese país ya tiene dueño.',
  limite: 'Ya llegaste al máximo de países. Libera uno para reclamar otro.',
  juego_cerrado: 'El juego está cerrado por ahora.',
  pais_invalido: 'Ese país no existe en el mapa.',
  jugador_invalido: 'Tu sesión ya no es válida. Vuelve a registrarte.',
  no_es_tuyo: 'Ese país no es tuyo.',
  error_servidor: 'Error del servidor. Intenta de nuevo.',
};

export const mensaje = (codigo) => MENSAJES[codigo] || `Error: ${codigo}`;
