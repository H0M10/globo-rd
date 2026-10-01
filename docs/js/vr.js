// Modo AR / VR con WebXR (three.js + three-globe).
//   * Android con Chrome y ARCore: el globo se coloca sobre una mesa o el piso (detección de superficies);
//     tocar = conquistar/robar, arrastrar = girar e inclinar, pellizcar = cambiar tamaño.
//   * Meta Quest: realidad virtual; gatillo = conquistar/robar, agarre o palanca = girar.
//   * iPhone y computadoras sin visor: vista 3D normal con los mismos gestos.
import * as THREE from 'three';
import ThreeGlobe from 'three-globe';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { configurada } from './api.js';
import { crearJuego } from './juego.js';
import { cargarPaises, escapar, oscurecer, mensaje, reloj } from './comun.js';

const $ = (id) => document.getElementById(id);
const OCEANO = '#A9BCCB';
const TIERRA = '#F7F8F9';
const TIERRA_LADO = '#C9D2DA';
const BORDE = '#7A8794';
const BORDE_DUENO = '#2E343B';
const ESCALA_VR = 0.003;                  // three-globe mide 100 unidades de radio → 30 cm
const ESCALA_AR = 0.0016;                 // → 16 cm, cabe sobre una mesa
const ESCALA_AR_MIN = 0.0007, ESCALA_AR_MAX = 0.006;

let paises = [];
const porIso = new Map();
let seleccion = null;
let modoXR = null;            // null | 'immersive-ar' | 'immersive-vr'

const juego = crearJuego({
  alCambiar: () => { pintar(); sincronizarNombres(); actualizarFicha(); actualizarYo(); },
  alEvento: (e) => {
    if (s.yo && e.nombre === s.yo.nombre) return;
    if (e.tipo === 'robo' && s.yo && e.victima === s.yo.nombre) { cintillo(`¡<b>${escapar(e.nombre)}</b> te quitó ${escapar(e.pais)}!`, e.color); vibrar(); }
    else if (e.tipo === 'robo') cintillo(`<b>${escapar(e.nombre)}</b> le quitó ${escapar(e.pais)} a ${escapar(e.victima)}`, e.color);
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
escena.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 2.2));
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

// Retícula para elegir dónde colocar el globo en AR
const reticula = new THREE.Mesh(
  new THREE.RingGeometry(0.05, 0.065, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
);
reticula.matrixAutoUpdate = false;
reticula.visible = false;
escena.add(reticula);

// Los letreros viven en la capa 3: la cámara (y las de cada ojo en XR) la dibujan,
// pero el rayo de selección solo revisa la capa 0. (WebXR usa las capas 1 y 2 para cada ojo.)
const CAPA_NOMBRES = 3;
camara.layers.enable(CAPA_NOMBRES);

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
  $('cargando').innerHTML = '<p>No se pudo cargar el modo AR/VR.<br>Prueba en Chrome (Android) o en el navegador del Meta Quest.</p>';
});

async function iniciar() {
  paises = await cargarPaises();
  for (const f of paises) porIso.set(f.properties.iso, f);
  await document.fonts?.load('800 48px "Big Shoulders Display"').catch(() => {});

  globo = new ThreeGlobe({ animateIn: false })
    .showAtmosphere(false)
    .showGraticules(true)
    .polygonsData(paises)
    .polygonsTransitionDuration(0); // dentro de XR el navegador pausa requestAnimationFrame: sin animaciones de transición
  globo.globeMaterial().color.set(OCEANO);
  globo.scale.setScalar(ESCALA_VR);
  globo.add(nombres);
  girar.add(globo);
  pintar();

  $('cargando').hidden = true;
  actualizarYo();
  conectarUI();
  await detectarSoporte();
  if (configurada) juego.iniciar();
  else cintillo(escapar(mensaje('sin_configurar')));
  setInterval(actualizarCrono, 250);
  renderer.setAnimationLoop(cuadro);
}

function duenoDe(iso) {
  const id = s.reclamos.get(iso);
  return id == null ? null : (s.jugadores.get(id) || (s.yo && id === s.yo.id ? s.yo : null));
}
const esMio = (d) => !!(d && s.yo && d.id === s.yo.id);

function pintar() {
  if (!globo) return;
  globo
    .polygonCapColor((f) => duenoDe(f.properties.iso)?.color || TIERRA)
    .polygonSideColor((f) => { const d = duenoDe(f.properties.iso); return d ? oscurecer(d.color, 0.6) : TIERRA_LADO; })
    .polygonStrokeColor((f) => (f.properties.iso === seleccion ? '#111316' : duenoDe(f.properties.iso) ? BORDE_DUENO : BORDE))
    .polygonAltitude((f) => {
      const d = duenoDe(f.properties.iso);
      return (d ? (esMio(d) ? 0.02 : 0.012) : 0.004) + (f.properties.iso === seleccion ? 0.02 : 0);
    });
}

