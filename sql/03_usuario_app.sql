-- =====================================================================
-- 03 · Usuario de la aplicación con privilegios mínimos
-- Ejecutar como postgres DESPUÉS de 01 y 02.
-- 1) Cambia CAMBIA_ESTA_CONTRASENA por una contraseña fuerte (sin comillas simples).
-- 2) Usa ese usuario y contraseña en las variables de entorno de la Lambda.
-- La app NO puede leer ni modificar tablas directamente: solo ejecutar funciones.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'globo_app') THEN
    CREATE ROLE globo_app LOGIN PASSWORD 'CAMBIA_ESTA_CONTRASENA';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE escuela TO globo_app;
GRANT USAGE ON SCHEMA public TO globo_app;

-- Por defecto cualquiera puede ejecutar funciones; se lo quitamos a PUBLIC…
REVOKE EXECUTE ON FUNCTION
  version_juego(), estado_juego(), colores_disponibles(), jugador_por_token(uuid),
  registrar_jugador(text, text), reclamar_pais(uuid, text), liberar_pais(uuid, text),
  reiniciar_juego(), configurar_juego(int, boolean)
FROM PUBLIC;

-- …y se lo damos solo a la app.
GRANT EXECUTE ON FUNCTION
  version_juego(), estado_juego(), colores_disponibles(), jugador_por_token(uuid),
  registrar_jugador(text, text), reclamar_pais(uuid, text), liberar_pais(uuid, text),
  reiniciar_juego(), configurar_juego(int, boolean)
TO globo_app;

-- Comprobación: debe decir false en las tablas y true en las funciones.
SELECT 'tabla jugadores' AS objeto, has_table_privilege('globo_app', 'jugadores', 'SELECT') AS puede
UNION ALL
SELECT 'función reclamar_pais', has_function_privilege('globo_app', 'reclamar_pais(uuid, text)', 'EXECUTE');
