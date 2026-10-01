// Modo VR / AR con WebXR (three.js + three-globe).
//   * Meta Quest (navegador del visor): realidad virtual con controles; gatillo = elegir, gatillo otra vez = reclamar.
//   * Android con Chrome y ARCore: realidad aumentada; el globo aparece flotando frente a ti.
//   * iPhone y computadoras sin visor: vista 3D normal (Safari en iPhone no soporta WebXR).
import * as THREE from 'three';
import ThreeGlobe from 'three-globe';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { configurada } from './api.js';
import { crearJuego } from './juego.js';
import { cargarPaises, escapar, oscurecer, textoSobre, mensaje } from './comun.js';

const $ = (id) => document.getElementById(id);
const COLOR_OCEANO = '#0B1F3A';
const COLOR_TIERRA = '#2E405E';
const COLOR_BORDE = '#5B7090';
const ESCALA_VR = 0.003;   // three-globe mide 100 unidades de radio → 0.30 m
const ESCALA_AR = 0.0018;  // → 0.18 m, cabe sobre una mesa

let paises = [];
const porIso = new Map();
let seleccion = null;
let ocupado = false;
let modoXR = null; // null | 'immersive-vr' | 'immersive-ar'

const juego = crearJuego({
  alCambiar: () => { pintar(); actualizarHoja(); actualizarPanelVR(); actualizarYo(); },
  alEvento: (e) => {
    if (e.tipo === 'reclamo' && (!s.yo || e.nombre !== s.yo.nombre)) aviso(`${e.nombre} reclamó ${e.pais}`, e.color);
  },
  alConexion: (ok, error) => {
    $('conexion').dataset.estado = ok ? 'ok' : 'error';
    $('conexion-texto').textContent = ok ? 'En vivo' : mensaje(error?.codigo);
  },
});
const s = juego.estado;

// ---------- Escena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
$('escena').appendChild(renderer.domElement);

const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 200);
escena.add(new THREE.AmbientLight(0xffffff, 1.6));
const sol = new THREE.DirectionalLight(0xffffff, 1.4);
sol.position.set(1, 2, 1);
escena.add(sol);

const estrellas = crearEstrellas();
escena.add(estrellas);

const ancla = new THREE.Group();     // se mueve y se gira; el globo va dentro
ancla.position.set(0, 1.3, -1.2);
escena.add(ancla);

let globo;
const panel = crearPanelVR();        // letrero flotante con el país elegido (solo dentro de VR)
ancla.add(panel.malla);

camara.position.set(0, 1.3, 0);
const orbita = new OrbitControls(camara, renderer.domElement);
orbita.target.copy(ancla.position);
orbita.enableDamping = true;
orbita.enablePan = false;
orbita.minDistance = 0.45;
orbita.maxDistance = 3;
orbita.autoRotate = true;
orbita.autoRotateSpeed = 0.5;
orbita.addEventListener('start', () => { orbita.autoRotate = false; });

window.addEventListener('resize', () => {
  camara.aspect = window.innerWidth / window.innerHeight;
  camara.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Inicio ----------
iniciar().catch((e) => {
  console.error(e);
  $('cargando').innerHTML = '<p>No se pudo cargar el modo VR. Prueba en Chrome (Android) o en el navegador del Meta Quest.</p>';
});

async function iniciar() {
  paises = await cargarPaises();
  for (const f of paises) porIso.set(f.properties.iso, f);

  globo = new ThreeGlobe({ animateIn: false })
    .showAtmosphere(true)
    .atmosphereColor('#7FB4E3')
    .atmosphereAltitude(0.15)
    .polygonsData(paises)
    .polygonsTransitionDuration(0); // dentro de XR no hay requestAnimationFrame normal: sin animaciones de transición
  globo.globeMaterial().color.set(COLOR_OCEANO);
  globo.scale.setScalar(ESCALA_VR);
  ancla.add(globo);
  pintar();

  $('cargando').hidden = true;
  actualizarYo();
  conectarUI();
  await detectarSoporte();
  if (configurada) juego.iniciar();
  else aviso(mensaje('sin_configurar'));

  renderer.setAnimationLoop(cuadro);
}

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
      const d = duenoDe(f.properties.iso);
      let a = d ? 0.025 : 0.006;
      if (f.properties.iso === seleccion) a += 0.03;
      return a;
    });
}

// ---------- Elegir países con un rayo (dedo, mouse o control del visor) ----------
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

// Fuera de XR: tocar o hacer clic (sin arrastrar) elige el país.
let inicioToque = null;
renderer.domElement.addEventListener('pointerdown', (e) => { inicioToque = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (modoXR || !inicioToque) return;
  if (Math.hypot(e.clientX - inicioToque[0], e.clientY - inicioToque[1]) > 10) return;
  const r = renderer.domElement.getBoundingClientRect();
  rayo.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camara);
  const iso = paisEnRayo();
  if (iso) seleccionar(iso); else deseleccionar();
});

