// Página principal: carrera por conquistar el mundo en un globo 3D (celular, compu y ?proyector).
import { api, configurada } from './api.js';
import { crearJuego } from './juego.js';
import { cargarPaises, escapar, textoSobre, oscurecer, mensaje, reloj, ordenarRanking } from './comun.js';

const $ = (id) => document.getElementById(id);
const PROYECTOR = new URLSearchParams(location.search).has('proyector');
const SIN_HOVER = matchMedia('(hover: none)').matches;
const NOMBRE_RE = /^[\p{L}\p{N} ._-]{2,20}$/u;

// Mapa político "en blanco": el color lo ponen los jugadores.
const OCEANO = '#A9BCCB';
const TIERRA = '#F7F8F9';
const TIERRA_LADO = '#C9D2DA';
const BORDE = '#7A8794';
const BORDE_DUENO = '#2E343B';

let globo;
let paises = [];
const porIso = new Map();
let seleccion = null;       // país con la ficha abierta
let destello = null;        // país recién tocado (resalta un instante)
let fueArrastre = () => false;

const juego = crearJuego({
  alCambiar: () => { pintar(); sincronizarEtiquetas(); actualizarTodo(); },
  alEvento: alEvento,
  alConexion: actualizarConexion,
  alFase: alCambiarFase,
  alPerderIdentidad: () => mostrarRegistro('El juego se reinició. Regístrate otra vez.'),
});
const s = juego.estado;

// ============================== Inicio ==============================
iniciar().catch((e) => {
  console.error(e);
  $('cargando').innerHTML = '<p>No se pudo cargar el mapa.<br>Revisa tu conexión y recarga.</p>';
});

async function iniciar() {
  if (PROYECTOR) document.body.classList.add('modo-proyector');
  paises = await cargarPaises();
  for (const f of paises) porIso.set(f.properties.iso, f);
  crearGlobo();
  $('cargando').hidden = true;
  conectarUI();
  setInterval(actualizarCronometro, 250);
  actualizarTodo();

  if (!configurada) {
    actualizarConexion(false, { codigo: 'sin_configurar' });
    cintillo(mensaje('sin_configurar'), null, 0);
    return;
  }
  if (PROYECTOR) iniciarProyector();
  else if (!s.yo) mostrarRegistro();
  juego.iniciar();
}

