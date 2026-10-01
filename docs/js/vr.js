// Modo AR / VR con WebXR (three.js + three-globe empaquetados en vendor/xr.js).
//
// AR (Android con Chrome y ARCore)
//   * El globo aparece frente a ti y te SIGUE hasta que el celular termina de ubicarse (rastreo real);
//     entonces se queda fijo. Así ya no «desaparece» por colocarse antes de tiempo.
//   * Su tamaño se calcula para que ocupe ~60 % del ancho de la pantalla.
//   * Tocar país libre = conquistar · tocar país ajeno = barra con «Liberar».
//   * 1 dedo = girar/inclinar (la velocidad depende de qué tan grande se ve el globo) · 2 dedos = tamaño.
//   * «Al frente» lo vuelve a poner delante · «Poner en la mesa» lo coloca sobre una superficie.
//
// VR (gafas tipo Cardboard o Meta Quest) — idealmente con la laptop como control (control.html):
//   * Mira en el centro de la vista. Clic izquierdo (laptop), gatillo o botón de las gafas = actuar
//     sobre el país que marca la mira: libre → conquistar; ajeno → seleccionar y, con otro clic, liberar.
//   * Clic derecho sostenido + mouse = girar · rueda = tamaño · espacio = traer al frente.
//
// Rendimiento: todos los países con la misma altura (cambiar de dueño solo cambia el color, nunca
// reconstruye geometría), solo se repinta si algo cambió y la AR se dibuja a 75 % de resolución.
import { THREE, ThreeGlobe, OrbitControls } from './vendor/xr.js';
import { configurada } from './api.js';
import { crearJuego } from './juego.js';
import { unirseSala } from './enlace.js';
import { cargarPaises, escapar, oscurecer, mensaje, reloj, textoSobre } from './comun.js';

const $ = (id) => document.getElementById(id);
const SALA = new URLSearchParams(location.search).get('sala');
const OCEANO = '#0B1F3A';
const TIERRA = '#2E405E';
const TIERRA_LADO = '#1A2740';
const BORDE = '#5B7090';
const BORDE_DUENO = 'rgba(255,255,255,0.55)';
const BORDE_MIRA = '#F2B347';
const ALTURA = 0.008;            // misma para todos: cambiar de dueño no reconstruye geometría
const RADIO_INICIAL = { vista: 0.3, 'immersive-ar': 0.13, 'immersive-vr': 0.32 }; // metros
const RADIO_MIN = 0.04, RADIO_MAX = 0.8;

let paises = [];
const porIso = new Map();
let seleccion = null;            // país con la barra abierta
let mira = null;                 // país al que apunta el centro de la vista (VR / control de laptop)
let modoXR = null;               // null | 'immersive-ar' | 'immersive-vr'
let radio = RADIO_INICIAL.vista;
let enlace = null;               // conexión con la laptop
let enlaceConectado = false;

const juego = crearJuego({
  alCambiar: () => { pintar(); sincronizarNombres(); actualizarFicha(); actualizarYo(); },
  alEvento: (e) => {
    if (s.yo && e.nombre === s.yo.nombre) return;
    if (e.tipo === 'liberacion' && s.yo && e.victima === s.yo.nombre) { cintillo(`¡<b>${escapar(e.nombre)}</b> liberó tu ${escapar(e.pais)}!`, e.color); vibrar(); }
    else if (e.tipo === 'liberacion' && e.victima) cintillo(`<b>${escapar(e.nombre)}</b> liberó ${escapar(e.pais)} de ${escapar(e.victima)}`, e.color);
    else if (e.tipo === 'reclamo') cintillo(`<b>${escapar(e.nombre)}</b> conquistó ${escapar(e.pais)}`, e.color);
  },
  alConexion: (ok) => {
    $('conexion').dataset.estado = ok ? 'ok' : 'error';
    $('conexion-texto').textContent = ok ? 'En vivo' : 'Sin conexión';
  },
  alFase: (fase, antes) => { if (antes && fase === 'jugando') cintillo('<b>¡Arrancó la ronda!</b>'); },
});
const s = juego.estado;

// ============================== Escena ==============================
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
$('escena').appendChild(renderer.domElement);

const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 200);
escena.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 2.4));
const sol = new THREE.DirectionalLight(0xffffff, 1.2);
sol.position.set(0.6, 2, 1.2);
escena.add(sol);

// ancla (posición y hacia dónde mira) → inclinar (eje X) → girar (eje Y) → globo
const ancla = new THREE.Group();
const inclinar = new THREE.Group();
const girar = new THREE.Group();
ancla.add(inclinar); inclinar.add(girar);
ancla.position.set(0, 1.3, -1.1);
escena.add(ancla);

let globo;
const nombres = new THREE.Group();   // letreros con el nombre del dueño de cada país
const panel = crearPanelVR();        // letrero flotante (solo dentro del visor)
ancla.add(panel.malla);

// Círculo para «Poner en la mesa»
const reticula = new THREE.Mesh(
  new THREE.RingGeometry(0.07, 0.09, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xF2B347 }),
);
reticula.matrixAutoUpdate = false;
reticula.visible = false;
escena.add(reticula);