// Controles del visor (Quest) y toques en pantalla dentro de AR.
const controles = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  c.addEventListener('connected', (e) => {
    c.userData.modo = e.data.targetRayMode;
    if (e.data.targetRayMode === 'tracked-pointer' && !c.userData.linea) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const linea = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7fb4e3 }));
      linea.scale.z = 2;
      c.add(linea);
      c.userData.linea = linea;
    }
  });
  c.addEventListener('select', () => alSeleccionarXR(c));
  c.addEventListener('squeezestart', () => { c.userData.agarre = { x: posicionX(c), giro: ancla.rotation.y }; });
  c.addEventListener('squeezeend', () => { c.userData.agarre = null; });
  escena.add(c);
  return c;
});

function posicionX(c) { return new THREE.Vector3().setFromMatrixPosition(c.matrixWorld).x; }

function alSeleccionarXR(control) {
  rayoDesdeControl(control);
  const iso = paisEnRayo();
  if (!iso) { if (modoXR === 'immersive-vr') deseleccionar(); return; }
  // En VR no hay botones de pantalla: tocar dos veces el mismo país = reclamar/liberar.
  if (modoXR === 'immersive-vr' && iso === seleccion) accion();
  else seleccionar(iso);
}

function seleccionar(iso) {
  seleccion = iso;
  orbita.autoRotate = false;
  pintar();
  actualizarHoja();
  actualizarPanelVR();
}

function deseleccionar() {
  seleccion = null;
  pintar();
  actualizarHoja();
  actualizarPanelVR();
}

// ---------- Reclamar / liberar ----------
async function accion() {
  if (!seleccion || ocupado) return;
  if (!s.yo) { aviso('Primero regístrate en la página principal.'); return; }
  const iso = seleccion;
  const nombre = porIso.get(iso).properties.nombre;
  const d = duenoDe(iso);
  const mio = d && d.id === s.yo.id;
  if (d && !mio) { aviso(`${nombre} ya es de ${d.nombre}`, d.color); return; }
  ocupado = true;
  actualizarHoja(); actualizarPanelVR();
  try {
    const r = mio ? await juego.liberar(iso) : await juego.reclamar(iso);
    if (r.resultado === 'ok') aviso(mio ? `Liberaste ${nombre}` : `¡${nombre} es tuyo!`, s.yo.color);
    else if (r.resultado === 'ocupado') aviso(`Te ganó ${r.dueno}`, r.color);
    else aviso(mensaje(r.resultado));
    vibrar();
  } catch (e) {
    aviso(mensaje(e.codigo));
  } finally {
    ocupado = false;
    actualizarHoja(); actualizarPanelVR();
  }
}

function vibrar() {
  const sesion = renderer.xr.getSession();
  for (const fuente of sesion?.inputSources || []) fuente.gamepad?.hapticActuators?.[0]?.pulse?.(0.6, 60);
  if (!sesion && navigator.vibrate) navigator.vibrate(30);
}

// ---------- Interfaz HTML (vista normal y AR) ----------
function conectarUI() {
  $('vr-cerrar').addEventListener('click', deseleccionar);
  $('vr-accion').addEventListener('click', accion);
  $('btn-vr').addEventListener('click', () => entrarXR('immersive-vr'));
  $('btn-ar').addEventListener('click', () => entrarXR('immersive-ar'));
  $('ar-salir').addEventListener('click', () => renderer.xr.getSession()?.end());
  for (const [id, dir] of [['ar-izq', -1], ['ar-der', 1]]) {
    const b = $(id);
    const parar = () => { girarAR = 0; };
    b.addEventListener('pointerdown', () => { girarAR = dir; });
    b.addEventListener('pointerup', parar);
    b.addEventListener('pointerleave', parar);
    b.addEventListener('pointercancel', parar);
  }
  // Que tocar los botones de la capa HTML no cuente también como "seleccionar" dentro de AR.
  $('ui').addEventListener('beforexrselect', (e) => {
    if (e.target.closest('button, a, .hoja')) e.preventDefault();
  });
}

function actualizarYo() {
  $('vr-yo').innerHTML = s.yo
    ? `Juegas como <b style="color:${s.yo.color}">${escapar(s.yo.nombre)}</b> · ${juego.misPaises()}/${s.max} países`
    : 'Para reclamar países primero <a href="index.html">regístrate en la página principal</a>. Aquí puedes mirar.';
}

