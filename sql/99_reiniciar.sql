-- 99 · Reiniciar el juego: borra jugadores, reclamos y bitácora, y regresa los
-- contadores SERIAL a 1 (TRUNCATE … RESTART IDENTITY). Conserva países y colores.
-- Es lo mismo que el botón "Reiniciar juego" del panel /admin/.
SELECT reiniciar_juego();

-- Comprobación: el próximo jugador será el número 1.
SELECT last_value, is_called FROM jugadores_id_seq;