// Mira del centro (VR): un anillo pequeño siempre delante de los ojos
const miraVR = new THREE.Mesh(
  new THREE.RingGeometry(0.006, 0.0095, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }),
);
miraVR.renderOrder = 999;
miraVR.visible = false;
escena.add(miraVR);

camara.position.set(0, 1.3, 0);
const orbita = new OrbitControls(camara, renderer.domElement);
orbita.target.copy(ancla.position);
orbita.enableDamping = true;
orbita.enablePan = false;
orbita.minDistance = 0.42;
orbita.maxDistance = 2.6;
orbita.autoRotate = true;
orbita.autoRotateSpeed = 0.5;
orbita.addEventListener('start', () => { orbita.autoRotate = false; });

window.addEventListener('resize', () => {
  if (modoXR) return;
  camara.aspect = window.innerWidth / window.innerHeight;
  camara.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================== Inicio ==============================
iniciar().catch((e) => {
  console.error(e);
  $('cargando').innerHTML = '<p>No se pudo cargar el modo AR/VR.<br>Prueba en Chrome (Android).</p>';
});

async function iniciar() {
  paises = await cargarPaises();
  for (const f of paises) porIso.set(f.properties.iso, f);
  await document.fonts?.load('800 48px "Big Shoulders Display"').catch(() => {});

  globo = new ThreeGlobe({ animateIn: false })
    .showAtmosphere(true)
    .atmosphereColor('#7FB4E3')
    .atmosphereAltitude(0.14)
    .polygonsData(paises)
    .polygonCapCurvatureResolution(8)     // menos triángulos: más fluido en el celular
    .polygonAltitude(ALTURA)
    .polygonsTransitionDuration(0);       // dentro de XR el navegador pausa requestAnimationFrame: sin transiciones
  globo.globeMaterial().color.set(OCEANO);
  globo.add(nombres);
  girar.add(globo);
  ponerRadio(RADIO_INICIAL.vista);
  pintar();

  $('cargando').hidden = true;
  actualizarYo();
  conectarUI();
  await detectarSoporte();
  if (configurada) juego.iniciar();
  else cintillo(escapar(mensaje('sin_configurar')));
  setInterval(actualizarCrono, 250);
  if (SALA) conectarLaptop();
  renderer.setAnimationLoop(cuadro);
}

function ponerRadio(r) {
  radio = THREE.MathUtils.clamp(r, RADIO_MIN, RADIO_MAX);
  globo?.scale.setScalar(radio / 100); // three-globe mide 100 unidades de radio
  panel.malla.position.y = radio + 0.14;
}

function duenoDe(iso) {
  const id = s.reclamos.get(iso);
  return id == null ? null : (s.jugadores.get(id) || (s.yo && id === s.yo.id ? s.yo : null));
}
const esMio = (d) => !!(d && s.yo && d.id === s.yo.id);

// Solo vuelve a pintar si de verdad cambió algo (dueños, selección o lo que marca la mira).
let firmaPintada = '';
function pintar() {
  if (!globo) return;
  const firma = `${seleccion}|${mira}|${[...s.reclamos].map(([iso, id]) => iso + id).join()}|${[...s.jugadores.values()].map((j) => j.id + j.color).join()}`;
  if (firma === firmaPintada) return;
  firmaPintada = firma;
  globo
    .polygonCapColor((f) => duenoDe(f.properties.iso)?.color || TIERRA)
    .polygonSideColor((f) => { const d = duenoDe(f.properties.iso); return d ? oscurecer(d.color, 0.6) : TIERRA_LADO; })
    .polygonStrokeColor((f) => {
      const iso = f.properties.iso;
      if (iso === seleccion) return '#FFFFFF';
      if (iso === mira) return BORDE_MIRA;
      return duenoDe(iso) ? BORDE_DUENO : BORDE;
    });
}

// ============================== Nombres sobre el globo (sprites) ==============================
// Van en la capa normal (0): WebXR reserva las capas 1 y 2 para cada ojo. Para que el rayo
// de selección no los toque, su raycast no hace nada.
const texturas = new Map(); // "nombre|color" → {textura, aspecto}
const letreros = new Map(); // iso → sprite
const sinRayo = () => {};

function texturaNombre(nombre, color) {
  const clave = `${nombre}|${color}`;
  if (texturas.has(clave)) return texturas.get(clave);
  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d');
  const fuente = '800 44px "Big Shoulders Display", "Arial Narrow", sans-serif';
  ctx.font = fuente;
  const texto = nombre.toUpperCase();
  const ancho = Math.ceil(ctx.measureText(texto).width) + 54;
  lienzo.width = ancho; lienzo.height = 60;
  ctx.font = fuente;
  ctx.fillStyle = 'rgba(8, 14, 28, 0.82)';
  ctx.beginPath(); ctx.roundRect(0, 6, ancho, 48, 10); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(10, 18, 24, 24, 5); ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, 42, 32);
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  const dato = { textura, aspecto: ancho / 60 };
  texturas.set(clave, dato);
  return dato;
}

function sincronizarNombres() {
  if (!globo) return;
  for (const [iso, sp] of letreros) if (!s.reclamos.has(iso)) { nombres.remove(sp); sp.material.dispose(); letreros.delete(iso); }
  for (const iso of s.reclamos.keys()) {
    const d = duenoDe(iso);
    if (!d) continue;
    const { textura, aspecto } = texturaNombre(d.nombre, d.color);
    let sp = letreros.get(iso);
    if (!sp) {
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textura, depthWrite: false }));
      sp.raycast = sinRayo;
      const p = porIso.get(iso).properties;
      const c = globo.getCoords(p.lat, p.lng, 0.05);
      sp.position.set(c.x, c.y, c.z);
      nombres.add(sp);
      letreros.set(iso, sp);
    } else if (sp.material.map !== textura) {
      sp.material.map = textura;
      sp.material.needsUpdate = true;
    }
    const alto = esMio(d) ? 6.5 : 5.2; // unidades del globo (radio = 100): crecen y encogen con él
    sp.scale.set(alto * aspecto, alto, 1);
  }
}