// ============================== Globo ==============================
function crearGlobo() {
  const contenedor = $('globo');
  globo = Globe({ animateIn: false, rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' } })(contenedor)
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(false)
    .showGraticules(true)
    .polygonsData(paises)
    .polygonsTransitionDuration(180)
    .polygonLabel(SIN_HOVER ? () => '' : etiquetaHover)
    .onPolygonClick((f) => { if (!fueArrastre()) tocarPais(f.properties.iso); })
    .onGlobeClick(() => { if (!fueArrastre()) cerrarFicha(); });

  globo.globeMaterial().color.set(OCEANO);
  globo.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // que el celular no se caliente

  const controles = globo.controls();
  controles.autoRotate = true;
  controles.autoRotateSpeed = PROYECTOR ? 0.5 : 0.3;
  controles.enableDamping = true;
  controles.dampingFactor = 0.12;
  controles.minDistance = 130;
  controles.maxDistance = 520;
  controles.zoomSpeed = 0.8;
  let reanudar;
  controles.addEventListener('start', () => { controles.autoRotate = false; clearTimeout(reanudar); });
  controles.addEventListener('end', () => {
    clearTimeout(reanudar);
    reanudar = setTimeout(() => { controles.autoRotate = PROYECTOR || !seleccion; }, PROYECTOR ? 4000 : 9000);
  });
  globo.pointOfView({ lat: 18, lng: -60, altitude: PROYECTOR ? 2.2 : 2.5 });

  const ajustar = () => globo.width(contenedor.clientWidth).height(contenedor.clientHeight);
  new ResizeObserver(ajustar).observe(contenedor);
  ajustar();

  // Un toque solo cuenta si el dedo casi no se movió: girar el globo nunca conquista nada.
  let inicio = null, movido = 0;
  contenedor.addEventListener('pointerdown', (e) => { inicio = [e.clientX, e.clientY]; movido = 0; }, { capture: true });
  contenedor.addEventListener('pointermove', (e) => {
    if (inicio) movido = Math.max(movido, Math.hypot(e.clientX - inicio[0], e.clientY - inicio[1]));
  }, { capture: true });
  fueArrastre = () => movido > 10;

  pintar();
  requestAnimationFrame(moverEtiquetas);
}

function duenoDe(iso) {
  const id = s.reclamos.get(iso);
  if (id == null) return null;
  return s.jugadores.get(id) || (s.yo && id === s.yo.id ? s.yo : null);
}
const esMio = (d) => !!(d && s.yo && d.id === s.yo.id);

function pintar() {
  if (!globo) return;
  globo
    .polygonCapColor((f) => duenoDe(f.properties.iso)?.color || TIERRA)
    .polygonSideColor((f) => { const d = duenoDe(f.properties.iso); return d ? oscurecer(d.color, 0.6) : TIERRA_LADO; })
    .polygonStrokeColor((f) => {
      const iso = f.properties.iso;
      if (iso === seleccion || iso === destello) return '#111316';
      return duenoDe(iso) ? BORDE_DUENO : BORDE;
    })
    .polygonAltitude((f) => {
      const iso = f.properties.iso;
      const d = duenoDe(iso);
      let a = d ? (esMio(d) ? 0.02 : 0.012) : 0.004;
      if (iso === seleccion || iso === destello) a += 0.016;
      return a;
    });
}

function etiquetaHover(f) {
  const d = duenoDe(f.properties.iso);
  return `<div class="etiqueta-hover"><b>${escapar(f.properties.nombre)}</b> · ${d ? escapar(d.nombre) : 'libre'}</div>`;
}

// ============================== Nombres sobre el globo ==============================
// Una etiqueta HTML por país conquistado. Cada cuadro se proyecta a la pantalla;
// se ocultan las que quedan detrás del globo o se enciman con otra más importante.
const etiquetas = new Map(); // iso → {el, ancho}
let ordenEtiquetas = [];

function sincronizarEtiquetas() {
  const capa = $('etiquetas');
  for (const [iso, e] of etiquetas) if (!s.reclamos.has(iso)) { e.el.remove(); etiquetas.delete(iso); }
  for (const iso of s.reclamos.keys()) {
    const d = duenoDe(iso);
    if (!d) continue;
    let e = etiquetas.get(iso);
    if (!e) { e = { el: document.createElement('div'), ancho: 0 }; e.el.className = 'etq'; e.el.hidden = true; capa.appendChild(e.el); etiquetas.set(iso, e); }
    const firma = `${d.id}|${d.nombre}|${d.color}`;
    if (e.firma !== firma) {
      e.firma = firma;
      e.el.innerHTML = `<b style="background-color:${d.color}"></b>${escapar(d.nombre)}`;
      e.ancho = d.nombre.length * (PROYECTOR ? 8.4 : 7.4) + 18;
    }
    e.el.classList.toggle('mia', esMio(d));
  }
  // Prioridad: los míos primero, luego los países más grandes.
  ordenEtiquetas = [...etiquetas.keys()].sort((a, b) => {
    const ma = esMio(duenoDe(a)), mb = esMio(duenoDe(b));
    if (ma !== mb) return ma ? -1 : 1;
    return porIso.get(b).properties.area - porIso.get(a).properties.area;
  });
}

function moverEtiquetas() {
  requestAnimationFrame(moverEtiquetas);
  if (!globo || !etiquetas.size || document.hidden) return;
  const cam = globo.camera().position;
  const dist = Math.hypot(cam.x, cam.y, cam.z);
  const horizonte = globo.getGlobeRadius() / dist;
  const capa = $('etiquetas');
  const anchoCapa = capa.clientWidth, altoCapa = capa.clientHeight;
  const ocupadas = [];
  for (const iso of ordenEtiquetas) {
    const e = etiquetas.get(iso);
    const p = porIso.get(iso).properties;
    const c = globo.getCoords(p.lat, p.lng, 0.03);
    const coseno = (c.x * cam.x + c.y * cam.y + c.z * cam.z) / (Math.hypot(c.x, c.y, c.z) * dist);
    let visible = coseno > horizonte + 0.06; // del lado que mira la cámara
    if (visible) {
      const sc = globo.getScreenCoords(p.lat, p.lng, 0.03);
      const x = Math.round(sc.x), y = Math.round(sc.y);
      const caja = [x - e.ancho / 2, y - 9, x + e.ancho / 2, y + 9];
      if (caja[0] < 2 || caja[2] > anchoCapa - 2 || caja[1] < 2 || caja[3] > altoCapa - 2) visible = false;
      else if (ocupadas.some((o) => caja[0] < o[2] && caja[2] > o[0] && caja[1] < o[3] && caja[3] > o[1])) visible = false;
      else {
        ocupadas.push(caja);
        const t = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
        if (e.t !== t) { e.el.style.transform = t; e.t = t; }
      }
    }
    if (e.el.hidden === visible) e.el.hidden = !visible;
  }
}

// ============================== Tocar un país ==============================
function tocarPais(iso) {
  if (PROYECTOR) return;
  if (!s.yo) { mostrarRegistro(); return; }
  const d = duenoDe(iso);
  if (esMio(d) || !juego.sePuedeReclamar() || juego.proteccionRestante(iso) > 0) { abrirFicha(iso); return; }
  conquistar(iso); // libre o de otro: un solo toque lo conquista (o lo roba)
}

async function conquistar(iso) {
  const nombre = porIso.get(iso).properties.nombre;
  marcarDestello(iso);
  try {
    const r = await juego.reclamar(iso);
    if (r.resultado === 'ok') { cintillo(`<b>${escapar(nombre)}</b> es tuyo`, s.yo?.color); vibrar(20); }
    else if (r.resultado === 'robado') { cintillo(`Le quitaste <b>${escapar(nombre)}</b> a ${escapar(r.dueno)}`, s.yo?.color); vibrar([20, 40, 20]); }
    else if (r.resultado === 'protegido') cintillo(`<b>${escapar(nombre)}</b> protegido ${r.espera} s`, r.color);
    else if (r.resultado !== 'en_camino' && r.resultado !== 'ya_es_tuyo') cintillo(escapar(mensaje(r.resultado)));
  } catch (e) {
    cintillo(escapar(mensaje(e.codigo)));
  }
  if (seleccion === iso) actualizarFicha();
}

function marcarDestello(iso) {
  destello = iso;
  pintar();
  setTimeout(() => { if (destello === iso) { destello = null; pintar(); } }, 450);
}

function vibrar(patron) { try { navigator.vibrate?.(patron); } catch { /* nada */ } }

// ============================== Ficha del país ==============================
function abrirFicha(iso, volar = false) {
  seleccion = iso;
  globo.controls().autoRotate = false;
  if (volar) {
    const p = porIso.get(iso).properties;
    globo.pointOfView({ lat: p.lat, lng: p.lng, altitude: 1.6 }, 900);
  }
  pintar();
  actualizarFicha();
}

function cerrarFicha() {
  if (!seleccion) return;
  seleccion = null;
  pintar();
  actualizarFicha();
}

function actualizarFicha() {
  const abierta = !!seleccion;
  $('ficha').hidden = !abierta;
  document.body.classList.toggle('con-ficha', abierta);
  if (!abierta) return;
  const p = porIso.get(seleccion).properties;
  const d = duenoDe(seleccion);
  const prot = juego.proteccionRestante(seleccion);
  $('ficha-continente').textContent = p.continente;
  $('ficha-nombre').textContent = p.nombre;
  $('ficha-dueno').innerHTML = d
    ? `<span class="muestra-color" style="background:${d.color}"></span>${esMio(d) ? '<b>Es tuyo</b>' : `De <b>${escapar(d.nombre)}</b>`}${prot ? ` · protegido ${prot} s` : ''}`
    : 'Libre: nadie lo ha conquistado';

  const b = $('ficha-accion');
  b.hidden = false;
  b.className = 'boton';
  b.style.background = ''; b.style.color = '';
  b.disabled = false;
  const fase = juego.fase();
  if (!s.yo) { b.textContent = 'Regístrate para jugar'; return; }
  if (esMio(d)) { b.textContent = `Liberar ${p.nombre}`; b.classList.add('secundario'); return; }
  if (!juego.sePuedeReclamar()) {
    b.textContent = fase === 'espera' ? 'La ronda no ha empezado' : fase === 'terminada' ? 'La ronda terminó' : 'Juego cerrado';
    b.disabled = true; return;
  }
  if (prot) { b.textContent = `Protegido ${prot} s`; b.disabled = true; return; }
  b.textContent = d ? `Robárselo a ${d.nombre}` : `Conquistar ${p.nombre}`;
  b.style.background = s.yo.color;
  b.style.color = textoSobre(s.yo.color);
}

async function accionFicha() {
  if (!seleccion) return;
  if (!s.yo) { mostrarRegistro(); return; }
  const iso = seleccion;
  const d = duenoDe(iso);
  if (esMio(d)) {
    try {
      const r = await juego.liberar(iso);
      cintillo(r.resultado === 'ok' ? `Liberaste <b>${escapar(porIso.get(iso).properties.nombre)}</b>` : escapar(mensaje(r.resultado)), s.yo?.color);
    } catch (e) { cintillo(escapar(mensaje(e.codigo))); }
    actualizarFicha();
    return;
  }
  await conquistar(iso);
}

// ============================== Cronómetro y fases ==============================
function lider() {
  const r = ordenarRanking(s.jugadores, s.reclamos, juego.misUltimos);
  return r.length && r[0].paises > 0 ? r[0] : null;
}

function actualizarCronometro() {
  const fase = juego.fase();
  const r = s.ronda;
  let etiqueta, tiempo, detalle, progreso = 0;
  const l = lider();
  const textoLider = l ? `Va ganando ${l.nombre} con ${l.paises}` : 'Nadie ha conquistado nada aún';
  if (fase === 'jugando') {
    const total = Date.parse(r.fin) - Date.parse(r.inicio);
    const falta = juego.restante();
    etiqueta = 'En juego'; tiempo = reloj(falta); detalle = textoLider;
    progreso = total > 0 ? 1 - falta / total : 0;
  } else if (fase === 'espera') {
    etiqueta = 'Prepárate'; tiempo = '--:--'; detalle = 'La ronda está por empezar';
  } else if (fase === 'terminada') {
    etiqueta = 'Fin de la ronda'; tiempo = '00:00'; detalle = l ? `Ganó ${l.nombre} con ${l.paises} países` : 'Nadie conquistó países';
    progreso = 1;
  } else {
    etiqueta = 'Modo libre'; tiempo = 'Sin tiempo'; detalle = `${textoLider} · se vale robar`;
  }
  const urgente = fase === 'jugando' && juego.restante() <= 10000;
  for (const [cont, et, ti] of [[$('cronometro'), $('crono-etiqueta'), $('crono-tiempo')], [$('proy-crono'), $('proy-etiqueta'), $('proy-tiempo')]]) {
    if (cont.dataset.fase !== fase) cont.dataset.fase = fase;
    if (et.textContent !== etiqueta) et.textContent = etiqueta;
    if (ti.textContent !== tiempo) ti.textContent = tiempo;
    cont.toggleAttribute('data-urgente', urgente);
  }
  if ($('crono-detalle').textContent !== detalle) $('crono-detalle').textContent = detalle;
  $('crono-progreso').style.width = `${Math.round(progreso * 1000) / 10}%`;
  if (seleccion && s.proteccion) actualizarFicha();
}

function alCambiarFase(fase, antes) {
  if (antes == null) return; // primera carga
  if (fase === 'jugando') { $('resultado').hidden = true; cintillo('<b>¡Arrancó la ronda!</b> Conquista todo lo que puedas', null, 2600); vibrar([40, 60, 40]); }
  if (fase === 'espera') cintillo('<b>Prepárate</b>: la ronda está por empezar', null, 2600);
  if (fase === 'terminada' && antes === 'jugando') mostrarResultado();
  actualizarFicha();
}

function mostrarResultado() {
  const ranking = ordenarRanking(s.jugadores, s.reclamos);
  const g = ranking[0];
  $('resultado-ganador').textContent = g && g.paises ? g.nombre : 'Sin ganador';
  $('resultado-ganador').style.color = g && g.paises ? g.color : '#fff';
  const mio = s.yo ? ranking.findIndex((j) => j.id === s.yo.id) : -1;
  $('resultado-dato').textContent = g && g.paises
    ? `${g.paises} países${mio >= 0 ? ` · tú quedaste en ${mio + 1}.º lugar` : ''}`
    : 'Nadie conquistó países en esta ronda.';
  $('resultado-podio').innerHTML = filasTabla(ranking.slice(0, 5));
  $('resultado').hidden = false;
  vibrar([60, 80, 60, 80, 120]);
}

// ============================== Marcador ==============================
function filasTabla(filas) {
  if (!filas.length) return '<li class="vacia">Todavía no hay jugadores.</li>';
  const maximo = Math.max(1, ...filas.map((j) => j.paises));
  return filas.map((j, i) => `
    <li${s.yo && j.id === s.yo.id ? ' class="soy-yo"' : ''}>
      <span class="lugar">${j.lugar ?? i + 1}</span>
      <span class="muestra-color" style="background:${j.color}"></span>
      <span class="nombre">${escapar(j.nombre)}${s.yo && j.id === s.yo.id ? '<span class="yo-marca">tú</span>' : ''}</span>
      <span class="barra-val"><span style="width:${(j.paises / maximo) * 100}%;background:${j.color}"></span></span>
      <span class="num">${j.paises}</span>
    </li>`).join('');
}

function actualizarMarcador() {
  const ranking = ordenarRanking(s.jugadores, s.reclamos, juego.misUltimos).map((j, i) => ({ ...j, lugar: i + 1 }));
  $('marcador-lista').innerHTML = filasTabla(ranking);
  $('marcador-resumen').textContent = `${ranking.length} jugadores · ${s.reclamos.size}/${paises.length} países`;
  const yo = s.yo ? ranking.find((j) => j.id === s.yo.id) : null;
  const eYo = $('marcador-yo');
  eYo.hidden = !yo;
  if (yo) eYo.innerHTML = `<span class="muestra-color" style="background:${yo.color}"></span>Tú vas <b>${yo.lugar}.º</b> con <b>${yo.paises}</b> ${yo.paises === 1 ? 'país' : 'países'}`;
  if (PROYECTOR) {
    $('proy-ranking').innerHTML = filasTabla(ranking.slice(0, 10));
    $('proy-eventos').innerHTML = s.ultimos.filter((e) => ['reclamo', 'robo', 'registro'].includes(e.tipo)).slice(0, 8).map(textoEvento).map((t) => `<li>${t}</li>`).join('');
  }
}

function textoEvento(e) {
  const quien = `<span class="muestra-color" style="background:${e.color}"></span><b>${escapar(e.nombre)}</b>`;
  if (e.tipo === 'robo') return `${quien} le quitó ${escapar(e.pais)} a ${escapar(e.victima)}`;
  if (e.tipo === 'reclamo') return `${quien} conquistó ${escapar(e.pais)}`;
  if (e.tipo === 'registro') return `${quien} entró al juego`;
  return '';
}

function actualizarTodo() {
  actualizarMarcador();
  actualizarFicha();
  if (!$('panel-buscar').hidden) buscar();
}

// ============================== Avisos (cintillo) ==============================
let relojCintillo;
function cintillo(html, color, duracion = 2200) {
  const c = $('cintillo');
  c.innerHTML = `<span class="cintillo-texto">${color ? `<span class="muestra-color" style="background:${color}"></span>` : ''}<span>${html}</span></span>`;
  c.hidden = false;
  clearTimeout(relojCintillo);
  if (duracion) relojCintillo = setTimeout(() => { c.hidden = true; }, duracion);
}

function alEvento(e) {
  if (s.yo && e.nombre === s.yo.nombre) return; // lo mío ya lo avisé al instante
  if (e.tipo === 'robo' && s.yo && e.victima === s.yo.nombre) {
    cintillo(`¡<b>${escapar(e.nombre)}</b> te quitó ${escapar(e.pais)}!`, e.color, 2600);
    vibrar([80, 50, 80]);
  } else if (e.tipo === 'robo' || e.tipo === 'reclamo' || e.tipo === 'registro') {
    cintillo(textoEvento(e).replace(/^<span[^>]*><\/span>/, ''), e.color, 1800);
  } else if (e.tipo === 'reinicio') {
    cintillo('<b>El juego se reinició</b>', null, 2600);
  }
}

function actualizarConexion(ok, error) {
  const el = $('conexion');
  el.dataset.estado = ok ? 'ok' : 'error';
  $('conexion-texto').textContent = ok ? 'En vivo' : (error?.codigo === 'sin_configurar' ? 'Sin API' : 'Sin conexión');
  el.title = ok ? 'Conectado a Amazon RDS' : mensaje(error?.codigo);
}

// ============================== Interfaz ==============================
function conectarUI() {
  $('ficha-cerrar').addEventListener('click', cerrarFicha);
  $('ficha-accion').addEventListener('click', accionFicha);
  $('resultado-cerrar').addEventListener('click', () => { $('resultado').hidden = true; });
  $('marcador-alternar').addEventListener('click', () => {
    const m = $('marcador');
    const abierto = !m.classList.contains('abierto');
    m.classList.toggle('abierto', abierto);
    $('marcador-alternar').setAttribute('aria-expanded', String(abierto));
  });
  $('btn-buscar').addEventListener('click', () => {
    const p = $('panel-buscar');
    p.hidden = !p.hidden;
    $('btn-buscar').setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden) { buscar(); setTimeout(() => $('buscar-input').focus(), 50); }
  });
  for (const b of document.querySelectorAll('[data-cerrar]')) {
    b.addEventListener('click', () => { $(b.dataset.cerrar).hidden = true; $('btn-buscar').setAttribute('aria-expanded', 'false'); });
  }
  $('buscar-input').addEventListener('input', buscar);
  $('buscar-resultados').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-iso]');
    if (!b) return;
    $('panel-buscar').hidden = true;
    $('btn-buscar').setAttribute('aria-expanded', 'false');
    $('buscar-input').blur();
    abrirFicha(b.dataset.iso, true);
  });
}