// ============================== Nombres sobre el globo (sprites) ==============================
const texturas = new Map(); // "nombre|color" → {textura, aspecto}
const letreros = new Map(); // iso → sprite

function texturaNombre(nombre, color) {
  const clave = `${nombre}|${color}`;
  if (texturas.has(clave)) return texturas.get(clave);
  const lienzo = document.createElement('canvas');
  const ctx = lienzo.getContext('2d');
  const fuente = '800 44px "Big Shoulders Display", "Arial Narrow", sans-serif';
  ctx.font = fuente;
  const texto = nombre.toUpperCase();
  const ancho = Math.ceil(ctx.measureText(texto).width) + 52;
  lienzo.width = ancho; lienzo.height = 60;
  ctx.font = fuente;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, 6, ancho, 48);
  ctx.fillStyle = color;
  ctx.fillRect(8, 18, 24, 24);
  ctx.fillStyle = '#111316';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, 40, 32);
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
      sp.layers.set(CAPA_NOMBRES); // el rayo de selección (capa 0) no los toca
      const p = porIso.get(iso).properties;
      const c = globo.getCoords(p.lat, p.lng, 0.06);
      sp.position.set(c.x, c.y, c.z);
      nombres.add(sp);
      letreros.set(iso, sp);
    } else if (sp.material.map !== textura) {
      sp.material.map = textura;
      sp.material.needsUpdate = true;
    }
    const alto = esMio(d) ? 6.5 : 5.2; // en unidades del globo (radio = 100)
    sp.scale.set(alto * aspecto, alto, 1);
  }
}

// ============================== Elegir países con un rayo ==============================
const rayo = new THREE.Raycaster();
const matrizTmp = new THREE.Matrix4();

function paisEnRayo() {
  const golpes = rayo.intersectObject(globo, true);
  for (const g of golpes) {
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

function rayoDesdeControl(control) {
  matrizTmp.identity().extractRotation(control.matrixWorld);
  rayo.ray.origin.setFromMatrixPosition(control.matrixWorld);
  rayo.ray.direction.set(0, 0, -1).applyMatrix4(matrizTmp);
}

// Vista normal (sin XR): tocar sin arrastrar elige el país.
let inicioToque = null;
renderer.domElement.addEventListener('pointerdown', (e) => { inicioToque = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (modoXR || !inicioToque) return;
  if (Math.hypot(e.clientX - inicioToque[0], e.clientY - inicioToque[1]) > 10) return;
  const r = renderer.domElement.getBoundingClientRect();
  rayo.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camara);
  const iso = paisEnRayo();
  if (iso) tocarPais(iso); else cerrarFicha();
});

// Controles del Quest y toques de pantalla dentro de AR.
const controles = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  c.addEventListener('connected', (e) => {
    if (e.data.targetRayMode === 'tracked-pointer' && !c.userData.linea) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const linea = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x111316 }));
      linea.scale.z = 2;
      c.add(linea);
      c.userData.linea = linea;
    }
  });
  c.addEventListener('select', () => alSeleccionarXR(c));
  c.addEventListener('squeezestart', () => { c.userData.agarre = { x: posX(c), giro: girar.rotation.y }; });
  c.addEventListener('squeezeend', () => { c.userData.agarre = null; });
  escena.add(c);
  return c;
});
const posX = (c) => new THREE.Vector3().setFromMatrixPosition(c.matrixWorld).x;

function alSeleccionarXR(control) {
  if (modoXR === 'immersive-ar') {
    if (gesto.huboArrastre) { gesto.huboArrastre = false; return; } // fue un giro o un pellizco
    if (colocando) { colocarEnReticula(); return; }
  }
  rayoDesdeControl(control);
  const iso = paisEnRayo();
  if (iso) tocarPais(iso); else cerrarFicha();
}

// ============================== Conquistar / robar ==============================
function tocarPais(iso) {
  if (!s.yo) { mostrarFicha(iso); cintillo('Primero regístrate en la página principal'); return; }
  const d = duenoDe(iso);
  if (esMio(d) || !juego.sePuedeReclamar() || juego.proteccionRestante(iso) > 0) { mostrarFicha(iso); return; }
  conquistar(iso);
}

