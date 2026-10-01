// Estado del juego compartido por la vista del celular y la de VR.
// Pregunta al servidor cada pocos segundos ("polling") y avisa cuando algo cambia.
import { api } from './api.js';
import { leerIdentidad, guardarIdentidad, borrarIdentidad } from './comun.js';

export function crearJuego(eventos = {}) {
  const intervalo = (window.GLOBO_CONFIG && window.GLOBO_CONFIG.INTERVALO_MS) || 2500;
  const s = {
    version: null,
    max: 5,
    abierto: true,
    jugadores: new Map(),   // id → {id, nombre, color, paises}
    reclamos: new Map(),    // iso → jugador_id
    ultimos: [],
    yo: leerIdentidad(),    // {id, nombre, color, token} o null
    conectado: null,
  };
  let ultimoEvento = null;
  let reloj = null;
  let fallos = 0;
  let iniciado = false;
  let verificandoYo = false;

  const emitir = (nombre, ...args) => { try { eventos[nombre]?.(...args); } catch (e) { console.error(e); } };

  function marcarConexion(ok, error) {
    if (s.conectado !== ok) { s.conectado = ok; emitir('alConexion', ok, error); }
    else if (!ok) emitir('alConexion', ok, error);
  }

  function aplicar(datos) {
    s.version = datos.version;
    s.max = datos.max ?? s.max;
    s.abierto = datos.abierto ?? s.abierto;
    s.jugadores = new Map((datos.jugadores || []).map((j) => [j.id, j]));
    s.reclamos = new Map((datos.reclamos || []).map((r) => [r.iso.trim(), r.j]));
    s.ultimos = datos.ultimos || [];

    const nuevos = ultimoEvento == null ? [] : s.ultimos.filter((e) => e.id > ultimoEvento).reverse();
    if (s.ultimos.length) ultimoEvento = Math.max(ultimoEvento ?? 0, s.ultimos[0].id);
    else if (ultimoEvento == null) ultimoEvento = 0;

    // Si ya no aparezco en la lista (se reinició el juego), lo confirmo con el servidor
    // antes de borrar mi identidad, por si la lista llegó justo antes de registrarme.
    if (s.yo && !s.jugadores.has(s.yo.id)) verificarYo();

    emitir('alCambiar', s);
    for (const e of nuevos) emitir('alEvento', e);
  }

  async function verificarYo() {
    if (!s.yo || verificandoYo) return;
    verificandoYo = true;
    try {
      await api.yo(s.yo.token);
    } catch (e) {
      if (e.codigo === 'jugador_invalido') {
        borrarIdentidad();
        s.yo = null;
        emitir('alPerderIdentidad');
        emitir('alCambiar', s);
      }
    } finally {
      verificandoYo = false;
    }
  }

  async function ciclo() {
    try {
      const datos = await api.estado(s.version);
      fallos = 0;
      marcarConexion(true);
      if (!datos.sinCambios) aplicar(datos);
    } catch (e) {
      fallos++;
      marcarConexion(false, e);
      if (e.codigo === 'sin_configurar') return; // no tiene caso reintentar
    }
    programar();
  }

  function programar(ms) {
    clearTimeout(reloj);
    if (document.hidden) return; // pantalla apagada o en otra pestaña: no gastar batería ni datos
    const espera = ms ?? (fallos ? Math.min(intervalo * 2 ** fallos, 20000) : intervalo);
    reloj = setTimeout(ciclo, espera);
  }

  document.addEventListener('visibilitychange', () => {
    if (!iniciado) return;
    if (document.hidden) clearTimeout(reloj); else programar(0);
  });

  function misPaises() {
    if (!s.yo) return 0;
    let n = 0;
    for (const id of s.reclamos.values()) if (id === s.yo.id) n++;
    return n;
  }

  // Cambio "optimista": se pinta al instante y se corrige si el servidor dice que no.
  async function reclamar(iso) {
    if (!s.yo) return { resultado: 'jugador_invalido' };
    const antes = s.reclamos.get(iso);
    s.reclamos.set(iso, s.yo.id);
    emitir('alCambiar', s);
    const deshacer = () => {
      if (antes === undefined) s.reclamos.delete(iso); else s.reclamos.set(iso, antes);
      emitir('alCambiar', s);
    };
    try {
      const r = await api.reclamar(s.yo.token, iso);
      if (r.resultado !== 'ok') deshacer();
      if (r.resultado === 'jugador_invalido') verificarYo();
      programar(0);
      return r;
    } catch (e) {
      deshacer();
      throw e;
    }
  }

  async function liberar(iso) {
    if (!s.yo) return { resultado: 'jugador_invalido' };
    const antes = s.reclamos.get(iso);
    s.reclamos.delete(iso);
    emitir('alCambiar', s);
    try {
      const r = await api.liberar(s.yo.token, iso);
      if (r.resultado !== 'ok' && antes !== undefined) { s.reclamos.set(iso, antes); emitir('alCambiar', s); }
      programar(0);
      return r;
    } catch (e) {
      if (antes !== undefined) { s.reclamos.set(iso, antes); emitir('alCambiar', s); }
      throw e;
    }
  }

  async function registrar(nombre, color) {
    const yo = await api.registrar(nombre, color);
    s.yo = yo;
    guardarIdentidad(yo);
    programar(0);
    emitir('alCambiar', s);
    return yo;
  }

  function iniciar() {
    if (iniciado) return;
    iniciado = true;
    if (s.yo) verificarYo();
    ciclo();
  }

  return { estado: s, iniciar, reclamar, liberar, registrar, misPaises, refrescar: () => programar(0) };
}