function textoDueno(d) {
  if (!d) return 'Libre';
  return s.yo && d.id === s.yo.id ? 'Es tuyo' : `De ${d.nombre}`;
}

function actualizarHoja() {
  const hoja = $('vr-hoja');
  hoja.hidden = !seleccion;
  if (!seleccion) return;
  const p = porIso.get(seleccion).properties;
  const d = duenoDe(seleccion);
  const mio = d && s.yo && d.id === s.yo.id;
  $('vr-continente').textContent = p.continente;
  $('vr-nombre').textContent = p.nombre;
  $('vr-dueno').innerHTML = `${d ? `<span class="punto" style="background:${d.color}"></span>` : ''}${escapar(textoDueno(d))}`;
  const b = $('vr-accion');
  b.style.background = ''; b.style.color = '';
  if (!s.yo) { b.textContent = 'Regístrate en la página principal'; b.disabled = true; }
  else if (mio) { b.textContent = `Liberar ${p.nombre}`; b.disabled = ocupado; }
  else if (d) { b.textContent = 'Ya tiene dueño'; b.disabled = true; }
  else if (juego.misPaises() >= s.max) { b.textContent = `Ya tienes ${s.max} países`; b.disabled = true; }
  else {
    b.textContent = ocupado ? 'Reclamando…' : `Reclamar ${p.nombre}`;
    b.disabled = ocupado;
    b.style.background = s.yo.color; b.style.color = textoSobre(s.yo.color);
  }
}

let relojAviso;
function aviso(texto, color) {
  const cont = $('avisos');
  const el = document.createElement('div');
  el.className = 'aviso';
  el.innerHTML = `${color ? `<span class="punto" style="background:${color}"></span>` : ''}<span>${escapar(texto)}</span>`;
  cont.prepend(el);
  while (cont.children.length > 3) cont.lastChild.remove();
  setTimeout(() => el.remove(), 3800);
  // Dentro de VR no se ve el HTML: el aviso también aparece en el letrero flotante.
  panel.aviso = { texto, color };
  actualizarPanelVR();
  clearTimeout(relojAviso);
  relojAviso = setTimeout(() => { panel.aviso = null; actualizarPanelVR(); }, 3800);
}

// ---------- Letrero flotante para VR (texto dibujado en un canvas) ----------
function crearPanelVR() {
  const lienzo = document.createElement('canvas');
  lienzo.width = 1024; lienzo.height = 400;
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  const malla = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.24),
    new THREE.MeshBasicMaterial({ map: textura, transparent: true }),
  );
  malla.position.set(0, 0.48, 0);
  malla.visible = false;
  return { lienzo, textura, malla, aviso: null };
}

