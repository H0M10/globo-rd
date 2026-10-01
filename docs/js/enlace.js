// Enlace directo laptop ↔ celular con WebRTC (canal de datos).
// La base de RDS solo sirve de "buzón" para el saludo inicial (oferta y respuesta);
// después los mensajes del mouse viajan directo entre los dos dispositivos, sin pasar por AWS.
import { api } from './api.js';

const CONFIG_RTC = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

// Espera a que el navegador termine de juntar sus "direcciones" (candidatos ICE), así basta
// con un solo intercambio de mensajes (sin ir y venir varias veces por la API).
function esperarCandidatos(pc, maxMs = 3500) {
  return new Promise((resolver) => {
    if (pc.iceGatheringState === 'complete') return resolver();
    const fin = setTimeout(resolver, maxMs);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(fin); resolver(); }
    });
  });
}

function conectarCanal(canal, { alMensaje, alEstado }) {
  canal.addEventListener('open', () => alEstado?.('conectado'));
  canal.addEventListener('close', () => alEstado?.('desconectado'));
  canal.addEventListener('message', (e) => { try { alMensaje?.(JSON.parse(e.data)); } catch { /* mensaje inválido */ } });
  return (mensaje) => { if (canal.readyState === 'open') canal.send(JSON.stringify(mensaje)); };
}

// ---------- Laptop: crea la sala y espera al celular ----------
export async function crearSala({ alMensaje, alEstado, alCodigo }) {
  const pc = new RTCPeerConnection(CONFIG_RTC);
  // Mensajes del mouse: sin reintentos ni orden estricto = menos retraso.
  const canal = pc.createDataChannel('control', { ordered: false, maxRetransmits: 0 });
  const enviar = conectarCanal(canal, { alMensaje, alEstado });
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') alEstado?.('fallo');
    if (pc.connectionState === 'disconnected') alEstado?.('desconectado');
  });

  alEstado?.('preparando');
  await pc.setLocalDescription(await pc.createOffer());
  await esperarCandidatos(pc);
  const { codigo } = await api.salaCrear(pc.localDescription.sdp);
  alCodigo?.(codigo);
  alEstado?.('esperando');

  // Revisar cada segundo si el celular ya dejó su respuesta.
  let activo = true;
  (async () => {
    while (activo) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const sala = await api.salaLeer(codigo);
        if (sala.respuesta) {
          await pc.setRemoteDescription({ type: 'answer', sdp: sala.respuesta });
          alEstado?.('enlazando');
          activo = false;
        }
      } catch { /* reintentar */ }
    }
  })();

  return { codigo, enviar, cerrar: () => { activo = false; pc.close(); } };
}

// ---------- Celular: se une a la sala con el código del QR ----------
export async function unirseSala(codigo, { alMensaje, alEstado }) {
  const pc = new RTCPeerConnection(CONFIG_RTC);
  let enviar = () => {};
  pc.addEventListener('datachannel', (e) => { enviar = conectarCanal(e.channel, { alMensaje, alEstado }); });
  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') alEstado?.('fallo');
    if (pc.connectionState === 'disconnected') alEstado?.('desconectado');
  });

  alEstado?.('buscando');
  const sala = await api.salaLeer(codigo);
  await pc.setRemoteDescription({ type: 'offer', sdp: sala.oferta });
  await pc.setLocalDescription(await pc.createAnswer());
  await esperarCandidatos(pc);
  await api.salaResponder(codigo, pc.localDescription.sdp);
  alEstado?.('enlazando');

  return { enviar: (m) => enviar(m), cerrar: () => pc.close() };
}
