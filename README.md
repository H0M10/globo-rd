# Globo RDS

Carrera multijugador para la exposición de **Amazon RDS con PostgreSQL**: cada persona entra desde su celular con su nombre y un color único y conquista (o roba) todos los países que pueda en un globo 3D antes de que se acabe el tiempo. Gana quien tenga más países al final. Todo se guarda en **RDS for PostgreSQL**. También funciona en realidad aumentada.

| Pantalla | Dirección |
|---|---|
| Jugar (celulares) | https://h0m10.github.io/globo-rd/ |
| Proyector con QR | https://h0m10.github.io/globo-rd/?proyector |
| Realidad aumentada / virtual | https://h0m10.github.io/globo-rd/vr.html |
| **Administración** (con contraseña) | https://h0m10.github.io/globo-rd/admin/ |

- **Página:** GitHub Pages (carpeta `docs/`)
- **API:** AWS Lambda (carpeta `api/`)
- **Base de datos:** Amazon RDS for PostgreSQL (carpeta `sql/`)
- **Por qué está hecho así y qué problemas resuelve:** ver [PLAN.md](PLAN.md)

```
globo-rds/
├── docs/               ← lo que publica GitHub Pages
│   ├── index.html      ← globo para celular (y ?proyector para la pantalla grande)
│   ├── vr.html         ← modo realidad aumentada / virtual
│   ├── admin/          ← panel de administración con inicio de sesión (rondas, reinicio)
│   ├── js/config.js    ← AQUÍ va la URL de tu Lambda
│   └── data/paises.geojson
├── api/                ← código de la Lambda (NO se publica en Pages)
├── sql/                ← scripts para pgAdmin
└── herramientas/       ← genera el mapa y el SQL de países
```

---

## Paso 1 · Crear las tablas en RDS (pgAdmin)

1. Enciende la base si estaba detenida y espera a que diga **Disponible**.
2. En pgAdmin: **RDS Expo › Databases › escuela › Tools › Query Tool**.
3. Abre y ejecuta **en este orden** (botón de carpeta › elegir archivo › F5):
   1. `sql/01_esquema.sql` → crea tablas, paleta y funciones.
   2. `sql/02_paises.sql` → carga los 177 países.
   3. `sql/03_usuario_app.sql` → **antes de ejecutarlo**, cambia `CAMBIA_ESTA_CONTRASENA` por una contraseña fuerte. Crea el usuario `globo_app`. Anota esa contraseña.
   4. `sql/05_rondas.sql` → **modo carrera**: rondas con cronómetro, países sin límite, robos, nueva paleta y reinicio de contadores.
4. Comprueba: `SELECT count(*) FROM paises;` debe dar **177**, `SELECT count(*) FROM colores;` debe dar **36** y `SELECT fase_ronda();` debe dar **libre**.

## Paso 2 · Probar en tu laptop (opcional, pero recomendado)

1. En la carpeta `api`, copia `.env.example` a `.env` y llénalo: el endpoint de tu base, `PGUSER=globo_app` y la contraseña del paso 1.
2. En PowerShell:
   ```powershell
   cd api
   npm install
   npm run local
   ```
3. Abre **http://localhost:8787**. Para probar en tu celular, conéctalo a la **misma Wi-Fi** y abre la dirección «En tu Wi-Fi» que muestra la terminal. Si Windows pregunta, permite el acceso en **redes privadas**.

## Paso 3 · Crear la API en AWS Lambda

### Opción rápida: AWS CloudShell (un solo script)
1. Empaqueta el código: `cd api` y `npm run zip`.
2. En la consola de AWS, con la región **Virginia del Norte (us-east-1)**, abre **CloudShell** (ícono `>_` en la barra de arriba).
3. **Acciones › Cargar archivo**: sube `api\function.zip`. Repite y sube `api\desplegar-cloudshell.sh`.
4. Escribe `bash desplegar-cloudshell.sh` y presiona Enter. Al final muestra la URL de la función.

> **Para actualizar la API** después de cambiar el código: repite los pasos 1 a 4. Si CloudShell pregunta si reemplazar los archivos, di que sí. El script detecta que la función ya existe y solo sube el código nuevo; la URL no cambia.

### Opción manual: desde la consola de Lambda
1. Empaqueta el código:
   ```powershell
   cd api
   npm run zip
   ```
   Se crea `api\function.zip`.
2. En la consola de AWS, región **Virginia del Norte (us-east-1)**, la misma de la base: busca **Lambda** › **Crear una función**.
   - **Crear desde cero**
   - Nombre: `globo-rds-api`
   - Tiempo de ejecución: **Node.js 22.x** (o el más nuevo que aparezca)
   - Arquitectura: **arm64**
   - **Crear función**
