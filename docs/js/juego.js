// Estado del juego compartido por la vista del celular, la del proyector y la de VR.
// Pregunta al servidor cada pocos segundos ("polling") y avisa cuando algo cambia.
import { api } from './api.js';
import { leerIdentidad, guardarIdentidad, borrarIdentidad } from './comun.js';

export function crearJuego(eventos = {}) {
  const base = (window.GLOBO_CONFIG && window.GLOBO_CONFIG.INTERVALO_MS) || 2500;
  const s = {
    version: null,
    max: 0,                 // 0 = sin límite
    abierto: true,
    proteccion: 0,          // segundos que un país recién conquistado no se puede robar (0 = robo libre)
    tiempos: new Map(),     // iso → fecha en que lo conquistó su dueño actual
    ronda: { fase: 'libre', inicio: null, fin: null },
    jugadores: new Map(),   // id → {id, nombre, color, paises, ultimo}
    reclamos: new Map(),    // iso → jugador_id
    ultimos: [],
    yo: leerIdentidad(),    // {id, nombre, color, token} o null
    conectado: null,
    desfase: 0,             // reloj del servidor − reloj del celular (ms)
  };
  let ultimoEvento = null;
  let reloj = null;
  let fallos = 0;
  let iniciado = false;
  let verificandoYo = false;
  let faseAnterior = null;
  const pendientes = new Set();          // países con un reclamo en camino
  const misUltimos = new Map();          // desempate optimista mientras llega el servidor

  const emitir = (nombre, ...args) => { try { eventos[nombre]?.(...args); } catch (e) { console.error(e); } };
  const ahora = () => Date.now() + s.desfase;

  // La fase "real": si el servidor dice jugando pero ya pasó la hora de fin, terminó.
  function fase() {
    const r = s.ronda;
    if (r.fase === 'jugando' && r.fin && ahora() >= Date.parse(r.fin)) return 'terminada';
    return r.fase;
  }
  const restante = () => (s.ronda.fin ? Math.max(0, Date.parse(s.ronda.fin) - ahora()) : 0);
  const sePuedeReclamar = () => s.abierto && (fase() === 'libre' || fase() === 'jugando');
  // Segundos que faltan para poder robar un país (0 = ya se puede).
  function proteccionRestante(iso) {
    if (!s.proteccion || !s.tiempos.get(iso)) return 0;
    return Math.max(0, Math.ceil((Date.parse(s.tiempos.get(iso)) + s.proteccion * 1000 - ahora()) / 1000));
  }

  function marcarConexion(ok, error) {
    if (s.conectado !== ok || !ok) { s.conectado = ok; emitir('alConexion', ok, error); }
  }

  function revisarFase() {
    const f = fase();
    if (f !== faseAnterior) { const antes = faseAnterior; faseAnterior = f; emitir('alFase', f, antes); }
  }

  function aplicar(datos) {
    // Reinicio total (TRUNCATE … RESTART IDENTITY): la versión volvió a empezar y los ids
    // de jugador se reutilizan, así que mi id ya no prueba nada: hay que revisar mi token.
    const huboReinicio = s.version != null && datos.version < s.version;
    if (huboReinicio) ultimoEvento = null;
    s.version = datos.version;
    if (datos.ahora) s.desfase = Date.parse(datos.ahora) - Date.now();
    s.max = datos.max ?? 0;
    s.abierto = datos.abierto ?? true;
    s.proteccion = datos.proteccion ?? 0;
    s.ronda = datos.ronda || { fase: 'libre', inicio: null, fin: null };
    s.jugadores = new Map((datos.jugadores || []).map((j) => [j.id, j]));
    s.reclamos = new Map((datos.reclamos || []).map((r) => [r.iso.trim(), r.j]));
    s.tiempos = new Map((datos.reclamos || []).map((r) => [r.iso.trim(), r.t]));
    for (const iso of pendientes) if (s.yo) s.reclamos.set(iso, s.yo.id); // mis reclamos en camino siguen pintados
    s.ultimos = datos.ultimos || [];
    misUltimos.clear();

    const nuevos = ultimoEvento == null ? [] : s.ultimos.filter((e) => e.id > ultimoEvento).reverse();
    if (s.ultimos.length) ultimoEvento = Math.max(ultimoEvento ?? 0, s.ultimos[0].id);
    else if (ultimoEvento == null) ultimoEvento = 0;

    // Si ya no aparezco (o hubo reinicio), lo confirmo con el servidor antes de borrar mi identidad.
    if (s.yo && (huboReinicio || !s.jugadores.has(s.yo.id))) verificarYo();
    if (huboReinicio) emitir('alEvento', { tipo: 'reinicio' });

    emitir('alCambiar', s);
    for (const e of nuevos) emitir('alEvento', e);
    revisarFase();
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
      if (datos.sinCambios) revisarFase(); else aplicar(datos);
    } catch (e) {
      fallos++;
      marcarConexion(false, e);
      if (e.codigo === 'sin_configurar') return;
    }
    programar();
  }

  function programar(ms) {
    clearTimeout(reloj);
    if (document.hidden) return; // pantalla apagada u otra pestaña: no gastar batería ni datos
    const ritmo = fase() === 'jugando' ? Math.min(base, 1500) : base; // más rápido durante la carrera
    const espera = ms ?? (fallos ? Math.min(ritmo * 2 ** fallos, 20000) : ritmo);
    reloj = setTimeout(ciclo, espera);
  }

  document.addEventListener('visibilitychange', () => {
    if (!iniciado) return;
    if (document.hidden) clearTimeout(reloj); else programar(0);
  });
  // Detectar el fin de la ronda aunque el servidor no mande nada nuevo.
  setInterval(() => { if (iniciado) revisarFase(); }, 500);

  function misPaises() {
    if (!s.yo) return 0;
    let n = 0;
    for (const id of s.reclamos.values()) if (id === s.yo.id) n++;
    return n;
  }

  // Cambio "optimista": se pinta al instante y se corrige si el servidor dice que no.
  async function reclamar(iso) {
    if (!s.yo) return { resultado: 'jugador_invalido' };
    if (pendientes.has(iso)) return { resultado: 'en_camino' };
    const antes = s.reclamos.get(iso);
    const tAntes = s.tiempos.get(iso);
    pendientes.add(iso);
    s.reclamos.set(iso, s.yo.id);
    s.tiempos.set(iso, new Date(ahora()).toISOString());
    misUltimos.set(s.yo.id, new Date(ahora()).toISOString());
    emitir('alCambiar', s);
    const deshacer = () => {
      if (antes === undefined) s.reclamos.delete(iso); else s.reclamos.set(iso, antes);
      if (tAntes === undefined) s.tiempos.delete(iso); else s.tiempos.set(iso, tAntes);
      emitir('alCambiar', s);
    };
    try {
      const r = await api.reclamar(s.yo.token, iso);
      pendientes.delete(iso);
      if (!['ok', 'robado', 'ya_es_tuyo'].includes(r.resultado)) deshacer();
      if (r.resultado === 'jugador_invalido') verificarYo();
      programar(0);
      return r;
    } catch (e) {
      pendientes.delete(iso);
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
      // "ya_libre": otra persona lo liberó primero; de todos modos ya está libre.
      if (!['ok', 'ya_libre'].includes(r.resultado) && antes !== undefined) { s.reclamos.set(iso, antes); emitir('alCambiar', s); }
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

  return {
    estado: s, iniciar, reclamar, liberar, registrar, misPaises,
    fase, restante, sePuedeReclamar, proteccionRestante, ahora, misUltimos,
    refrescar: () => programar(0),
  };
}
