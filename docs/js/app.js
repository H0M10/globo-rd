// Página principal: globo 3D táctil para celular (y modo proyector con ?proyector).
import { api, configurada } from './api.js';
import { crearJuego } from './juego.js';
import { cargarPaises, escapar, textoSobre, oscurecer, mensaje } from './comun.js';

const $ = (id) => document.getElementById(id);
const PROYECTOR = new URLSearchParams(location.search).has('proyector');
const SIN_HOVER = matchMedia('(hover: none)').matches;

const COLOR_OCEANO = '#0B1F3A';
const COLOR_TIERRA = '#2E405E';
const COLOR_BORDE = '#5B7090';

let globo;
let paises = [];
const porIso = new Map();
let seleccion = null;     // iso seleccionado
let ocupado = false;      // hay una petición de reclamar/liberar en curso
const NOMBRE_RE = /^[\p{L}\p{N} ._-]{2,20}$/u;

const juego = crearJuego({
  alCambiar: () => { pintar(); actualizarUI(); },
  alEvento: avisarEvento,
  alConexion: actualizarConexion,
  alPerderIdentidad: () => mostrarRegistro('El juego se reinició. Regístrate otra vez.'),
});
const s = juego.estado;

// ---------- Inicio ----------
iniciar().catch((e) => {
  console.error(e);
  $('cargando').innerHTML = `<p>No se pudo cargar el mapa. Revisa tu conexión y recarga la página.</p>`;
});

async function iniciar() {
  if (PROYECTOR) document.body.classList.add('modo-proyector');
  paises = await cargarPaises();
  for (const f of paises) porIso.set(f.properties.iso, f);
  crearGlobo();
  $('cargando').hidden = true;
  conectarUI();

  if (!configurada) {
    actualizarConexion(false, { codigo: 'sin_configurar' });
    aviso(mensaje('sin_configurar'), { fijo: true });
    return;
  }

  if (PROYECTOR) iniciarProyector();
  else if (!s.yo) mostrarRegistro();

  juego.iniciar();
  actualizarUI();
}

// ---------- Globo 3D ----------
function crearGlobo() {
  const contenedor = $('globo');
  globo = Globe({ animateIn: false, rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' } })(contenedor)
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(true)
    .atmosphereColor('#7FB4E3')
    .atmosphereAltitude(0.16)
    .polygonsData(paises)
    .polygonsTransitionDuration(300)
    .onPolygonClick((f) => { if (!fueArrastre()) seleccionar(f.properties.iso); })
    .onGlobeClick(() => { if (!fueArrastre()) deseleccionar(); })
    .polygonLabel(SIN_HOVER ? () => '' : etiqueta);

  globo.globeMaterial().color.set(COLOR_OCEANO);
  // Celulares con pantallas de alta densidad: limitar resolución para que no se caliente ni se trabe.
  globo.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const controles = globo.controls();
  controles.autoRotate = true;
  controles.autoRotateSpeed = PROYECTOR ? 0.6 : 0.35;
  controles.enableDamping = true;
  controles.dampingFactor = 0.12;
  controles.minDistance = 140;
  controles.maxDistance = 520;
  controles.zoomSpeed = 0.8;
  // Al tocar el globo se detiene el giro automático; vuelve tras 8 s sin tocar.
  let reanudar;
  controles.addEventListener('start', () => { controles.autoRotate = false; clearTimeout(reanudar); });
  controles.addEventListener('end', () => { clearTimeout(reanudar); reanudar = setTimeout(() => { controles.autoRotate = !seleccion || PROYECTOR; }, 8000); });

  globo.pointOfView({ lat: 20, lng: -95, altitude: PROYECTOR ? 2.3 : 2.6 });

  // Tamaño: se ajusta al cambiar orientación o al aparecer/desaparecer la barra del navegador.
  const ajustar = () => globo.width(contenedor.clientWidth).height(contenedor.clientHeight);
  new ResizeObserver(ajustar).observe(contenedor);
  ajustar();

  // Distinguir un "toque" de un "arrastre" (para no reclamar países por accidente al girar).
  let inicio = null, movido = 0;
  contenedor.addEventListener('pointerdown', (e) => { inicio = [e.clientX, e.clientY]; movido = 0; }, { capture: true });
  contenedor.addEventListener('pointermove', (e) => {
    if (inicio) movido = Math.max(movido, Math.hypot(e.clientX - inicio[0], e.clientY - inicio[1]));
  }, { capture: true });
  fueArrastre = () => movido > 10;

  pintar();
}
let fueArrastre = () => false;

function duenoDe(iso) {
  const id = s.reclamos.get(iso);
  return id == null ? null : (s.jugadores.get(id) || (s.yo && id === s.yo.id ? s.yo : null));
}

function pintar() {
  if (!globo) return;
  globo
    .polygonCapColor((f) => duenoDe(f.properties.iso)?.color || COLOR_TIERRA)
    .polygonSideColor((f) => { const d = duenoDe(f.properties.iso); return d ? oscurecer(d.color) : '#1A2740'; })
    .polygonStrokeColor((f) => (f.properties.iso === seleccion ? '#FFFFFF' : COLOR_BORDE))
    .polygonAltitude((f) => {
      const iso = f.properties.iso;
      const d = duenoDe(iso);
      let a = d ? (s.yo && d.id === s.yo.id ? 0.035 : 0.022) : 0.006;
      if (iso === seleccion) a += 0.025;
      return a;
    });
}

function etiqueta(f) {
  const d = duenoDe(f.properties.iso);
  return `<div class="etiqueta"><b>${escapar(f.properties.nombre)}</b><br>${d ? `de ${escapar(d.nombre)}` : 'Libre'}</div>`;
}

function seleccionar(iso, volar = false) {
  seleccion = iso;
  globo.controls().autoRotate = false;
  if (volar) {
    const p = porIso.get(iso).properties;
    globo.pointOfView({ lat: p.lat, lng: p.lng, altitude: 1.7 }, 900);
  }
  pintar();
  actualizarHoja();
}

function deseleccionar() {
  if (!seleccion) return;
  seleccion = null;
  pintar();
  actualizarHoja();
}

// ---------- Interfaz ----------
function conectarUI() {
  $('hoja-cerrar').addEventListener('click', deseleccionar);
  $('hoja-accion').addEventListener('click', accionPrincipal);

  for (const btn of document.querySelectorAll('[data-cerrar]')) {
    btn.addEventListener('click', () => alternarPanel(btn.dataset.cerrar, false));
  }
  $('btn-ranking').addEventListener('click', () => alternarPanel('panel-ranking'));
  $('btn-buscar').addEventListener('click', () => {
    const abierto = alternarPanel('panel-buscar');
    if (abierto) setTimeout(() => $('buscar-input').focus(), 50);
  });
  $('buscar-input').addEventListener('input', buscar);
  $('buscar-resultados').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-iso]');
    if (!b) return;
    alternarPanel('panel-buscar', false);
    $('buscar-input').blur();
    seleccionar(b.dataset.iso, true);
  });
  buscar();
}

