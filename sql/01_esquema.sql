-- =====================================================================
-- 01 · Esquema del Globo RDS (PostgreSQL 13+ · probado para RDS 18)
-- Ejecutar en pgAdmin › RDS Expo › Databases › escuela › Query Tool
-- conectado como el usuario maestro (postgres). Se puede ejecutar varias veces.
-- =====================================================================

-- ---------- Tablas ----------

-- Los países del mapa. El código es ADM0_A3 de Natural Earth (MEX, BRA, FRA…).
CREATE TABLE IF NOT EXISTS paises (
  iso        CHAR(3)      PRIMARY KEY CHECK (iso ~ '^[A-Z]{3}$'),
  nombre     VARCHAR(80)  NOT NULL,
  continente VARCHAR(30)  NOT NULL,
  lat        NUMERIC(6,2) NOT NULL,
  lng        NUMERIC(6,2) NOT NULL
);

-- La paleta: solo se puede jugar con estos colores y cada uno tiene un solo dueño.
CREATE TABLE IF NOT EXISTS colores (
  hex    CHAR(7)     PRIMARY KEY CHECK (hex ~ '^#[0-9A-F]{6}$'),
  nombre VARCHAR(30) NOT NULL UNIQUE,
  orden  SMALLINT    NOT NULL
);

-- Cada persona que entra al juego.
CREATE TABLE IF NOT EXISTS jugadores (
  id        SERIAL      PRIMARY KEY,
  nombre    VARCHAR(20) NOT NULL CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 20),
  color     CHAR(7)     NOT NULL REFERENCES colores (hex),
  token     UUID        NOT NULL DEFAULT gen_random_uuid(),  -- "llave" secreta que guarda el celular
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jugadores_nombre_uq ON jugadores (lower(nombre)); -- nombres sin repetir (sin importar mayúsculas)
CREATE UNIQUE INDEX IF NOT EXISTS jugadores_color_uq  ON jugadores (color);         -- colores sin repetir
CREATE UNIQUE INDEX IF NOT EXISTS jugadores_token_uq  ON jugadores (token);