// ============================== Rayos: ¿a qué país apunto? ==============================
const rayo = new THREE.Raycaster();
const mTmp = new THREE.Matrix4();
const vTmp = new THREE.Vector3();
const vTmp2 = new THREE.Vector3();

function paisEnRayo() {
  if (!globo) return null;
  for (const g of rayo.intersectObject(globo, true)) {
    let obj = g.object;
    while (obj && !obj.__globeObjType) obj = obj.parent;
    if (obj && obj.__globeObjType === 'polygon') {
      const d = obj.__data?.data ?? obj.__data;
      if (d?.properties?.iso) return d.properties.iso;
    }
    if (obj) return null; // pegó primero en el océano
  }
  return null;
}

// Cámara que realmente está viendo (en XR, la del ojo / pantalla del celular)
function camaraActiva() {
  if (!modoXR) return camara;
  const xr = renderer.xr.getCamera();
  return xr.cameras?.length ? xr.cameras[0] : xr;
}

function rayoDesdePantalla(x, y) {
  rayo.setFromCamera(new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1), camaraActiva());
}

function rayoDesdeCentro() {
  const cam = modoXR ? renderer.xr.getCamera() : camara;
  rayo.ray.origin.setFromMatrixPosition(cam.matrixWorld);
  rayo.ray.direction.set(0, 0, -1).transformDirection(cam.matrixWorld);
}

function rayoDesdeControl(control) {
  mTmp.identity().extractRotation(control.matrixWorld);
  rayo.ray.origin.setFromMatrixPosition(control.matrixWorld);
  rayo.ray.direction.set(0, 0, -1).applyMatrix4(mTmp);
}

// Vista normal (sin XR): tocar o hacer clic sin arrastrar.
let inicioToque = null;
renderer.domElement.addEventListener('pointerdown', (e) => { inicioToque = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (modoXR || !inicioToque) return;
  if (Math.hypot(e.clientX - inicioToque[0], e.clientY - inicioToque[1]) > 10) return;
  rayoDesdePantalla(e.clientX, e.clientY);
  const iso = paisEnRayo();
  if (iso) tocarPais(iso); else cerrarFicha();
});

// Controles del visor: Quest (rayo del control) o Cardboard (botón = mira del centro).
const controles = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  c.addEventListener('connected', (e) => {
    c.userData.modo = e.data.targetRayMode;
    if (e.data.targetRayMode === 'tracked-pointer' && !c.userData.linea) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const linea = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xF2B347 }));
      linea.scale.z = 2;
      c.add(linea);
      c.userData.linea = linea;
    }
  });
  c.addEventListener('select', () => {
    if (modoXR !== 'immersive-vr') return; // en AR los toques se leen directo de la pantalla (más confiable)
    if (c.userData.modo === 'tracked-pointer') rayoDesdeControl(c); else rayoDesdeCentro();
    accionVR(paisEnRayo());
  });
  c.addEventListener('squeezestart', () => { c.userData.agarre = { x: posX(c), giro: girar.rotation.y }; });
  c.addEventListener('squeezeend', () => { c.userData.agarre = null; });
  escena.add(c);
  return c;
});
const posX = (c) => vTmp2.setFromMatrixPosition(c.matrixWorld).x;

// ============================== Acciones sobre países ==============================
const sePuede = () => juego.sePuedeReclamar();

// Celular / AR: libre → un toque lo conquista; con dueño → barra con «Liberar» / «Soltar».
function tocarPais(iso) {
  if (!s.yo) { mostrarFicha(iso); cintillo('Primero regístrate en la página principal'); return; }
  if (!duenoDe(iso) && sePuede()) { conquistar(iso); return; }
  mostrarFicha(iso);
}

// VR / laptop: no hay botones en pantalla, así que el segundo clic sobre el mismo país ajeno lo libera.
function accionVR(iso) {
  if (!iso) { cerrarFicha(); return; }
  if (!s.yo) { mostrarFicha(iso); cintillo('Primero regístrate en la página principal'); return; }
  const d = duenoDe(iso);
  if (!d && sePuede()) { conquistar(iso); return; }
  if (d && seleccion === iso && sePuede()) { liberar(iso); return; }
  mostrarFicha(iso);
}

