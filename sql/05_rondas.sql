-- =====================================================================
-- 05 · Modo carrera: rondas con cronómetro, países ilimitados y robos
-- Ejecutar como postgres DESPUÉS de 01–03. Se puede ejecutar varias veces.
--   * Gana quien tenga más países al terminar la ronda; en empate, quien
--     llegó primero a esa cantidad (su último reclamo fue más temprano).
--   * Se pueden quitar países a otros jugadores al instante (robos en cadena).
--     Opcional: 'proteccion_segundos' > 0 protege un país recién conquistado.
-- =====================================================================

-- ---------- Nuevas reglas ----------
INSERT INTO config (clave, valor) VALUES
  ('modo', 'libre'),                 -- libre | espera | jugando
  ('ronda_inicio', ''),
  ('ronda_fin', ''),
  ('proteccion_segundos', '0')       -- 0 = robos en cadena sin espera (caos total)
ON CONFLICT (clave) DO NOTHING;
UPDATE config SET valor = '0' WHERE clave IN ('max_paises_por_jugador', 'proteccion_segundos');  -- sin límite, sin protección

-- Bitácora: nuevo tipo 'robo' y a quién se le quitó el país.
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS victima_id INT;
ALTER TABLE eventos DROP CONSTRAINT IF EXISTS eventos_tipo_check;
ALTER TABLE eventos ADD CONSTRAINT eventos_tipo_check
  CHECK (tipo IN ('registro', 'reclamo', 'robo', 'liberacion', 'reinicio', 'config', 'ronda'));

-- ---------- Paleta: los colores pálidos se confundían con la tierra blanca del mapa ----------
DELETE FROM colores c
WHERE c.hex IN ('#FABED4', '#DCBEFF', '#FFFAC8', '#AAFFC3', '#FFD8B1', '#E0E0E0', '#F0E68C')
  AND NOT EXISTS (SELECT 1 FROM jugadores j WHERE j.color = c.hex);
INSERT INTO colores (hex, nombre, orden) VALUES
  ('#7A3E9D', 'Uva', 10),       ('#0E7C7B', 'Petróleo', 12), ('#C2185B', 'Frambuesa', 14),
  ('#6D4C41', 'Tierra', 16),    ('#4E7D2B', 'Musgo', 18),    ('#8E9A00', 'Pistache', 34),
  ('#455A64', 'Grafito', 36)
ON CONFLICT (hex) DO NOTHING;

-- ---------- Fase efectiva de la ronda (si ya pasó la hora de fin, está terminada) ----------
CREATE OR REPLACE FUNCTION fase_ronda() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN m.valor = 'jugando' AND f.valor <> '' THEN
      CASE WHEN now() >= f.valor::timestamptz THEN 'terminada' ELSE 'jugando' END
    ELSE m.valor
  END
  FROM config m, config f
  WHERE m.clave = 'modo' AND f.clave = 'ronda_fin'
$$;

-- ---------- Estado completo para los celulares ----------
CREATE OR REPLACE FUNCTION estado_juego() RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT json_build_object(
    'version',    (SELECT coalesce(max(e.id), 0) FROM eventos e),
    'ahora',      now(),
    'max',        (SELECT c.valor::int FROM config c WHERE c.clave = 'max_paises_por_jugador'),
    'abierto',    (SELECT c.valor = 'true' FROM config c WHERE c.clave = 'juego_abierto'),
    'proteccion', (SELECT c.valor::int FROM config c WHERE c.clave = 'proteccion_segundos'),
    'ronda', json_build_object(
               'fase',   fase_ronda(),
               'inicio', (SELECT nullif(c.valor, '')::timestamptz FROM config c WHERE c.clave = 'ronda_inicio'),
               'fin',    (SELECT nullif(c.valor, '')::timestamptz FROM config c WHERE c.clave = 'ronda_fin')),
    'jugadores', coalesce((
        SELECT json_agg(json_build_object(
                 'id', j.id, 'nombre', j.nombre, 'color', j.color,
                 'paises', (SELECT count(*) FROM reclamos r WHERE r.jugador_id = j.id),
                 'ultimo', (SELECT max(r.reclamado_en) FROM reclamos r WHERE r.jugador_id = j.id))
               ORDER BY j.id)
        FROM jugadores j), '[]'::json),
    'reclamos', coalesce((
        SELECT json_agg(json_build_object('iso', r.iso, 'j', r.jugador_id, 't', r.reclamado_en))
        FROM reclamos r), '[]'::json),
    'ultimos', coalesce((
        SELECT json_agg(x)
        FROM (SELECT e.id, e.tipo, j.nombre, j.color, e.iso, p.nombre AS pais,
                     v.nombre AS victima, v.color AS victima_color, e.creado_en
              FROM eventos e
              LEFT JOIN jugadores j ON j.id = e.jugador_id
              LEFT JOIN jugadores v ON v.id = e.victima_id
              LEFT JOIN paises p ON p.iso = e.iso
              ORDER BY e.id DESC
              LIMIT 15) x), '[]'::json)
  )