-- Quién reclamó cada país. La llave primaria es el país: un país = un solo dueño.
CREATE TABLE IF NOT EXISTS reclamos (
  iso          CHAR(3)     PRIMARY KEY REFERENCES paises (iso),
  jugador_id   INT         NOT NULL REFERENCES jugadores (id) ON DELETE CASCADE,
  reclamado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reclamos_jugador_idx ON reclamos (jugador_id);

-- Bitácora de lo que pasa. Su id más alto es la "versión" del juego:
-- los celulares preguntan "¿cambió algo desde la versión N?".
CREATE TABLE IF NOT EXISTS eventos (
  id         BIGSERIAL   PRIMARY KEY,
  tipo       VARCHAR(12) NOT NULL CHECK (tipo IN ('registro', 'reclamo', 'liberacion', 'reinicio', 'config')),
  jugador_id INT,
  iso        CHAR(3),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reglas del juego que se pueden cambiar sin tocar el código.
CREATE TABLE IF NOT EXISTS config (
  clave VARCHAR(40)  PRIMARY KEY,
  valor VARCHAR(200) NOT NULL
);
INSERT INTO config (clave, valor) VALUES
  ('max_paises_por_jugador', '5'),
  ('juego_abierto', 'true')
ON CONFLICT (clave) DO NOTHING;

-- ---------- Paleta de 36 colores bien distinguibles sobre el océano oscuro ----------
INSERT INTO colores (hex, nombre, orden) VALUES
  ('#E6194B', 'Rojo', 1),          ('#3CB44B', 'Verde', 2),          ('#FFE119', 'Amarillo', 3),
  ('#4363D8', 'Azul', 4),          ('#F58231', 'Naranja', 5),        ('#911EB4', 'Morado', 6),
  ('#42D4F4', 'Cian', 7),          ('#F032E6', 'Magenta', 8),        ('#BFEF45', 'Lima', 9),
  ('#FABED4', 'Rosa pastel', 10),  ('#469990', 'Verde azulado', 11), ('#DCBEFF', 'Lavanda', 12),
  ('#9A6324', 'Café', 13),         ('#FFFAC8', 'Crema', 14),         ('#800000', 'Granate', 15),
  ('#AAFFC3', 'Menta', 16),        ('#808000', 'Oliva', 17),         ('#FFD8B1', 'Durazno', 18),
  ('#1B2A80', 'Azul marino', 19),  ('#FF6F61', 'Coral', 20),         ('#2E8B57', 'Verde bosque', 21),
  ('#C71585', 'Fucsia', 22),       ('#00CED1', 'Turquesa', 23),      ('#FF8C00', 'Mandarina', 24),
  ('#6A5ACD', 'Azul pizarra', 25), ('#B22222', 'Ladrillo', 26),      ('#20B2AA', 'Aguamarina', 27),
  ('#DAA520', 'Dorado', 28),       ('#8B4513', 'Chocolate', 29),     ('#FF69B4', 'Rosa chicle', 30),
  ('#556B2F', 'Verde militar', 31),('#1E90FF', 'Azul cielo', 32),    ('#9370DB', 'Lila', 33),
  ('#F0E68C', 'Caqui', 34),        ('#CD5C5C', 'Rojo indio', 35),    ('#E0E0E0', 'Plata', 36)
ON CONFLICT (hex) DO NOTHING;

-- ---------- Funciones: la API solo puede llamar a estas ----------
-- SECURITY DEFINER = se ejecutan con los permisos del dueño (postgres), así el usuario
-- de la app (globo_app) no necesita permisos directos sobre las tablas.

-- Versión actual del juego (id del último evento).
CREATE OR REPLACE FUNCTION version_juego() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(max(e.id), 0) FROM eventos e
$$;

-- Todo lo que necesita ver un celular, en un solo JSON.
CREATE OR REPLACE FUNCTION estado_juego() RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT json_build_object(
    'version',   (SELECT coalesce(max(e.id), 0) FROM eventos e),
    'max',       (SELECT c.valor::int FROM config c WHERE c.clave = 'max_paises_por_jugador'),
    'abierto',   (SELECT c.valor = 'true' FROM config c WHERE c.clave = 'juego_abierto'),
    'jugadores', coalesce((
        SELECT json_agg(json_build_object(
                 'id', j.id, 'nombre', j.nombre, 'color', j.color,
                 'paises', (SELECT count(*) FROM reclamos r WHERE r.jugador_id = j.id))
               ORDER BY j.id)
        FROM jugadores j), '[]'::json),
    'reclamos',  coalesce((
        SELECT json_agg(json_build_object('iso', r.iso, 'j', r.jugador_id))
        FROM reclamos r), '[]'::json),
    'ultimos',   coalesce((
        SELECT json_agg(x)
        FROM (SELECT e.id, e.tipo, j.nombre, j.color, e.iso, p.nombre AS pais, e.creado_en
              FROM eventos e
              LEFT JOIN jugadores j ON j.id = e.jugador_id
              LEFT JOIN paises p ON p.iso = e.iso
              ORDER BY e.id DESC
              LIMIT 15) x), '[]'::json)
  )
$$;

-- Paleta con los colores que todavía están libres.
CREATE OR REPLACE FUNCTION colores_disponibles()
RETURNS TABLE (hex TEXT, nombre TEXT, libre BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.hex::text, c.nombre::text,
         NOT EXISTS (SELECT 1 FROM jugadores j WHERE j.color = c.hex)
  FROM colores c
  ORDER BY c.orden
$$;

-- Datos de un jugador a partir de su token (para "recordar" el celular).
CREATE OR REPLACE FUNCTION jugador_por_token(p_token UUID)
RETURNS TABLE (jugador_id INT, jugador_nombre TEXT, jugador_color TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT j.id, j.nombre::text, j.color::text FROM jugadores j WHERE j.token = p_token
$$;

-- Registrar a alguien. Si el nombre o el color ya existen, PostgreSQL lanza
-- unique_violation (23505) y la API lo traduce a "nombre_ocupado" / "color_ocupado".
CREATE OR REPLACE FUNCTION registrar_jugador(p_nombre TEXT, p_color TEXT)
RETURNS TABLE (jugador_id INT, jugador_nombre TEXT, jugador_color TEXT, jugador_token UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v jugadores%ROWTYPE;
BEGIN
  INSERT INTO jugadores (nombre, color)
  VALUES (btrim(p_nombre), upper(btrim(p_color)))
  RETURNING * INTO v;

  INSERT INTO eventos (tipo, jugador_id) VALUES ('registro', v.id);

  RETURN QUERY SELECT v.id, v.nombre::text, v.color::text, v.token;
END
$$;

-- Reclamar un país. Toda la lógica vive en la base para que sea correcta
-- aunque 30 celulares reclamen al mismo tiempo:
--   * FOR UPDATE bloquea la fila del jugador → sus reclamos se procesan uno a la vez.
--   * ON CONFLICT DO NOTHING + llave primaria en reclamos.iso → si dos personas
--     reclaman el mismo país a la vez, solo una gana.
CREATE OR REPLACE FUNCTION reclamar_pais(p_token UUID, p_iso TEXT)
RETURNS TABLE (resultado TEXT, dueno TEXT, dueno_color TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v       jugadores%ROWTYPE;
  v_iso   CHAR(3) := upper(btrim(p_iso));
  v_max   INT;
  v_total INT;
BEGIN
  SELECT * INTO v FROM jugadores WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'jugador_invalido'::text, NULL::text, NULL::text; RETURN;
  END IF;

  IF (SELECT c.valor FROM config c WHERE c.clave = 'juego_abierto') <> 'true' THEN
    RETURN QUERY SELECT 'juego_cerrado'::text, NULL::text, NULL::text; RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM paises p WHERE p.iso = v_iso) THEN
    RETURN QUERY SELECT 'pais_invalido'::text, NULL::text, NULL::text; RETURN;
  END IF;

  SELECT c.valor::int INTO v_max FROM config c WHERE c.clave = 'max_paises_por_jugador';
  SELECT count(*) INTO v_total FROM reclamos r WHERE r.jugador_id = v.id;
  IF v_total >= v_max THEN
    RETURN QUERY SELECT 'limite'::text, NULL::text, NULL::text; RETURN;
  END IF;

  INSERT INTO reclamos (iso, jugador_id) VALUES (v_iso, v.id)
  ON CONFLICT (iso) DO NOTHING;

  IF FOUND THEN
    INSERT INTO eventos (tipo, jugador_id, iso) VALUES ('reclamo', v.id, v_iso);
    RETURN QUERY SELECT 'ok'::text, v.nombre::text, v.color::text;
  ELSE
    RETURN QUERY
      SELECT 'ocupado'::text, j.nombre::text, j.color::text
      FROM reclamos r JOIN jugadores j ON j.id = r.jugador_id
      WHERE r.iso = v_iso;
  END IF;
END
$$;

-- Soltar un país propio para poder reclamar otro.
CREATE OR REPLACE FUNCTION liberar_pais(p_token UUID, p_iso TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id  INT;
  v_iso CHAR(3) := upper(btrim(p_iso));
BEGIN
  SELECT j.id INTO v_id FROM jugadores j WHERE j.token = p_token;
  IF NOT FOUND THEN RETURN 'jugador_invalido'; END IF;

  DELETE FROM reclamos r WHERE r.iso = v_iso AND r.jugador_id = v_id;
  IF FOUND THEN
    INSERT INTO eventos (tipo, jugador_id, iso) VALUES ('liberacion', v_id, v_iso);
    RETURN 'ok';
  END IF;
  RETURN 'no_es_tuyo';
END
$$;

-- Administración (la API la protege con ADMIN_KEY).
CREATE OR REPLACE FUNCTION reiniciar_juego() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  TRUNCATE reclamos, eventos;           -- sin RESTART IDENTITY: los ids siguen creciendo
  DELETE FROM jugadores;
  INSERT INTO eventos (tipo) VALUES ('reinicio');
END
$$;

CREATE OR REPLACE FUNCTION configurar_juego(p_max INT, p_abierto BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_max IS NOT NULL THEN
    UPDATE config SET valor = greatest(1, least(p_max, 50))::text WHERE clave = 'max_paises_por_jugador';
  END IF;
  IF p_abierto IS NOT NULL THEN
    UPDATE config SET valor = p_abierto::text WHERE clave = 'juego_abierto';
  END IF;
  INSERT INTO eventos (tipo) VALUES ('config');
END
$$;