function alternarPanel(id, forzar) {
  const panel = $(id);
  const abrir = forzar ?? panel.hidden;
  for (const otro of ['panel-ranking', 'panel-buscar']) {
    $(otro).hidden = otro === id ? !abrir : true;
    document.querySelector(`[aria-controls="${otro}"]`)?.setAttribute('aria-expanded', String(otro === id && abrir));
  }
  if (abrir && id === 'panel-ranking') actualizarRanking();
  return abrir;
}

function quitarAcentos(t) { return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

function buscar() {
  const q = quitarAcentos($('buscar-input').value.trim());
  const lista = paises.filter((f) => !q || quitarAcentos(f.properties.nombre).includes(q)).slice(0, 30);
  $('buscar-resultados').innerHTML = lista.map((f) => {
    const d = duenoDe(f.properties.iso);
    const marca = d ? `<span class="punto" style="background:${d.color}"></span>${escapar(d.nombre)}` : '<span class="nota">Libre</span>';
    return `<li><button type="button" data-iso="${f.properties.iso}"><span>${escapar(f.properties.nombre)}</span><span class="derecha">${marca}</span></button></li>`;
  }).join('') || '<li class="nota">Sin resultados</li>';
}

function actualizarUI() {
  if (s.yo) {
    $('yo-chip').hidden = false;
    $('yo-punto').style.background = s.yo.color;
    $('yo-nombre').textContent = s.yo.nombre;
    $('yo-cuenta').textContent = `${juego.misPaises()}/${s.max}`;
  } else {
    $('yo-chip').hidden = true;
  }
  actualizarHoja();
  if (!$('panel-ranking').hidden) actualizarRanking();
  if (!$('panel-buscar').hidden) buscar();
  if (PROYECTOR) actualizarProyector();
}

function actualizarHoja() {
  const hayPais = !!seleccion;
  $('hoja-vacia').hidden = hayPais;
  $('hoja-pais').hidden = !hayPais;
  document.body.classList.toggle('con-seleccion', hayPais);
  if (!hayPais) return;

  const p = porIso.get(seleccion).properties;
  const d = duenoDe(seleccion);
  const mio = d && s.yo && d.id === s.yo.id;
  $('hoja-continente').textContent = p.continente;
  $('hoja-nombre').textContent = p.nombre;
  $('hoja-dueno').innerHTML = d
    ? `<span class="punto" style="background:${d.color}"></span>${mio ? 'Es tuyo' : `De <b>${escapar(d.nombre)}</b>`}`
    : 'Libre: nadie lo ha reclamado.';

  const boton = $('hoja-accion');
  boton.classList.toggle('secundario', !!mio);
  boton.style.background = ''; boton.style.color = '';
  if (!s.yo) { boton.textContent = 'Regístrate para reclamar'; boton.disabled = false; return; }
  if (!s.abierto) { boton.textContent = 'El juego está cerrado'; boton.disabled = true; return; }
  if (mio) { boton.textContent = `Liberar ${p.nombre}`; boton.disabled = ocupado; return; }
  if (d) { boton.textContent = 'Ya tiene dueño'; boton.disabled = true; return; }
  if (juego.misPaises() >= s.max) { boton.textContent = `Ya tienes ${s.max} países · libera uno`; boton.disabled = true; return; }
  boton.textContent = ocupado ? 'Reclamando…' : `Reclamar ${p.nombre}`;
  boton.disabled = ocupado;
  boton.style.background = s.yo.color;
  boton.style.color = textoSobre(s.yo.color);
}

async function accionPrincipal() {
  if (!seleccion || ocupado) return;
  if (!s.yo) { mostrarRegistro(); return; }
  const iso = seleccion;
  const nombrePais = porIso.get(iso).properties.nombre;
  const d = duenoDe(iso);
  const mio = d && d.id === s.yo.id;
  ocupado = true;
  actualizarHoja();
  try {
    const r = mio ? await juego.liberar(iso) : await juego.reclamar(iso);
    if (r.resultado === 'ok') {
      aviso(mio ? `Liberaste ${nombrePais}` : `¡${nombrePais} ahora es tuyo!`, { color: s.yo?.color });
      if (navigator.vibrate) navigator.vibrate(30);
    } else if (r.resultado === 'ocupado') {
      aviso(`Te ganó ${r.dueno}: ${nombrePais} ya es suyo.`, { color: r.color });
    } else {
      aviso(mensaje(r.resultado));
    }
  } catch (e) {
    aviso(mensaje(e.codigo));
  } finally {
    ocupado = false;
    actualizarHoja();
  }
}

function filasRanking() {
  const jugadores = [...s.jugadores.values()].map((j) => {
    let n = 0;
    for (const id of s.reclamos.values()) if (id === j.id) n++;
    return { ...j, paises: n };
  });
  return jugadores.sort((a, b) => b.paises - a.paises || a.nombre.localeCompare(b.nombre, 'es'));
}

function htmlRanking(filas) {
  return filas.map((j) => `<li${s.yo && j.id === s.yo.id ? ' class="soy-yo"' : ''}>
    <span class="punto" style="background:${j.color}"></span>
    <span class="ranking-nombre">${escapar(j.nombre)}</span>
    <span class="mono">${j.paises}</span></li>`).join('') || '<li class="nota">Todavía no hay jugadores.</li>';
}

function actualizarRanking() {
  const filas = filasRanking();
  $('ranking-resumen').textContent = `${filas.length} jugadores · ${s.reclamos.size} de ${paises.length} países reclamados · máximo ${s.max} por persona`;
  $('ranking-lista').innerHTML = htmlRanking(filas);
}

// ---------- Registro ----------
let relojColores = null;
let colorElegido = null;
let ultimaPaleta = '';

function mostrarRegistro(texto) {
  if (PROYECTOR) return;
  $('registro').hidden = false;
  if (texto) $('registro-intro').textContent = texto;
  cargarColores();
  clearInterval(relojColores);
  relojColores = setInterval(cargarColores, 4000); // ver en vivo qué colores van ganando otros
  const form = $('form-registro');
  if (!form.dataset.listo) {
    form.dataset.listo = '1';
    form.addEventListener('submit', enviarRegistro);
    $('reg-colores').addEventListener('change', (e) => { colorElegido = e.target.value; });
  }
  setTimeout(() => $('reg-nombre').focus(), 100);
}

function ocultarRegistro() {
  $('registro').hidden = true;
  clearInterval(relojColores);
}

async function cargarColores() {
  try {
    const { colores } = await api.colores();
    const libres = colores.filter((c) => c.libre).length;
    $('reg-libres').textContent = `(${libres} libres)`;
    if (colorElegido && !colores.find((c) => c.hex === colorElegido)?.libre) colorElegido = null;
    const firma = colores.map((c) => c.hex + c.libre).join() + colorElegido;
    if (firma === ultimaPaleta) return; // nada cambió: no redibujar (evita perder un toque)
    ultimaPaleta = firma;
    $('reg-colores').innerHTML = colores.map((c) => `
      <label class="color${c.libre ? '' : ' tomado'}" title="${escapar(c.nombre)}${c.libre ? '' : ' (ocupado)'}">
        <input type="radio" name="color" value="${c.hex}" ${c.libre ? '' : 'disabled'} ${c.hex === colorElegido ? 'checked' : ''}>
        <span class="muestra" style="background:${c.hex}"></span>
        <span class="color-nombre">${escapar(c.nombre)}</span>
      </label>`).join('');
  } catch (e) {
    $('reg-libres').textContent = '';
    mostrarErrorRegistro(mensaje(e.codigo));
  }
}

function mostrarErrorRegistro(texto) {
  const el = $('reg-error');
  el.textContent = texto || '';
  el.hidden = !texto;
}

async function enviarRegistro(e) {
  e.preventDefault();
  const nombre = $('reg-nombre').value.trim().replace(/\s+/g, ' ');
  if (!NOMBRE_RE.test(nombre)) { mostrarErrorRegistro(mensaje('nombre_invalido')); $('reg-nombre').focus(); return; }
  if (!colorElegido) { mostrarErrorRegistro('Elige un color.'); return; }
  const boton = $('reg-enviar');
  boton.disabled = true;
  boton.textContent = 'Entrando…';
  mostrarErrorRegistro('');
  try {
    const yo = await juego.registrar(nombre, colorElegido);
    ocultarRegistro();
    aviso(`¡Bienvenido, ${yo.nombre}! Toca un país para reclamarlo.`, { color: yo.color });
  } catch (err) {
    mostrarErrorRegistro(mensaje(err.codigo));
    if (err.codigo === 'color_ocupado') { colorElegido = null; cargarColores(); }
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar al juego';
  }
}

// ---------- Avisos y conexión ----------
function aviso(texto, { color, fijo = false } = {}) {
  const el = document.createElement('div');
  el.className = 'aviso';
  el.innerHTML = `${color ? `<span class="punto" style="background:${color}"></span>` : ''}<span>${escapar(texto)}</span>`;
  const cont = $('avisos');
  cont.prepend(el);
  while (cont.children.length > 3) cont.lastChild.remove();
  if (!fijo) setTimeout(() => el.remove(), 3800);
}

function avisarEvento(e) {
  if (s.yo && e.nombre === s.yo.nombre) return; // lo mío ya lo avisé
  if (e.tipo === 'reclamo') aviso(`${e.nombre} reclamó ${e.pais}`, { color: e.color });
  else if (e.tipo === 'registro') aviso(`${e.nombre} entró al juego`, { color: e.color });
  else if (e.tipo === 'liberacion') aviso(`${e.nombre} liberó ${e.pais}`, { color: e.color });
  else if (e.tipo === 'reinicio') aviso('El juego se reinició');
}

function actualizarConexion(ok, error) {
  const el = $('conexion');
  el.dataset.estado = ok ? 'ok' : 'error';
  $('conexion-texto').textContent = ok ? 'En vivo' : (error ? mensaje(error.codigo) : 'Sin conexión');
}

// ---------- Modo proyector (?proyector) ----------
function iniciarProyector() {
  $('proyector').hidden = false;
  const url = new URL(location.href);
  url.searchParams.delete('proyector');
  $('qr-url').textContent = url.href.replace(/^https?:\/\//, '');
  if (window.qrcode) {
    const qr = window.qrcode(0, 'M');
    qr.addData(url.href);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag(6, 2);
  }
  // Que la pantalla no se apague durante la exposición.
  const pedirPantalla = () => navigator.wakeLock?.request('screen').catch(() => {});
  pedirPantalla();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pedirPantalla(); });
}

function actualizarProyector() {
  $('proyector-ranking').innerHTML = htmlRanking(filasRanking().slice(0, 10));
  $('proyector-eventos').innerHTML = s.ultimos.filter((e) => e.tipo !== 'config').slice(0, 6).map((e) => {
    const texto = e.tipo === 'reclamo' ? `reclamó <b>${escapar(e.pais)}</b>`
      : e.tipo === 'liberacion' ? `liberó ${escapar(e.pais)}`
      : e.tipo === 'registro' ? 'entró al juego' : 'Juego reiniciado';
    return `<li>${e.color ? `<span class="punto" style="background:${e.color}"></span>` : ''}${e.nombre ? escapar(e.nombre) + ' ' : ''}${texto}</li>`;
  }).join('');
}