async function conquistar(iso) {
  const nombre = porIso.get(iso).properties.nombre;
  mostrarFicha(iso);
  try {
    const r = await juego.reclamar(iso);
    if (r.resultado === 'ok') { cintillo(`<b>${escapar(nombre)}</b> es tuyo`, s.yo?.color); vibrar(); }
    else if (r.resultado === 'robado') { cintillo(`Le quitaste <b>${escapar(nombre)}</b> a ${escapar(r.dueno)}`, s.yo?.color); vibrar(); }
    else if (r.resultado === 'protegido') cintillo(`<b>${escapar(nombre)}</b> protegido ${r.espera} s`, r.color);
    else if (r.resultado !== 'en_camino' && r.resultado !== 'ya_es_tuyo') cintillo(escapar(mensaje(r.resultado)));
  } catch (e) {
    cintillo(escapar(mensaje(e.codigo)));
  }
}

function vibrar() {
  const sesion = renderer.xr.getSession();
  for (const fuente of sesion?.inputSources || []) fuente.gamepad?.hapticActuators?.[0]?.pulse?.(0.6, 60);
  try { navigator.vibrate?.(25); } catch { /* nada */ }
}

// ============================== Ficha y avisos ==============================
let relojFicha;
function mostrarFicha(iso) {
  seleccion = iso;
  orbita.autoRotate = false;
  pintar();
  actualizarFicha();
  clearTimeout(relojFicha);
  if (modoXR === 'immersive-ar') relojFicha = setTimeout(cerrarFicha, 3500); // en AR que no estorbe
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
  $('ficha-continente').textContent = p.continente;
  $('ficha-nombre').textContent = p.nombre;
  $('ficha-dueno').innerHTML = d
    ? `<span class="muestra-color" style="background:${d.color}"></span>${esMio(d) ? '<b>Es tuyo</b>' : `De <b>${escapar(d.nombre)}</b>`}`
    : 'Libre';
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
    : 'Para conquistar, primero <a href="./">regístrate en la página principal</a>. Aquí puedes mirar.';
}

function actualizarCrono() {
  const fase = juego.fase();
  const e = $('xr-crono');
  e.dataset.fase = fase;
  $('xr-crono-etiqueta').textContent = { jugando: 'En juego', espera: 'Prepárate', terminada: 'Fin', libre: 'Libre' }[fase] || '';
  $('xr-crono-tiempo').textContent = fase === 'jugando' ? reloj(juego.restante()) : '';
  if (modoXR === 'immersive-vr') actualizarPanelVR();
}

// ============================== Letrero flotante para VR ==============================
function crearPanelVR() {
  const lienzo = document.createElement('canvas');
  lienzo.width = 1024; lienzo.height = 360;
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  const malla = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.21), new THREE.MeshBasicMaterial({ map: textura, transparent: true }));
  malla.position.set(0, 0.46, 0);
  malla.visible = false;
  return { lienzo, textura, malla, aviso: null, ultimo: '' };
}

function actualizarPanelVR() {
  if (modoXR !== 'immersive-vr') { panel.malla.visible = false; return; }
  const fase = juego.fase();
  const d = seleccion ? duenoDe(seleccion) : null;
  const firma = [seleccion, d?.id, fase, fase === 'jugando' ? reloj(juego.restante()) : '', panel.aviso?.texto, juego.misPaises()].join('|');
  if (firma === panel.ultimo) return;
  panel.ultimo = firma;
  const ctx = panel.lienzo.getContext('2d');
  const { width: w, height: h } = panel.lienzo;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#111316'; ctx.fillRect(0, 0, w, 64);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 64, w, h - 64);
  ctx.textBaseline = 'middle';
  ctx.font = '800 40px "Big Shoulders Display", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fase === 'jugando' ? `EN JUEGO  ${reloj(juego.restante())}` : fase === 'terminada' ? 'FIN DE LA RONDA' : fase === 'espera' ? 'PREPÁRATE' : 'MODO LIBRE', 28, 34);
  ctx.textAlign = 'right';
  ctx.fillText(s.yo ? `${s.yo.nombre.toUpperCase()} · ${juego.misPaises()}` : 'SIN REGISTRO', w - 28, 34);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#111316';
  if (seleccion) {
    const p = porIso.get(seleccion).properties;
    ctx.font = '900 92px "Big Shoulders Display", sans-serif';
    ctx.fillText(p.nombre.toUpperCase(), 28, 140);
    ctx.font = '600 40px "Instrument Sans", sans-serif';
    if (d) { ctx.fillStyle = d.color; ctx.fillRect(28, 212, 30, 30); ctx.fillStyle = '#111316'; }
    ctx.fillText(d ? (esMio(d) ? 'Es tuyo' : `De ${d.nombre}`) : 'Libre', d ? 72 : 28, 228);
  } else {
    ctx.font = '800 58px "Big Shoulders Display", sans-serif';
    ctx.fillText('APUNTA Y PULSA EL GATILLO', 28, 140);
    ctx.font = '500 34px "Instrument Sans", sans-serif';
    ctx.fillStyle = '#5A6370';
    ctx.fillText('Agarre + mover el brazo, o palanca: girar el globo', 28, 214);
  }
  if (panel.aviso) {
    ctx.fillStyle = panel.aviso.color || '#111316';
    ctx.fillRect(0, h - 70, 14, 70);
    ctx.fillStyle = '#111316';
    ctx.font = '600 34px "Instrument Sans", sans-serif';
    ctx.fillText(panel.aviso.texto.slice(0, 46), 32, h - 35);
  }
  panel.textura.needsUpdate = true;
  panel.malla.visible = true;
}

