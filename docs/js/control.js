// Laptop como control de las gafas VR: crea una sala, muestra el QR y envía el mouse al celular.
//   Clic derecho sostenido + mover = girar · clic izquierdo = actuar sobre la mira · rueda = tamaño · espacio = al frente
import { crearSala } from './enlace.js';
import { escapar, mensaje } from './comun.js';

const $ = (id) => document.getElementById(id);
let sala = null;
let conectado = false;
let girando = false;
const acumulado = { dx: 0, dy: 0 };

function estado(texto, clase = '') {
  $('estado').textContent = texto;
  $('estado').dataset.estado = clase;
  $('conexion').dataset.estado = clase === 'ok' ? 'ok' : clase === 'error' ? 'error' : 'conectando';
  $('conexion-texto').textContent = clase === 'ok' ? 'Gafas conectadas' : 'Control VR';
}

async function nuevaSala() {
  sala?.cerrar();
  conectado = false;
  $('codigo').textContent = '····';
  $('qr').innerHTML = '';
  estado('Preparando la sala…');
  try {
    sala = await crearSala({
      alCodigo: (codigo) => {
        const url = new URL('vr.html', location.href);
        url.searchParams.set('sala', codigo);
        $('codigo').textContent = codigo;
        $('url').textContent = url.href.replace(/^https?:\/\//, '');
        if (window.qrcode) {
          const qr = window.qrcode(0, 'M');
          qr.addData(url.href);
          qr.make();
          $('qr').innerHTML = qr.createSvgTag(4, 0);
        }
      },
      alEstado: (e) => {
        conectado = e === 'conectado';
        if (e === 'esperando') estado('Esperando a que el celular escanee el QR…');
        else if (e === 'enlazando') estado('El celular respondió, conectando…');
        else if (e === 'conectado') { estado('Conectado. Ya puedes usar el mouse.', 'ok'); $('hud-pais').textContent = 'Apunta con la mira'; }
        else if (e === 'fallo') estado('No se pudo conectar directo. Pon la laptop y el celular en la misma Wi-Fi (o el hotspot del celular) y genera otro QR.', 'error');
        else if (e === 'desconectado') estado('Se desconectó el celular. Genera otro QR para volver a enlazar.', 'error');
      },
      alMensaje: mostrarEstadoCelular,
    });
  } catch (e) {
    estado(`No se pudo crear la sala: ${mensaje(e.codigo)}`, 'error');
  }
}

function mostrarEstadoCelular(m) {
  if (m.t !== 'estado') return;
  $('hud-pais').textContent = m.pais || (m.enVR ? 'Apunta a un país' : 'Entra a VR en el celular');
  $('hud-dueno').innerHTML = m.pais
    ? (m.dueno ? `<span class="muestra-color" style="background:${m.color}"></span>${escapar(m.dueno)}` : 'Libre')
    : '';
  $('hud-ayuda').textContent = !m.pais ? '' : !m.dueno ? 'Clic izquierdo = conquistar'
    : m.seleccionado ? (m.dueno === 'tuyo' ? 'Clic izquierdo otra vez = soltar' : 'Clic izquierdo otra vez = liberar') : 'Clic izquierdo = seleccionar';
  $('hud-yo').textContent = m.yo ? `${m.yo} · ${m.paises} países` : 'Sin registro en el celular';
  $('hud-tiempo').textContent = m.tiempo || '';
  $('hud-juego').dataset.fase = m.fase;
}

const enviar = (msg) => { if (conectado) sala?.enviar(msg); };

// ---------- Mouse ----------
const pad = $('pad');
document.addEventListener('contextmenu', (e) => e.preventDefault()); // sin menú del clic derecho

pad.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== pad) pad.requestPointerLock?.(); // el mouse "infinito" para girar sin topar con la orilla
  if (e.button === 2) girando = true;
  if (e.button === 0) enviar({ t: 'clic' });
});
document.addEventListener('mouseup', (e) => { if (e.button === 2) girando = false; });
document.addEventListener('mousemove', (e) => {
  if (!girando) return;
  acumulado.dx += e.movementX;
  acumulado.dy += e.movementY;
});
pad.addEventListener('wheel', (e) => { e.preventDefault(); enviar({ t: 'zoom', d: Math.sign(e.deltaY) }); }, { passive: false });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); enviar({ t: 'centrar' }); }
});
document.addEventListener('pointerlockchange', () => {
  const tomado = document.pointerLockElement === pad;
  pad.classList.toggle('tomado', tomado);
  $('tomar').textContent = tomado ? 'Mouse tomado · Esc para soltarlo' : 'Haz clic aquí para tomar el mouse · Esc para soltarlo';
  if (!tomado) girando = false;
});

// El giro se manda ~30 veces por segundo, juntando el movimiento intermedio.
setInterval(() => {
  if (!acumulado.dx && !acumulado.dy) return;
  enviar({ t: 'girar', dx: acumulado.dx, dy: acumulado.dy });
  acumulado.dx = 0; acumulado.dy = 0;
}, 33);

$('nueva').addEventListener('click', nuevaSala);
nuevaSala();
