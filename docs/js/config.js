// ===== Configuración del Globo RDS =====
// Después de crear la función Lambda, pega aquí su "URL de función" (termina en .lambda-url.us-east-1.on.aws/).
window.GLOBO_CONFIG = {
  API_URL: 'PEGA_AQUI_LA_URL_DE_TU_FUNCION_LAMBDA',

  // Cada cuántos milisegundos el celular pregunta si hubo cambios.
  INTERVALO_MS: 2500,
};