3. Pestaña **Código** › **Cargar desde** › **Archivo .zip** › elige `function.zip` › **Guardar**.
4. Pestaña **Configuración** › **Variables de entorno** › **Editar** › agrega:

   | Clave | Valor |
   |---|---|
   | `PGHOST` | tu endpoint (`bd-expo-postgres.xxxx.us-east-1.rds.amazonaws.com`) |
   | `PGPORT` | `5432` |
   | `PGDATABASE` | `escuela` |
   | `PGUSER` | `globo_app` |
   | `PGPASSWORD` | la contraseña de `globo_app` |
   | `ADMIN_KEY` | una clave tuya (8+ caracteres) para `admin.html` |
   | `ALLOWED_ORIGIN` | `https://h0m10.github.io` |

5. **Configuración** › **Configuración general** › **Editar**: memoria **256 MB**, tiempo de espera **10 s**.
6. **Configuración** › **URL de función** › **Crear URL de función**:
   - Tipo de autenticación: **NONE**
   - **No** actives «Configurar el uso compartido de recursos entre orígenes (CORS)»: el código ya lo maneja.
   - **Guardar** y copia la URL (termina en `.lambda-url.us-east-1.on.aws/`).
7. Prueba: abre en el navegador `TU-URL/salud`. Debe responder algo como `{"ok":true,...}`.

> La Lambda está **fuera de la VPC** y se conecta a la IP pública de la base. Por eso el security group de RDS necesita permitir el puerto 5432 desde cualquier IP (`0.0.0.0/0`), como ya lo tienes.

## Paso 4 · Conectar la página con la API

Edita `docs/js/config.js` y pega tu URL:
```js
API_URL: 'https://xxxxxxxx.lambda-url.us-east-1.on.aws',
```

## Paso 5 · Publicar en GitHub Pages

1. En GitHub crea un repositorio **público** llamado `globo-rd`, **vacío** (sin README, sin .gitignore, sin licencia).
2. Sube esta carpeta. Desde PowerShell, en la carpeta `globo-rds`:
   ```powershell
   git init
   git add .
   git commit -m "Globo RDS"
   git branch -M main
   git remote add origin https://github.com/h0m10/globo-rd.git
   git push -u origin main
   ```
   Revisa que **no** se suba `api/.env` (el `.gitignore` lo evita).
3. En GitHub: **Settings › Pages › Build and deployment** › Source: **Deploy from a branch** › Branch: **main** y carpeta **/docs** › **Save**.
4. En 1–2 minutos estará en **https://h0m10.github.io/globo-rd/**.
5. La Lambda ya tiene `ALLOWED_ORIGIN=https://h0m10.github.io`, así que no hay que cambiar nada.

## Paso 6 · El día de la exposición

1. Enciende la base de RDS 15 minutos antes.
2. Entra a **/admin/** con tu contraseña (`ADMIN_KEY`) y pulsa **Reiniciar juego**: borra todo y regresa los contadores a 1.
3. En la computadora del proyector abre **?proyector**: muestra el globo, el QR, el cronómetro, el marcador y los últimos movimientos.
4. Tus compañeros escanean el QR, escriben su nombre y eligen color. Mientras tanto el juego está en **modo libre** para practicar.
5. En **/admin/**, pulsa **Iniciar ronda** (3 minutos, por ejemplo). El mapa queda en blanco, arranca el cronómetro en todos los celulares y gana quien tenga más países al final.
6. En pgAdmin muestra las consultas de `sql/04_consultas_demo.sql` y la vista `SELECT * FROM ranking;` mientras juegan.
7. Al terminar: detén o borra la base.

---

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| «Falta configurar la URL de la API» | `config.js` sin tu URL | Paso 4 |
| `/salud` responde `base_no_disponible` | Base detenida, contraseña mal o security group | Revisa que la base esté **Disponible**, las variables de entorno y la regla 5432 |
| `/salud` responde `Forbidden` (403) | La URL de función no tiene permiso público | Lambda › Configuración › Permisos › la política debe permitir `lambda:InvokeFunctionUrl` y `lambda:InvokeFunction` a `*`; si no, borra y vuelve a crear la URL de función con autenticación NONE |
| Error de CORS en la consola del navegador | `ALLOWED_ORIGIN` no coincide | Usa exactamente `https://TU-USUARIO.github.io` (sin `/` al final) o `*` |
| El globo se ve pero no aparecen colores | La API no responde | Revisa el punto de conexión arriba a la derecha |
| En VR no aparecen los botones | El dispositivo no soporta WebXR | Normal en iPhone; usa la vista 3D |
| La página no se actualiza tras cambiar algo en GitHub | Caché del navegador | Recarga forzada o espera unos minutos |

## Regenerar el mapa (solo si cambias los nombres)
```powershell
node herramientas/preparar-datos.mjs
```
Vuelve a crear `docs/data/paises.geojson` y `sql/02_paises.sql`.

---

Mapa: [Natural Earth](https://www.naturalearthdata.com/) (dominio público). Globo: [globe.gl](https://github.com/vasturiano/globe.gl) y [three-globe](https://github.com/vasturiano/three-globe) (MIT).