async function conquistar(iso) {
  const nombre = porIso.get(iso).properties.nombre;
  mostrarFicha(iso);
  try {
    const r = await juego.reclamar(iso);
    if (r.resultado === 'ok') { cintillo(`<b>${escapar(nombre)}</b> es tuyo`, s.yo?.color); vibrar(); }
    else if (r.resultado === 'ocupado') cintillo(`Te ganó <b>${escapar(r.dueno)}</b>`, r.color);
    else if (r.resultado !== 'en_camino' && r.resultado !== 'ya_es_tuyo') cintillo(escapar(mensaje(r.resultado)));
  } catch (e) {
    cintillo(escapar(mensaje(e.codigo)));
  }
  actualizarFicha();
}

async function liberar(iso) {
  const nombre = porIso.get(iso).properties.nombre;
  const eraMio = esMio(duenoDe(iso));
  try {
    const r = await juego.liberar(iso);
    if (r.resultado === 'ok') cintillo(eraMio ? `Soltaste <b>${escapar(nombre)}</b>` : `Liberaste <b>${escapar(nombre)}</b>: ¡conquístalo!`, r.color);
    else if (r.resultado === 'protegido') cintillo(`<b>${escapar(nombre)}</b> protegido ${r.espera} s`, r.color);
    else cintillo(escapar(mensaje(r.resultado)));
    vibrar();
  } catch (e) {
    cintillo(escapar(mensaje(e.codigo)));
  }
  actualizarFicha();
}

async function accionFicha() {
  if (!seleccion || !s.yo) return;
  const iso = seleccion;
  $('ficha-accion').disabled = true;
  if (duenoDe(iso)) await liberar(iso); else await conquistar(iso);
}

function vibrar() {
  const sesion = renderer.xr.getSession();
  for (const fuente of sesion?.inputSources || []) fuente.gamepad?.hapticActuators?.[0]?.pulse?.(0.6, 60);
  try { navigator.vibrate?.(25); } catch { /* nada */ }
}

// ============================== Barra del país (una línea) ==============================
function mostrarFicha(iso) {
  seleccion = iso;
  orbita.autoRotate = false;
  pintar();
  actualizarFicha();
}

function cerrarFicha() {
  seleccion = null;
  pintar();
  actualizarFicha();
}

function actualizarFicha() {
  const abierta = !!seleccion && modoXR !== 'immersive-vr';
  $('ficha').hidden = !abierta;
  document.body.classList.toggle('con-ficha', abierta);
  actualizarPanelVR();
  if (!abierta) return;
  const p = porIso.get(seleccion).properties;
  const d = duenoDe(seleccion);
  $('ficha-nombre').textContent = p.nombre;
  $('ficha-dueno').innerHTML = d
    ? `· <span class="muestra-color" style="background:${d.color}"></span><b>${esMio(d) ? 'tuyo' : escapar(d.nombre)}</b>`
    : '· libre';

  const b = $('ficha-accion');
  const prot = juego.proteccionRestante(seleccion);
  b.hidden = !s.yo;
  b.className = 'boton boton-compacto';
  b.style.background = ''; b.style.color = '';
  b.disabled = false;
  if (!s.yo) return;
  if (!sePuede()) { b.textContent = juego.fase() === 'espera' ? 'Aún no' : 'Terminó'; b.disabled = true; }
  else if (esMio(d)) { b.textContent = 'Soltar'; b.classList.add('secundario'); }
  else if (d && prot) { b.textContent = `${prot} s`; b.disabled = true; }
  else if (d) { b.textContent = 'Liberar'; b.classList.add('liberar'); }
  else { b.textContent = 'Conquistar'; b.style.background = s.yo.color; b.style.color = textoSobre(s.yo.color); }
}

let relojCintillo;
function cintillo(html, color) {
  const c = $('cintillo');
  c.innerHTML = `<span class="cintillo-texto">${color ? `<span class="muestra-color" style="background:${color}"></span>` : ''}<span>${html}</span></span>`;
  c.hidden = false;
  clearTimeout(relojCintillo);
  relojCintillo = setTimeout(() => { c.hidden = true; }, 2200);
  panel.aviso = { texto: html.replace(/<[^>]+>/g, ''), color };
  actualizarPanelVR();
}

function actualizarYo() {
  const yo = s.yo;
  $('xr-yo').innerHTML = yo
    ? `<span class="muestra-color" style="background:${yo.color}"></span>Juegas como <b>${escapar(yo.nombre)}</b> · ${juego.misPaises()} países`
    : `Para conquistar, primero <a href="./?volver=${encodeURIComponent('vr.html' + location.search)}">regístrate</a> (luego regresas aquí solo). Por ahora puedes mirar.`;
}

function actualizarCrono() {
  const fase = juego.fase();
  $('xr-crono').dataset.fase = fase;
  $('xr-crono-etiqueta').textContent = { jugando: 'En juego', espera: 'Prepárate', terminada: 'Fin', libre: 'Libre' }[fase] || '';
  $('xr-crono-tiempo').textContent = fase === 'jugando' ? reloj(juego.restante()) : '';
  if (modoXR === 'immersive-vr') actualizarPanelVR();
}

// ============================== Letrero flotante para VR ==============================
function crearPanelVR() {
  const lienzo = document.createElement('canvas');
  lienzo.width = 1024; lienzo.height = 300;
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  const malla = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.146), new THREE.MeshBasicMaterial({ map: textura, transparent: true }));
  malla.raycast = () => {};
  malla.position.set(0, 0.46, 0);
  malla.visible = false;
  return { lienzo, textura, malla, aviso: null, ultimo: '' };
}

