-- =====================================================================
-- 04 · Consultas para mostrar en pgAdmin durante la exposición
-- Ejecuta una por una (selecciónala y presiona F5) mientras el grupo juega.
-- =====================================================================

-- 1. ¿Quién está jugando?
SELECT id, nombre, color, creado_en FROM jugadores ORDER BY id;

-- 2. Ranking: países por jugador
SELECT j.nombre, j.color, count(r.iso) AS paises
FROM jugadores j
LEFT JOIN reclamos r ON r.jugador_id = j.id
GROUP BY j.id
ORDER BY paises DESC, j.nombre;

-- 3. Cada país reclamado con su dueño
SELECT p.nombre AS pais, p.continente, j.nombre AS dueno, r.reclamado_en
FROM reclamos r
JOIN paises p    ON p.iso = r.iso
JOIN jugadores j ON j.id = r.jugador_id
ORDER BY r.reclamado_en DESC;

-- 4. ¿Qué continente está más conquistado?
SELECT p.continente, count(r.iso) AS reclamados, count(*) AS total,
       round(100.0 * count(r.iso) / count(*), 1) AS porcentaje
FROM paises p
LEFT JOIN reclamos r ON r.iso = p.iso
GROUP BY p.continente
ORDER BY porcentaje DESC;

-- 5. El país reclamado más lejano a Querétaro (fórmula de Haversine, distancia en km)
SELECT p.nombre AS pais, j.nombre AS dueno,
       round(6371 * 2 * asin(sqrt(
         power(sin(radians(p.lat - 20.59) / 2), 2) +
         cos(radians(20.59)) * cos(radians(p.lat)) * power(sin(radians(p.lng + 100.39) / 2), 2)
       ))) AS km_desde_queretaro
FROM reclamos r
JOIN paises p    ON p.iso = r.iso
JOIN jugadores j ON j.id = r.jugador_id
ORDER BY km_desde_queretaro DESC
LIMIT 5;

-- 6. Bitácora en vivo (los últimos 20 movimientos)
SELECT e.id, e.tipo, j.nombre, p.nombre AS pais, e.creado_en
FROM eventos e
LEFT JOIN jugadores j ON j.id = e.jugador_id
LEFT JOIN paises p    ON p.iso = e.iso
ORDER BY e.id DESC
LIMIT 20;

-- 7. Demostrar que PostgreSQL no deja repetir colores (debe dar ERROR 23505):
-- INSERT INTO jugadores (nombre, color) SELECT 'Prueba', color FROM jugadores LIMIT 1;

-- 8. Reglas del juego
SELECT * FROM config;
-- Cambiar el máximo de países por persona a 3:
-- SELECT configurar_juego(3, NULL);
-- Cerrar el juego (nadie puede reclamar):
-- SELECT configurar_juego(NULL, false);