$$;

-- ---------- Reclamar o robar ----------
-- Cambia el tipo de respuesta (se agrega "espera"), por eso se borra y se vuelve a crear.
DROP FUNCTION IF EXISTS reclamar_pais(uuid, text);
CREATE FUNCTION reclamar_pais(p_token UUID, p_iso TEXT)
RETURNS TABLE (resultado TEXT, dueno TEXT, dueno_color TEXT, espera INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v        jugadores%ROWTYPE;
  v_iso    CHAR(3) := upper(btrim(p_iso));
  v_fase   TEXT := fase_ronda();
  v_max    INT;
  v_prot   INT;
  v_total  INT;
  v_dueno  INT;
  v_desde  TIMESTAMPTZ;
BEGIN
  SELECT * INTO v FROM jugadores WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'jugador_invalido'::text, NULL::text, NULL::text, NULL::int; RETURN;
  END IF;

  IF (SELECT c.valor FROM config c WHERE c.clave = 'juego_abierto') <> 'true' THEN
    RETURN QUERY SELECT 'juego_cerrado'::text, NULL::text, NULL::text, NULL::int; RETURN;
  END IF;
  IF v_fase = 'espera' THEN
    RETURN QUERY SELECT 'ronda_no_iniciada'::text, NULL::text, NULL::text, NULL::int; RETURN;
  END IF;
  IF v_fase = 'terminada' THEN
    RETURN QUERY SELECT 'ronda_terminada'::text, NULL::text, NULL::text, NULL::int; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM paises p WHERE p.iso = v_iso) THEN
    RETURN QUERY SELECT 'pais_invalido'::text, NULL::text, NULL::text, NULL::int; RETURN;
  END IF;

  SELECT c.valor::int INTO v_max  FROM config c WHERE c.clave = 'max_paises_por_jugador';
  SELECT c.valor::int INTO v_prot FROM config c WHERE c.clave = 'proteccion_segundos';
  IF v_max > 0 THEN
    SELECT count(*) INTO v_total FROM reclamos r WHERE r.jugador_id = v.id;
    IF v_total >= v_max THEN
      RETURN QUERY SELECT 'limite'::text, NULL::text, NULL::text, NULL::int; RETURN;
    END IF;
  END IF;

  -- 1) País libre: se conquista.
  INSERT INTO reclamos (iso, jugador_id) VALUES (v_iso, v.id)
  ON CONFLICT (iso) DO NOTHING;
  IF FOUND THEN
    INSERT INTO eventos (tipo, jugador_id, iso) VALUES ('reclamo', v.id, v_iso);
    RETURN QUERY SELECT 'ok'::text, v.nombre::text, v.color::text, NULL::int;
    RETURN;
  END IF;

  -- 2) País con dueño: se bloquea la fila para que dos robos simultáneos no choquen.
  SELECT r.jugador_id, r.reclamado_en INTO v_dueno, v_desde
  FROM reclamos r WHERE r.iso = v_iso FOR UPDATE;

  IF v_dueno = v.id THEN
    RETURN QUERY SELECT 'ya_es_tuyo'::text, v.nombre::text, v.color::text, NULL::int; RETURN;
  END IF;

  IF v_prot > 0 AND v_desde > now() - make_interval(secs => v_prot) THEN
    RETURN QUERY
      SELECT 'protegido'::text, j.nombre::text, j.color::text,
             ceil(extract(epoch FROM (v_desde + make_interval(secs => v_prot) - now())))::int
      FROM jugadores j WHERE j.id = v_dueno;
    RETURN;
  END IF;

  UPDATE reclamos SET jugador_id = v.id, reclamado_en = now() WHERE iso = v_iso;
  INSERT INTO eventos (tipo, jugador_id, iso, victima_id) VALUES ('robo', v.id, v_iso, v_dueno);
  RETURN QUERY SELECT 'robado'::text, j.nombre::text, j.color::text, NULL::int
               FROM jugadores j WHERE j.id = v_dueno;