function actualizarPanelVR() {
  if (modoXR !== 'immersive-vr') { panel.malla.visible = false; return; }
  const fase = juego.fase();
  const objetivo = seleccion || mira;
  const d = objetivo ? duenoDe(objetivo) : null;
  const firma = [seleccion, mira, d?.id, fase, fase === 'jugando' ? reloj(juego.restante()) : '', panel.aviso?.texto, juego.misPaises(), enlaceConectado].join('|');
  if (firma === panel.ultimo) return;
  panel.ultimo = firma;
  const ctx = panel.lienzo.getContext('2d');
  const { width: w, height: h } = panel.lienzo;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(17, 27, 46, 0.94)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, 28); ctx.fill();
  ctx.strokeStyle = 'rgba(150, 175, 210, 0.35)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.font = '800 38px "Big Shoulders Display", sans-serif';
  ctx.fillStyle = fase === 'jugando' ? '#FF5A4D' : '#A3AEC0';
  ctx.fillText(fase === 'jugando' ? `En juego  ${reloj(juego.restante())}` : fase === 'terminada' ? 'Fin de la ronda' : fase === 'espera' ? 'Prepárate' : 'Modo libre', 30, 38);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#A3AEC0';
  ctx.fillText(`${s.yo ? `${s.yo.nombre} · ${juego.misPaises()}` : 'Sin registro'}${enlaceConectado ? ' · laptop' : ''}`, w - 30, 38);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#EEF1F6';
  if (objetivo) {
    const p = porIso.get(objetivo).properties;
    ctx.font = '900 76px "Big Shoulders Display", sans-serif';
    ctx.fillText(p.nombre, 30, 118);
    ctx.font = '600 36px "Instrument Sans", sans-serif';
    if (d) { ctx.fillStyle = d.color; ctx.beginPath(); ctx.roundRect(30, 168, 28, 28, 6); ctx.fill(); ctx.fillStyle = '#EEF1F6'; }
    ctx.fillText(d ? (esMio(d) ? 'Es tuyo' : d.nombre) : 'Libre', d ? 70 : 30, 183);
    ctx.fillStyle = '#F2B347';
    ctx.font = '600 30px "Instrument Sans", sans-serif';
    const ayuda = !d ? 'Clic = conquistar' : seleccion === objetivo ? (esMio(d) ? 'Clic otra vez = soltar' : 'Clic otra vez = liberar') : 'Clic = seleccionar';
    ctx.fillText(ayuda, 30, 240);
  } else {
    ctx.font = '800 50px "Big Shoulders Display", sans-serif';
    ctx.fillText('Pon la mira sobre un país', 30, 118);
    ctx.font = '500 30px "Instrument Sans", sans-serif';
    ctx.fillStyle = '#A3AEC0';
    ctx.fillText(enlaceConectado ? 'Clic der. sostenido = girar · rueda = tamaño' : 'Mueve la cabeza para apuntar', 30, 178);
  }
  if (panel.aviso) {
    ctx.fillStyle = panel.aviso.color || '#7FB4E3';
    ctx.beginPath(); ctx.roundRect(w - 330, h - 52, 14, 28, 4); ctx.fill();
    ctx.fillStyle = '#EEF1F6';
    ctx.font = '600 26px "Instrument Sans", sans-serif';
    ctx.fillText(panel.aviso.texto.slice(0, 22), w - 306, h - 38);
  }
  panel.textura.needsUpdate = true;
  panel.malla.visible = true;
}

// ============================== Gestos táctiles en AR ==============================
// La capa #ar-gestos recibe los dedos encima de la cámara.
//   1 dedo: girar (izq/der) e inclinar (arriba/abajo). Un toque corto = tocar el país.
//   2 dedos: pellizcar = tamaño.
const gesto = { dedos: new Map(), recorrido: 0, inicio: 0, distInicial: 0, radioInicial: 0, multitoque: false };
let distanciaGlobo = 0.5;        // cámara ↔ globo (se actualiza cada cuadro)
let pxPorRadian = 300;           // qué tan grande se ve el globo en pantalla (para la sensibilidad)

