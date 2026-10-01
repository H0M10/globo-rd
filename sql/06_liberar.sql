-- =====================================================================
-- 06 · Liberar para conquistar + paleta para el mapa oscuro
-- Ejecutar como postgres DESPUÉS de 05. Se puede ejecutar varias veces.
--   * Ya no se roba directo: para quedarte un país ajeno primero hay que
--     LIBERARLO (botón) y después conquistarlo. En ese segundo otro te lo puede ganar.
--   * Paleta: vuelve el mapa oscuro, así que se cambian los colores más oscuros
--     (se perdían sobre la tierra azul) por tonos claros.
-- =====================================================================

-- ---------- Paleta para el mapa oscuro ----------
DELETE FROM colores c
WHERE c.hex IN ('#1B2A80', '#800000', '#455A64', '#6D4C41', '#556B2F')
  AND NOT EXISTS (SELECT 1 FROM jugadores j WHERE j.color = c.hex);
INSERT INTO colores (hex, nombre, orden) VALUES
  ('#FABED4', 'Rosa pastel', 19), ('#DCBEFF', 'Lavanda', 15), ('#FFFAC8', 'Crema', 16),
  ('#AAFFC3', 'Menta', 31),       ('#FFD8B1', 'Durazno', 36)
ON CONFLICT (hex) DO NOTHING;

-- ---------- Conquistar: solo países libres ----------
CREATE OR REPLACE FUNCTION reclamar_pais(p_token UUID, p_iso TEXT)
RETURNS TABLE (resultado TEXT, dueno TEXT, dueno_color TEXT, espera INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v       jugadores%ROWTYPE;
  v_iso   CHAR(3) := upper(btrim(p_iso));
  v_fase  TEXT := fase_ronda();
  v_max   INT;
  v_total INT;
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

  SELECT c.valor::int INTO v_max FROM config c WHERE c.clave = 'max_paises_por_jugador';
  IF v_max > 0 THEN
    SELECT count(*) INTO v_total FROM reclamos r WHERE r.jugador_id = v.id;
    IF v_total >= v_max THEN
      RETURN QUERY SELECT 'limite'::text, NULL::text, NULL::text, NULL::int; RETURN;
    END IF;
  END IF;

  -- La llave primaria de reclamos.iso decide: si dos tocan el mismo país libre, gana el primero.
  INSERT INTO reclamos (iso, jugador_id) VALUES (v_iso, v.id)
  ON CONFLICT (iso) DO NOTHING;
  IF FOUND THEN
    INSERT INTO eventos (tipo, jugador_id, iso) VALUES ('reclamo', v.id, v_iso);
    RETURN QUERY SELECT 'ok'::text, v.nombre::text, v.color::text, NULL::int;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT CASE WHEN r.jugador_id = v.id THEN 'ya_es_tuyo' ELSE 'ocupado' END::text,
           j.nombre::text, j.color::text, NULL::int
    FROM reclamos r JOIN jugadores j ON j.id = r.jugador_id
    WHERE r.iso = v_iso;
END
$$;

-- ---------- Liberar: cualquier país (tuyo o de otro) queda libre ----------
-- Cambia el tipo de respuesta (antes devolvía solo texto), por eso se borra y se vuelve a crear.
DROP FUNCTION IF EXISTS liberar_pais(uuid, text);
CREATE FUNCTION liberar_pais(p_token UUID, p_iso TEXT)
RETURNS TABLE (resultado TEXT, dueno TEXT, dueno_color TEXT, espera INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id    INT;
  v_iso   CHAR(3) := upper(btrim(p_iso));
  v_fase  TEXT := fase_ronda();
  v_prot  INT;
  v_dueno INT;
  v_desde TIMESTAMPTZ;
BEGIN
  SELECT j.id INTO v_id FROM jugadores j WHERE j.token = p_token;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'jugador_invalido'::text, NULL::text, NULL::text, NULL::int; RETURN;
  END IF;
  IF v_fase = 'espera' THEN
    RETURN QUERY SELECT 'ronda_no_iniciada'::text, NULL::text, NULL::text, NULL::int; RETURN;
  END IF;
  IF v_fase = 'terminada' THEN
    RETURN QUERY SELECT 'ronda_terminada'::text, NULL::text, NULL::text, NULL::int; RETURN;
  END IF;

  -- Bloquear la fila: si dos personas liberan el mismo país a la vez, solo una lo logra.
  SELECT r.jugador_id, r.reclamado_en INTO v_dueno, v_desde
  FROM reclamos r WHERE r.iso = v_iso FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'ya_libre'::text, NULL::text, NULL::text, NULL::int; RETURN;
  END IF;

  SELECT c.valor::int INTO v_prot FROM config c WHERE c.clave = 'proteccion_segundos';
  IF v_dueno <> v_id AND v_prot > 0 AND v_desde > now() - make_interval(secs => v_prot) THEN
    RETURN QUERY
      SELECT 'protegido'::text, j.nombre::text, j.color::text,
             ceil(extract(epoch FROM (v_desde + make_interval(secs => v_prot) - now())))::int
      FROM jugadores j WHERE j.id = v_dueno;
    RETURN;
  END IF;

  DELETE FROM reclamos r WHERE r.iso = v_iso;
  INSERT INTO eventos (tipo, jugador_id, iso, victima_id)
  VALUES ('liberacion', v_id, v_iso, CASE WHEN v_dueno <> v_id THEN v_dueno END);

  RETURN QUERY SELECT 'ok'::text, j.nombre::text, j.color::text, NULL::int
               FROM jugadores j WHERE j.id = v_dueno;
END
$$;

REVOKE EXECUTE ON FUNCTION liberar_pais(uuid, text), reclamar_pais(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION liberar_pais(uuid, text), reclamar_pais(uuid, text) TO globo_app;

SELECT 'Liberar para conquistar instalado' AS listo, (SELECT count(*) FROM colores) AS colores;