// ============================== Gestos táctiles en AR ==============================
// La capa #ar-gestos recibe los dedos encima de la cámara: 1 dedo gira/inclina, 2 dedos cambian el tamaño.
const gesto = { dedos: new Map(), huboArrastre: false, distInicial: 0, escalaInicial: ESCALA_AR, recorrido: 0 };
let escalaAR = ESCALA_AR;

function distanciaDedos() {
  const [a, b] = [...gesto.dedos.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function conectarGestos() {
  const capa = $('ar-gestos');
  capa.addEventListener('pointerdown', (e) => {
    gesto.dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesto.dedos.size === 1) { gesto.huboArrastre = false; gesto.recorrido = 0; }
    if (gesto.dedos.size === 2) { gesto.distInicial = distanciaDedos(); gesto.escalaInicial = escalaAR; gesto.huboArrastre = true; }
  });
  capa.addEventListener('pointermove', (e) => {
    const antes = gesto.dedos.get(e.pointerId);
    if (!antes || colocando) return;
    const dx = e.clientX - antes.x, dy = e.clientY - antes.y;
    gesto.dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesto.dedos.size === 1) {
      gesto.recorrido += Math.hypot(dx, dy);
      if (gesto.recorrido > 8) gesto.huboArrastre = true;
      girar.rotation.y += dx * 0.012;
      inclinar.rotation.x = THREE.MathUtils.clamp(inclinar.rotation.x + dy * 0.008, -1.1, 1.1);
    } else if (gesto.dedos.size === 2 && gesto.distInicial > 0) {
      escalaAR = THREE.MathUtils.clamp(gesto.escalaInicial * (distanciaDedos() / gesto.distInicial), ESCALA_AR_MIN, ESCALA_AR_MAX);
      globo.scale.setScalar(escalaAR);
    }
  });
  const soltar = (e) => { gesto.dedos.delete(e.pointerId); };
  capa.addEventListener('pointerup', soltar);
  capa.addEventListener('pointercancel', soltar);
}

// ============================== Sesiones WebXR ==============================
let fuenteHitTest = null;
let colocando = false;
let colocarFrente = false;
let relojSinSuperficie;

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
    ? (ar ? 'Tu celular soporta realidad aumentada. ' : '') + (vr ? 'Visor de realidad virtual detectado.' : '')
    : 'Tu dispositivo no tiene AR ni visor. Usa la vista 3D: arrastra para girar y toca un país.';
}