function distanciaDedos() {
  const [a, b] = [...gesto.dedos.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function conectarGestos() {
  const capa = $('ar-gestos');
  capa.addEventListener('pointerdown', (e) => {
    gesto.dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesto.dedos.size === 1) { gesto.recorrido = 0; gesto.inicio = performance.now(); gesto.multitoque = false; }
    if (gesto.dedos.size === 2) { gesto.distInicial = distanciaDedos(); gesto.radioInicial = radio; gesto.multitoque = true; }
  });
  capa.addEventListener('pointermove', (e) => {
    const antes = gesto.dedos.get(e.pointerId);
    if (!antes) return;
    const dx = e.clientX - antes.x, dy = e.clientY - antes.y;
    gesto.dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (colocando) return;
    if (gesto.dedos.size === 1 && !gesto.multitoque) {
      gesto.recorrido += Math.hypot(dx, dy);
      // Arrastrar el ancho del globo ≈ girar media vuelta: se siente como «agarrarlo».
      const k = 1 / Math.max(80, pxPorRadian);
      girar.rotation.y += dx * k * 1.6;
      inclinar.rotation.x = THREE.MathUtils.clamp(inclinar.rotation.x + dy * k * 1.2, -1.2, 1.2);
    } else if (gesto.dedos.size === 2 && gesto.distInicial > 0) {
      ponerRadio(gesto.radioInicial * (distanciaDedos() / gesto.distInicial));
    }
  });
  const soltar = (e) => {
    const fueToque = gesto.dedos.size === 1 && !gesto.multitoque && gesto.recorrido < 12 && performance.now() - gesto.inicio < 450;
    gesto.dedos.delete(e.pointerId);
    if (e.type === 'pointerup' && fueToque) alTocarPantallaAR(e.clientX, e.clientY);
  };
  capa.addEventListener('pointerup', soltar);
  capa.addEventListener('pointercancel', soltar);
}

function alTocarPantallaAR(x, y) {
  if (colocando) { colocarEnReticula(); return; }
  rayoDesdePantalla(x, y);
  const iso = paisEnRayo();
  if (iso) tocarPais(iso); else cerrarFicha();
}

// ============================== Control desde la laptop ==============================
function estadoEnlace(texto, clase) {
  const el = $('xr-enlace');
  el.hidden = false;
  el.textContent = texto;
  el.dataset.estado = clase || '';
}

async function conectarLaptop() {
  estadoEnlace(`Conectando con la laptop (sala ${SALA})…`);
  try {
    enlace = await unirseSala(SALA, {
      alMensaje: alMensajeLaptop,
      alEstado: (e) => {
        enlaceConectado = e === 'conectado';
        if (e === 'conectado') { estadoEnlace('Laptop conectada: ya puedes entrar a VR y ponerte las gafas', 'ok'); cintillo('<b>Laptop conectada</b>'); }
        else if (e === 'fallo') estadoEnlace('No se pudo conectar. Pon la laptop y el celular en la misma red Wi-Fi (o el hotspot del celular) y vuelve a escanear.', 'error');
        else if (e === 'desconectado') estadoEnlace('Se perdió la conexión con la laptop.', 'error');
        actualizarPanelVR();
      },
    });
  } catch (e) {
    estadoEnlace(e.codigo === 'sala_no_existe' ? 'Esa sala ya no existe: genera un QR nuevo en la laptop.' : `No se pudo conectar (${mensaje(e.codigo)}).`, 'error');
  }
}

function alMensajeLaptop(m) {
  if (m.t === 'girar') {
    girar.rotation.y += (m.dx || 0) * 0.005;
    inclinar.rotation.x = THREE.MathUtils.clamp(inclinar.rotation.x + (m.dy || 0) * 0.004, -1.2, 1.2);
    orbita.autoRotate = false;
  } else if (m.t === 'clic') {
    rayoDesdeCentro();
    accionVR(paisEnRayo());
  } else if (m.t === 'zoom') {
    ponerRadio(radio * (m.d > 0 ? 0.9 : 1.1));
  } else if (m.t === 'centrar') {
    if (modoXR) pedirColocacionFrente(); else { girar.rotation.set(0, 0, 0); inclinar.rotation.set(0, 0, 0); }
  }
}

// Cada 250 ms la laptop recibe a qué país apunta la mira y cómo va el juego.
setInterval(() => {
  if (!enlaceConectado || !enlace) return;
  const d = mira ? duenoDe(mira) : null;
  enlace.enviar({
    t: 'estado',
    pais: mira ? porIso.get(mira).properties.nombre : null,
    dueno: d ? (esMio(d) ? 'tuyo' : d.nombre) : null,
    color: d?.color || null,
    seleccionado: !!(mira && mira === seleccion),
    fase: juego.fase(),
    tiempo: juego.fase() === 'jugando' ? reloj(juego.restante()) : '',
    yo: s.yo?.nombre || null,
    paises: juego.misPaises(),
    enVR: modoXR === 'immersive-vr',
  });
}, 250);

// ============================== Sesiones WebXR ==============================
let fuenteHitTest = null;
let colocando = false;
let relojSinSuperficie;
// Colocación delante: el globo sigue la vista hasta que el rastreo es real durante unos cuadros.
const colocacion = { activa: false, cuadrosBuenos: 0, desde: 0 };

async function detectarSoporte() {
  if (!window.isSecureContext) { $('xr-soporte').textContent = 'AR y VR necesitan HTTPS (GitHub Pages ya lo tiene).'; return; }
  const xr = navigator.xr;
  if (!xr) {
    $('xr-soporte').textContent = 'Este navegador no tiene WebXR (por ejemplo Safari en iPhone). Usa la vista 3D: arrastra para girar y toca un país.';
    return;
  }
  const [ar, vr] = await Promise.all([
    xr.isSessionSupported('immersive-ar').catch(() => false),
    xr.isSessionSupported('immersive-vr').catch(() => false),
  ]);
  $('btn-ar').hidden = !ar;
  $('btn-vr').hidden = !vr;
  $('xr-soporte').textContent = ar || vr
    ? (ar ? 'Tu celular soporta realidad aumentada. ' : '') + (vr ? 'También realidad virtual con gafas.' : '')
    : 'Tu dispositivo no tiene AR ni VR. Usa la vista 3D: arrastra para girar y toca un país.';
}

async function entrarXR(modo) {
  try {
    const opciones = modo === 'immersive-ar'
      ? { optionalFeatures: ['hit-test', 'dom-overlay', 'local-floor'], domOverlay: { root: $('ui') } }
      : { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
    const sesion = await navigator.xr.requestSession(modo, opciones);
    renderer.xr.setReferenceSpaceType(modo === 'immersive-ar' ? 'local' : 'local-floor');
    // En el celular, dibujar a 75 % de resolución quita los tirones y casi no se nota.
    renderer.xr.setFramebufferScaleFactor(modo === 'immersive-ar' ? 0.75 : 1);
    await renderer.xr.setSession(sesion);
    modoXR = modo;
    document.body.classList.add('en-xr');
    document.body.dataset.xr = modo;
    orbita.enabled = false;
    sesion.addEventListener('end', salirXR);
    ponerRadio(RADIO_INICIAL[modo]);
    inclinar.rotation.x = modo === 'immersive-ar' ? 0.35 : 0.2;

    if (modo === 'immersive-ar') {
      escena.background = null;
      $('ar-gestos').hidden = false;
      $('ar-controles').hidden = false;
      fuenteHitTest = null;
      // La detección de superficies se prepara en segundo plano; solo se usa con «Poner en la mesa».
      sesion.requestReferenceSpace('viewer')
        .then((vista) => sesion.requestHitTestSource({ space: vista }))
        .then((fuente) => { fuenteHitTest = fuente; })
        .catch(() => { fuenteHitTest = null; });
      indicacion('Ubicando el celular… <b>muévelo un poco</b>');
    } else {
      escena.background = new THREE.Color('#050912');
      miraVR.visible = true;
      actualizarPanelVR();
    }
    pedirColocacionFrente();
    actualizarFicha();
  } catch (e) {
    console.error(e);
    cintillo('No se pudo iniciar AR/VR en este dispositivo.');
  }
}

function pedirColocacionFrente() {
  colocando = false;
  reticula.visible = false;
  colocacion.activa = true;
  colocacion.cuadrosBuenos = 0;
  colocacion.desde = performance.now();
}

// Pone el globo delante de la vista, a la distancia justa para que se vea grande pero completo.
function colocarDelante(pose) {
  const m = mTmp.fromArray(pose.transform.matrix);
  const pos = vTmp.setFromMatrixPosition(m);
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
  dir.y = THREE.MathUtils.clamp(dir.y, -0.55, 0.25);
  dir.normalize();
  let dist;
  if (modoXR === 'immersive-ar') {
    const p = pose.views[0]?.projectionMatrix;
    const mitadFovX = p ? Math.atan(1 / p[0]) : 0.4;          // mitad del ángulo horizontal de la cámara
    dist = THREE.MathUtils.clamp(radio / Math.tan(mitadFovX * 0.62), 0.25, 1.2);
  } else {
    dist = THREE.MathUtils.clamp(radio * 3.2, 0.7, 2.2);
  }
  ancla.position.copy(pos).addScaledVector(dir, dist);
  ancla.rotation.set(0, Math.atan2(pos.x - ancla.position.x, pos.z - ancla.position.z), 0);
}

// Botón «Poner en la mesa»
async function empezarColocacion() {
  if (!fuenteHitTest) {
    try {
      const sesion = renderer.xr.getSession();
      const vista = await sesion.requestReferenceSpace('viewer');
      fuenteHitTest = await sesion.requestHitTestSource({ space: vista });
    } catch { fuenteHitTest = null; }
  }
  if (!fuenteHitTest) { cintillo('Tu celular no detecta superficies: usa «Al frente»'); return; }
  colocacion.activa = false;
  colocando = true;
  indicacion('<b>Apunta a la mesa o al piso</b> y toca cuando aparezca el círculo ámbar');
  clearTimeout(relojSinSuperficie);
  relojSinSuperficie = setTimeout(() => {
    if (!colocando) return;
    colocando = false;
    reticula.visible = false;
    indicacion('No encontré una superficie. Prueba con más luz y moviendo el celular despacio.', 3500);
  }, 15000);
}

function colocarEnReticula() {
  if (!reticula.visible) { indicacion('Todavía no veo la superficie: <b>mueve el celular despacio</b>'); return; }
  ancla.position.setFromMatrixPosition(reticula.matrix);
  ancla.position.y += radio + 0.03; // el globo queda apoyado justo encima de la mesa
  const cam = vTmp.setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
  ancla.rotation.set(0, Math.atan2(cam.x - ancla.position.x, cam.z - ancla.position.z), 0);
  colocando = false;
  reticula.visible = false;
  clearTimeout(relojSinSuperficie);
  indicacion('<b>Listo.</b> Toca un país libre · arrastra para girar · pellizca para el tamaño', 3500);
}

let relojIndicacion;
function indicacion(html, duracion = 0) {
  const el = $('ar-indicacion');
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(relojIndicacion);
  if (duracion) relojIndicacion = setTimeout(() => { el.hidden = true; }, duracion);
}

function salirXR() {
  modoXR = null;
  document.body.classList.remove('en-xr');
  delete document.body.dataset.xr;
  $('ar-gestos').hidden = true;
  $('ar-controles').hidden = true;
  $('ar-indicacion').hidden = true;
  fuenteHitTest = null;
  colocando = false;
  colocacion.activa = false;
  reticula.visible = false;
  miraVR.visible = false;
  escena.background = null;
  ponerRadio(RADIO_INICIAL.vista);
  ancla.position.set(0, 1.3, -1.1);
  ancla.rotation.set(0, 0, 0);
  inclinar.rotation.set(0, 0, 0);
  camara.position.set(0, 1.3, 0);
  orbita.target.copy(ancla.position);
  orbita.enabled = true;
  panel.malla.visible = false;
  actualizarFicha();
}

function conectarUI() {
  $('ficha-cerrar').addEventListener('click', cerrarFicha);
  $('ficha-accion').addEventListener('click', accionFicha);
  $('btn-ar').addEventListener('click', () => entrarXR('immersive-ar'));
  $('btn-vr').addEventListener('click', () => entrarXR('immersive-vr'));
  $('ar-salir').addEventListener('click', () => renderer.xr.getSession()?.end());
  $('ar-colocar').addEventListener('click', empezarColocacion);
  $('ar-frente').addEventListener('click', pedirColocacionFrente);
  // Que tocar botones o la barra no cuente también como un toque XR.
  $('ui').addEventListener('beforexrselect', (e) => {
    if (e.target.closest('button, a, .ficha, .barra')) e.preventDefault();
  });
  conectarGestos();
}

// ============================== Ciclo de dibujo ==============================
const relojCuadro = new THREE.Clock();
let numCuadro = 0;

function cuadro(_t, frame) {
  const dt = Math.min(relojCuadro.getDelta(), 0.1);
  numCuadro++;

  if (modoXR && frame) {
    const espacio = renderer.xr.getReferenceSpace();
    const pose = frame.getViewerPose(espacio);

    // 1) Colocación robusta: seguir la vista hasta tener rastreo real (AR) o el primer cuadro con pose (VR).
    if (pose && colocacion.activa) {
      colocarDelante(pose);
      const rastreoReal = modoXR === 'immersive-vr' || !pose.emulatedPosition;
      colocacion.cuadrosBuenos = rastreoReal ? colocacion.cuadrosBuenos + 1 : 0;
      const listo = colocacion.cuadrosBuenos >= (modoXR === 'immersive-ar' ? 20 : 2);
      if (listo || performance.now() - colocacion.desde > 4000) {
        colocacion.activa = false;
        if (modoXR === 'immersive-ar') indicacion('<b>Toca</b> un país libre · <b>arrastra</b> para girar · <b>pellizca</b> para el tamaño', 4000);
      }
    }

    // 2) «Poner en la mesa»: mostrar el círculo donde hay superficie.
    if (colocando && fuenteHitTest) {
      const resultados = frame.getHitTestResults(fuenteHitTest);
      const p = resultados.length ? resultados[0].getPose(espacio) : null;
      reticula.visible = !!p;
      if (p) reticula.matrix.fromArray(p.transform.matrix);
    }

    // 3) Distancia y tamaño en pantalla (sensibilidad del dedo).
    if (pose) {
      const cam = vTmp.setFromMatrixPosition(mTmp.fromArray(pose.transform.matrix));
      distanciaGlobo = Math.max(0.05, cam.distanceTo(ancla.position));
      const proy = pose.views[0]?.projectionMatrix;
      const focoY = proy ? proy[5] : 1.7;               // 1 / tan(mitad del ángulo vertical)
      pxPorRadian = (radio / distanciaGlobo) * focoY * (window.innerHeight / 2);
    }

    // 4) VR: mira en el centro y giro con controles.
    if (modoXR === 'immersive-vr') {
      const camXR = renderer.xr.getCamera();
      vTmp.setFromMatrixPosition(camXR.matrixWorld);
      vTmp2.set(0, 0, -1).transformDirection(camXR.matrixWorld);
      miraVR.position.copy(vTmp).addScaledVector(vTmp2, 0.6);
      miraVR.lookAt(vTmp);
      for (const c of controles) {
        if (c.userData.agarre) girar.rotation.y = c.userData.agarre.giro + (posX(c) - c.userData.agarre.x) * 6;
      }
      for (const fuente of renderer.xr.getSession()?.inputSources || []) {
        const ejes = fuente.gamepad?.axes;
        if (ejes && ejes.length >= 4) {
          if (Math.abs(ejes[2]) > 0.15) girar.rotation.y += ejes[2] * dt * 1.6;
          if (Math.abs(ejes[3]) > 0.15) inclinar.rotation.x = THREE.MathUtils.clamp(inclinar.rotation.x + ejes[3] * dt * 1.2, -1.2, 1.2);
        }
      }
      if (panel.malla.visible) { camXR.getWorldPosition(vTmp); panel.malla.lookAt(vTmp); }
    }
  } else if (!modoXR) {
    orbita.update();
  }

  // 5) ¿A qué país apunta el centro de la vista? (VR o con la laptop conectada), cada 3 cuadros.
  if ((modoXR === 'immersive-vr' || enlaceConectado) && numCuadro % 3 === 0 && globo) {
    rayoDesdeCentro();
    const iso = paisEnRayo();
    if (iso !== mira) { mira = iso; pintar(); actualizarPanelVR(); }
  }

  renderer.render(escena, camara);
}