function actualizarPanelVR() {
  if (!panel || modoXR !== 'immersive-vr') { panel.malla.visible = false; return; }
  const ctx = panel.lienzo.getContext('2d');
  const { width: w, height: h } = panel.lienzo;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(16,24,40,0.92)';
  ctx.beginPath(); ctx.roundRect(8, 8, w - 16, h - 16, 40); ctx.fill();
  ctx.fillStyle = '#ECEFF5';
  ctx.textBaseline = 'top';
  if (seleccion) {
    const p = porIso.get(seleccion).properties;
    const d = duenoDe(seleccion);
    ctx.font = '600 72px "IBM Plex Sans", sans-serif';
    ctx.fillText(p.nombre, 48, 40);
    ctx.font = '44px "IBM Plex Sans", sans-serif';
    if (d) { ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(66, 172, 18, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#A9B4C7';
    ctx.fillText(textoDueno(d), d ? 100 : 48, 148);
    ctx.fillStyle = '#F0A04B';
    const mio = d && s.yo && d.id === s.yo.id;
    const ayuda = !s.yo ? 'Regístrate en la página principal'
      : ocupado ? 'Enviando…'
      : mio ? 'Gatillo otra vez = liberar'
      : d ? 'Ya tiene dueño' : 'Gatillo otra vez = reclamar';
    ctx.fillText(ayuda, 48, 240);
  } else {
    ctx.font = '600 56px "IBM Plex Sans", sans-serif';
    ctx.fillText('Apunta a un país y pulsa el gatillo', 48, 60);
    ctx.font = '40px "IBM Plex Sans", sans-serif';
    ctx.fillStyle = '#A9B4C7';
    ctx.fillText('Botón lateral (agarre) + mover el brazo = girar', 48, 160);
  }
  if (panel.aviso) {
    ctx.fillStyle = panel.aviso.color || '#7FB4E3';
    ctx.font = '600 40px "IBM Plex Sans", sans-serif';
    ctx.fillText(panel.aviso.texto.slice(0, 40), 48, 316);
  }
  panel.textura.needsUpdate = true;
  panel.malla.visible = true;
}

// ---------- Sesiones WebXR ----------
async function detectarSoporte() {
  const xr = navigator.xr;
  if (!window.isSecureContext) {
    $('vr-soporte').textContent = 'WebXR necesita HTTPS (GitHub Pages ya lo tiene).';
    return;
  }
  if (!xr) {
    $('vr-soporte').textContent = 'Este navegador no soporta WebXR (por ejemplo Safari en iPhone). Puedes usar el globo en 3D aquí mismo: arrastra para girar y toca un país.';
    return;
  }
  const [vr, ar] = await Promise.all([
    xr.isSessionSupported('immersive-vr').catch(() => false),
    xr.isSessionSupported('immersive-ar').catch(() => false),
  ]);
  $('btn-vr').hidden = !vr;
  $('btn-ar').hidden = !ar;
  $('vr-soporte').textContent = vr || ar
    ? (vr ? 'Visor detectado. ' : '') + (ar ? 'Tu celular soporta realidad aumentada. ' : '')
    : 'Tu dispositivo no tiene visor ni AR. Usa la vista 3D: arrastra para girar y toca un país.';
}

async function entrarXR(modo) {
  try {
    const opciones = modo === 'immersive-ar'
      ? { optionalFeatures: ['dom-overlay', 'local-floor'], domOverlay: { root: $('ui') } }
      : { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] };
    const sesion = await navigator.xr.requestSession(modo, opciones);
    renderer.xr.setReferenceSpaceType(modo === 'immersive-ar' ? 'local' : 'local-floor');
    await renderer.xr.setSession(sesion);
    modoXR = modo;
    document.body.classList.add('en-xr');
    orbita.enabled = false;
    if (modo === 'immersive-ar') {
      escena.background = null;
      estrellas.visible = false;
      globo.scale.setScalar(ESCALA_AR);
      panel.malla.visible = false;
      $('ar-controles').hidden = false;
      colocarFrente = true;
    } else {
      escena.background = new THREE.Color('#050912');
      estrellas.visible = true;
      globo.scale.setScalar(ESCALA_VR);
      ancla.position.set(0, 1.3, -1.0);
      actualizarPanelVR();
    }
    sesion.addEventListener('end', salirXR);
  } catch (e) {
    console.error(e);
    aviso('No se pudo iniciar la sesión XR en este dispositivo.');
  }
}

function salirXR() {
  modoXR = null;
  document.body.classList.remove('en-xr');
  $('ar-controles').hidden = true;
  escena.background = null;
  estrellas.visible = true;
  globo.scale.setScalar(ESCALA_VR);
  ancla.position.set(0, 1.3, -1.2);
  ancla.rotation.set(0, 0, 0);
  camara.position.set(0, 1.3, 0);
  orbita.target.copy(ancla.position);
  orbita.enabled = true;
  panel.malla.visible = false;
  girarAR = 0;
}

// ---------- Ciclo de dibujo ----------
let colocarFrente = false;
let girarAR = 0;
const reloj = new THREE.Clock();
const vTmp = new THREE.Vector3();

function cuadro() {
  const dt = Math.min(reloj.getDelta(), 0.1);

  if (modoXR) {
    const camXR = renderer.xr.getCamera();
    // AR: al entrar, poner el globo 0.6 m frente a la cara.
    if (colocarFrente) {
      const pos = new THREE.Vector3().setFromMatrixPosition(camXR.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camXR.quaternion);
      dir.y = 0; dir.normalize();
      ancla.position.copy(pos).addScaledVector(dir, 0.6);
      ancla.position.y -= 0.05;
      colocarFrente = false;
    }
    // Girar: botón de agarre + mover el control, palanca del control, o botones ⟲ ⟳ en AR.
    for (const c of controles) {
      if (c.userData.agarre) ancla.rotation.y = c.userData.agarre.giro + (posicionX(c) - c.userData.agarre.x) * 6;
    }
    for (const fuente of renderer.xr.getSession()?.inputSources || []) {
      const ejes = fuente.gamepad?.axes;
      if (ejes && ejes.length >= 4 && Math.abs(ejes[2]) > 0.15) ancla.rotation.y += ejes[2] * dt * 1.6;
    }
    if (girarAR) ancla.rotation.y += girarAR * dt * 1.2;
    // El letrero siempre mira hacia la persona.
    if (panel.malla.visible) {
      camXR.getWorldPosition(vTmp);
      panel.malla.lookAt(vTmp);
    }
  } else {
    orbita.update();
  }

  estrellas.rotation.y += dt * 0.005;
  renderer.render(escena, camara);
}

function crearEstrellas() {
  const n = 1500;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 40);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, sizeAttenuation: true }));
}
