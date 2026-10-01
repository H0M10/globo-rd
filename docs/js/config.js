// ===== Configuración del Globo RDS =====
// Después de crear la función Lambda, pega aquí su "URL de función" (termina en .lambda-url.us-east-1.on.aws/).
window.GLOBO_CONFIG = {
  API_URL: 'https://4iise5oucy7b4zthawf7uxe5re0ycisg.lambda-url.us-east-1.on.aws',

  // Cada cuántos milisegundos el celular pregunta si hubo cambios.
  INTERVALO_MS: 2500,
};
