-- =====================================================================
-- 07 · Salas para emparejar la laptop (control con el mouse) con el celular (visor VR)
-- Ejecutar como postgres DESPUÉS de 06. Se puede ejecutar varias veces.
-- La laptop crea una sala con su "oferta" WebRTC y muestra el código en un QR;
-- el celular lee la oferta y deja su "respuesta". Después se hablan directo (sin pasar por aquí).
-- =====================================================================

CREATE TABLE IF NOT EXISTS salas (
  codigo    CHAR(4)     PRIMARY KEY CHECK (codigo ~ '^[0-9]{4}$'),
  oferta    TEXT        NOT NULL CHECK (length(oferta) < 20000),
  respuesta TEXT        CHECK (length(respuesta) < 20000),
  creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Crea una sala con un código de 4 dígitos que no esté en uso. Borra las salas viejas (más de 3 h).
CREATE OR REPLACE FUNCTION crear_sala(p_oferta TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_codigo CHAR(4);
BEGIN
  DELETE FROM salas WHERE creada_en < now() - interval '3 hours';
  FOR intento IN 1..30 LOOP
    v_codigo := lpad(floor(random() * 10000)::int::text, 4, '0');
    BEGIN
      INSERT INTO salas (codigo, oferta) VALUES (v_codigo, p_oferta);
      RETURN v_codigo;
    EXCEPTION WHEN unique_violation THEN
      -- ese código ya existe: probar otro
    END;
  END LOOP;
  RAISE EXCEPTION 'sin_codigos_libres';
END
$$;

CREATE OR REPLACE FUNCTION leer_sala(p_codigo TEXT)
RETURNS TABLE (oferta TEXT, respuesta TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.oferta, s.respuesta FROM salas s WHERE s.codigo = p_codigo
$$;

CREATE OR REPLACE FUNCTION responder_sala(p_codigo TEXT, p_respuesta TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE salas SET respuesta = p_respuesta WHERE codigo = p_codigo;
  IF FOUND THEN RETURN 'ok'; END IF;
  RETURN 'sala_no_existe';
END
$$;

REVOKE EXECUTE ON FUNCTION crear_sala(text), leer_sala(text), responder_sala(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crear_sala(text), leer_sala(text), responder_sala(text, text) TO globo_app;

SELECT 'Salas de control instaladas' AS listo;