const sinAcentos = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function buscar() {
  const q = sinAcentos($('buscar-input').value.trim());
  const lista = paises.filter((f) => !q || sinAcentos(f.properties.nombre).includes(q)).slice(0, 40);
  $('buscar-resultados').innerHTML = lista.map((f) => {
    const d = duenoDe(f.properties.iso);
    const marca = d ? `<span class="muestra-color" style="background:${d.color}"></span><span>${escapar(d.nombre)}</span>` : '<span>Libre</span>';
    return `<li><button type="button" data-iso="${f.properties.iso}"><span>${escapar(f.properties.nombre)}</span><span class="derecha">${marca}</span></button></li>`;
  }).join('') || '<li class="vacia">Sin resultados</li>';
}

// ============================== Registro ==============================
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
}

function ocultarRegistro() {
  $('registro').hidden = true;
  clearInterval(relojColores);
}

async function cargarColores() {
  try {
    const { colores } = await api.colores();
    $('reg-libres').textContent = `· ${colores.filter((c) => c.libre).length} libres`;
    if (colorElegido && !colores.find((c) => c.hex === colorElegido)?.libre) colorElegido = null;
    const firma = colores.map((c) => c.hex + c.libre).join() + colorElegido;
    if (firma === ultimaPaleta) return; // nada cambió: no redibujar (no se pierde el toque)
    ultimaPaleta = firma;
    $('reg-colores').innerHTML = colores.map((c) => `
      <label class="color${c.libre ? '' : ' tomado'}" title="${escapar(c.nombre)}${c.libre ? '' : ' (ocupado)'}">
        <input type="radio" name="color" value="${c.hex}" ${c.libre ? '' : 'disabled'} ${c.hex === colorElegido ? 'checked' : ''}>
        <span class="cuadro" style="background:${c.hex}"></span>
        <span class="nombre-color">${escapar(c.nombre)}</span>
      </label>`).join('');
  } catch (e) {
    mostrarErrorRegistro(mensaje(e.codigo));
  }
}

function mostrarErrorRegistro(texto) {
  $('reg-error').textContent = texto || '';
  $('reg-error').hidden = !texto;
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
    cintillo(`Bienvenido, <b>${escapar(yo.nombre)}</b>. Toca un país para conquistarlo`, yo.color, 3200);
  } catch (err) {
    mostrarErrorRegistro(mensaje(err.codigo));
    if (err.codigo === 'color_ocupado') { colorElegido = null; ultimaPaleta = ''; cargarColores(); }
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar al juego';
  }
}

// ============================== Proyector ==============================
function iniciarProyector() {
  $('proyector').hidden = false;
  const url = new URL(location.href);
  url.searchParams.delete('proyector');
  $('qr-url').textContent = url.href.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (window.qrcode) {
    const qr = window.qrcode(0, 'M');
    qr.addData(url.href);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag(5, 0);
  }
  const pedirPantalla = () => navigator.wakeLock?.request('screen').catch(() => {});
  pedirPantalla();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pedirPantalla(); });
}