async function entrarXR(modo) {
  try {
    const opciones = modo === 'immersive-ar'
      ? { optionalFeatures: ['hit-test', 'dom-overlay', 'local-floor'], domOverlay: { root: $('ui') } }
      : { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
    const sesion = await navigator.xr.requestSession(modo, opciones);
    renderer.xr.setReferenceSpaceType(modo === 'immersive-ar' ? 'local' : 'local-floor');
    await renderer.xr.setSession(sesion);
    modoXR = modo;
    document.body.classList.add('en-xr');
    orbita.enabled = false;
    sesion.addEventListener('end', salirXR);

    if (modo === 'immersive-ar') {
      escena.background = null;
      escalaAR = ESCALA_AR;
      globo.scale.setScalar(escalaAR);
      inclinar.rotation.x = 0.35; // un poco inclinado hacia ti, como un globo de escritorio
      $('ar-gestos').hidden = false;
      $('ar-controles').hidden = false;
      try {
        const espacioVista = await sesion.requestReferenceSpace('viewer');
        fuenteHitTest = await sesion.requestHitTestSource({ space: espacioVista });
      } catch { fuenteHitTest = null; }
      empezarColocacion();
    } else {
      escena.background = new THREE.Color('#E2E6E9');
      globo.scale.setScalar(ESCALA_VR);
      ancla.position.set(0, 1.3, -1.0);
      inclinar.rotation.x = 0.2;
      actualizarPanelVR();
    }
    actualizarFicha();
  } catch (e) {
    console.error(e);
    cintillo('No se pudo iniciar AR/VR en este dispositivo.');
  }
}

function empezarColocacion() {
  ancla.visible = false;
  if (fuenteHitTest) {
    colocando = true;
    indicacion('<b>Busca una mesa o el piso</b><br>Mueve el celular despacio y toca cuando aparezca el círculo');
    clearTimeout(relojSinSuperficie);
    // Si no encuentra superficie en 8 s, lo pone frente a ti.
    relojSinSuperficie = setTimeout(() => { if (colocando && !reticula.visible) { colocando = false; colocarFrente = true; } }, 8000);
  } else {
    colocando = false;
    colocarFrente = true;
  }
}

function colocarEnReticula() {
  if (!reticula.visible) return;
  ancla.position.setFromMatrixPosition(reticula.matrix);
  ancla.position.y += 0.24 * (escalaAR / ESCALA_AR); // flota encima de la superficie
  mirarHaciaMi();
  terminarColocacion();
}

function mirarHaciaMi() {
  const cam = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
  ancla.rotation.set(0, Math.atan2(cam.x - ancla.position.x, cam.z - ancla.position.z), 0);
}

function terminarColocacion() {
  colocando = false;
  reticula.visible = false;
  ancla.visible = true;
  clearTimeout(relojSinSuperficie);
  indicacion('<b>Toca</b> un país · <b>arrastra</b> para girar · <b>pellizca</b> para el tamaño', 4500);
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
  $('ar-gestos').hidden = true;
  $('ar-controles').hidden = true;
  $('ar-indicacion').hidden = true;
  fuenteHitTest = null;
  colocando = false;
  reticula.visible = false;
  ancla.visible = true;
  escena.background = null;
  globo.scale.setScalar(ESCALA_VR);
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
  $('btn-ar').addEventListener('click', () => entrarXR('immersive-ar'));
  $('btn-vr').addEventListener('click', () => entrarXR('immersive-vr'));
  $('ar-salir').addEventListener('click', () => renderer.xr.getSession()?.end());
  $('ar-colocar').addEventListener('click', empezarColocacion);
  // Que tocar botones o la ficha no cuente también como "tocar el globo" dentro de AR.
  $('ui').addEventListener('beforexrselect', (e) => {
    if (e.target.closest('button, a, .ficha, .barra')) e.preventDefault();
  });
  conectarGestos();
}

// ============================== Ciclo de dibujo ==============================
const relojCuadro = new THREE.Clock();
const vTmp = new THREE.Vector3();

function cuadro(_t, frame) {
  const dt = Math.min(relojCuadro.getDelta(), 0.1);

  if (modoXR) {
    const camXR = renderer.xr.getCamera();
    if (colocando && frame && fuenteHitTest) {
      const resultados = frame.getHitTestResults(fuenteHitTest);
      if (resultados.length) {
        const pose = resultados[0].getPose(renderer.xr.getReferenceSpace());
        reticula.visible = !!pose;
        if (pose) reticula.matrix.fromArray(pose.transform.matrix);
      } else {
        reticula.visible = false;
      }
    }
    if (colocarFrente) {
      const pos = new THREE.Vector3().setFromMatrixPosition(camXR.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camXR.quaternion);
      dir.y = 0; dir.normalize();
      ancla.position.copy(pos).addScaledVector(dir, 0.55);
      ancla.position.y -= 0.08;
      mirarHaciaMi();
      colocarFrente = false;
      terminarColocacion();
    }
    // VR: agarre + mover el control, o palanca del control.
    for (const c of controles) {
      if (c.userData.agarre) girar.rotation.y = c.userData.agarre.giro + (posX(c) - c.userData.agarre.x) * 6;
    }
    for (const fuente of renderer.xr.getSession()?.inputSources || []) {
      const ejes = fuente.gamepad?.axes;
      if (ejes && ejes.length >= 4) {
        if (Math.abs(ejes[2]) > 0.15) girar.rotation.y += ejes[2] * dt * 1.6;
        if (Math.abs(ejes[3]) > 0.15) inclinar.rotation.x = THREE.MathUtils.clamp(inclinar.rotation.x + ejes[3] * dt * 1.2, -1.1, 1.1);
      }
    }
    if (panel.malla.visible) { camXR.getWorldPosition(vTmp); panel.malla.lookAt(vTmp); }
  } else {
    orbita.update();
  }
  renderer.render(escena, camara);
}