END
$$;

-- ---------- Control de rondas (la API lo protege con ADMIN_KEY) ----------
CREATE OR REPLACE FUNCTION controlar_ronda(p_accion TEXT, p_minutos INT DEFAULT NULL) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_accion = 'iniciar' THEN
    -- Mapa en blanco; los jugadores registrados se conservan.
    DELETE FROM reclamos;
    UPDATE config SET valor = 'jugando' WHERE clave = 'modo';
    UPDATE config SET valor = now()::text WHERE clave = 'ronda_inicio';
    UPDATE config SET valor = (now() + make_interval(mins => greatest(1, least(coalesce(p_minutos, 3), 60))))::text
      WHERE clave = 'ronda_fin';
  ELSIF p_accion = 'preparar' THEN
    DELETE FROM reclamos;
    UPDATE config SET valor = 'espera' WHERE clave = 'modo';
    UPDATE config SET valor = '' WHERE clave IN ('ronda_inicio', 'ronda_fin');
  ELSIF p_accion = 'terminar' THEN
    UPDATE config SET valor = now()::text
    WHERE CASE WHEN clave <> 'ronda_fin' THEN false
               WHEN valor = '' THEN true
               ELSE valor::timestamptz > now() END;
  ELSIF p_accion = 'libre' THEN
    UPDATE config SET valor = 'libre' WHERE clave = 'modo';
    UPDATE config SET valor = '' WHERE clave IN ('ronda_inicio', 'ronda_fin');
  ELSE
    RETURN 'accion_invalida';
  END IF;
  INSERT INTO eventos (tipo) VALUES ('ronda');
  RETURN 'ok';
END
$$;

-- Reiniciar todo: vacía jugadores, reclamos y bitácora y REGRESA LOS CONTADORES SERIAL A 1.
-- TRUNCATE … RESTART IDENTITY hace las dos cosas en un solo paso (no hace falta un trigger).
CREATE OR REPLACE FUNCTION reiniciar_juego() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  TRUNCATE reclamos, eventos, jugadores RESTART IDENTITY;
  UPDATE config SET valor = 'libre' WHERE clave = 'modo';
  UPDATE config SET valor = '' WHERE clave IN ('ronda_inicio', 'ronda_fin');
  INSERT INTO eventos (tipo) VALUES ('reinicio');   -- queda como evento #1
END
$$;

-- Segundos de protección tras conquistar (0 a 120).
CREATE OR REPLACE FUNCTION configurar_proteccion(p_segundos INT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE config SET valor = greatest(0, least(p_segundos, 120))::text WHERE clave = 'proteccion_segundos';
  INSERT INTO eventos (tipo) VALUES ('config');
END
$$;

-- ---------- Ranking con desempate (para mostrar en pgAdmin) ----------
CREATE OR REPLACE VIEW ranking AS
SELECT row_number() OVER (ORDER BY count(r.iso) DESC, max(r.reclamado_en) ASC NULLS LAST, j.id) AS lugar,
       j.nombre, j.color, count(r.iso) AS paises, max(r.reclamado_en) AS ultimo_reclamo
FROM jugadores j
LEFT JOIN reclamos r ON r.jugador_id = j.id
GROUP BY j.id;

-- ---------- Permisos para la app ----------
REVOKE EXECUTE ON FUNCTION fase_ronda(), controlar_ronda(text, int), configurar_proteccion(int), reclamar_pais(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fase_ronda(), controlar_ronda(text, int), configurar_proteccion(int), reclamar_pais(uuid, text) TO globo_app;

SELECT 'Modo carrera instalado' AS listo, fase_ronda() AS fase,
       (SELECT valor FROM config WHERE clave = 'proteccion_segundos') AS proteccion_s,
       (SELECT count(*) FROM colores) AS colores;
