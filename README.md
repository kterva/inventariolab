# Inventario Laboratorio 📦

🌐 [English](README.en.md) · **Español**

Gestor de inventario de código abierto para los laboratorios de Educación Media de Uruguay y Latinoamérica. Cada centro usa **su propia planilla de Google Sheets** como base de datos, y la aplicación agrega búsqueda, vista por armario con códigos QR, fotos, reportes de incidencias e historial de cambios.

Instancia pública: <https://culturalibre.uy/inventariolab> · [Política de privacidad](https://culturalibre.uy/inventariolab/privacidad)

## Cómo funciona

```
Navegador ──► Cloudflare ──► nginx ──► Node.js/Express (PM2)
                                          │  caché en memoria (30 s)
                                          ▼
                         Google Sheets (planilla de cada liceo)
                         Google Drive  (fotos, en el Drive de un admin)
```

- Cada laboratorio se identifica por el **ID de su planilla**: `/inventariolab/lab/<ID>`.
- **Laboratorios propios (recomendado):** cada docente toca «Crear mi laboratorio» (o «Importar mi planilla») y la app crea la planilla y la carpeta de fotos en **su** Google Drive con el permiso `drive.file`; el refresh token queda en `drive-tokens/<ID>.json` (modo 600). «Exportar mis datos» baja la planilla en `.xlsx` y las fotos en un ZIP. Detalles y diseño en [`docs/laboratorios-propios.md`](docs/laboratorios-propios.md); guía para docentes en [`docs/guia-docentes.md`](docs/guia-docentes.md).
- **Laboratorios con cuenta de servicio (versión anterior, siguen funcionando):** la app accede a la planilla con una **cuenta de servicio** de Google. El liceo comparte su planilla con el email de esa cuenta como **Editor**; la portada y la pantalla de error muestran cuál es.
- Los usuarios inician sesión con **Google OAuth** (solo nombre y email).
- Las **fotos las sube un administrador con su propia cuenta** (OAuth, alcance `drive.file`), no la cuenta de servicio: las cuentas de servicio no tienen cuota de almacenamiento en Drive y Google no las deja ser dueñas de archivos. Un admin toca "Autorizar Drive" una vez en el panel; las fotos van a la carpeta `LAB_FOTOS (InventarioLab)` de su Drive.
- La **búsqueda por foto** corre en el propio servidor (sin servicios externos): compara la foto con las de los artículos mediante embeddings de imagen.

### La planilla

| Hoja | Contenido |
|---|---|
| `config` | Columnas A/B: email y rol de cada usuario. Columnas D/E: parámetros clave/valor (`institucion`, `laboratorio`, `acceso publico`, `modo demo`, `demo rol`). |
| `INVENTARIO` | Desde la fila 3: artículo (A), cantidades bien/regular/roto/total (C–F), observaciones (G), zona (H), fecha (I), historial anterior (J, ya no lo escribe la app), último reporte (K), foto (N), **ID** (O). |
| `HISTORIAL` | Una fila por cada cambio hecho desde la app: fecha, ID y nombre del artículo, usuario, acción (`REPORTE`, `MOVIDO`, `FOTO`) y detalle. |
| `ubicaciones` | ID, nombre y descripción de cada zona/armario. |
| `IMPRIMIR_QR` | La genera la app con las etiquetas QR de las zonas. |

La primera vez que la app abre una planilla agrega lo que falte: la columna `ID` (O) de `INVENTARIO` con un ID fijo para cada artículo (`A0001`, `A0002`, …) y la hoja `HISTORIAL`. Los artículos nuevos cargados a mano reciben su ID en la próxima lectura (como mucho 30 s después), y una fila copiada y pegada recibe uno nuevo. La app escribe siempre por ID y no por número de fila, así que se puede ordenar, insertar o borrar filas sin que un cambio caiga en otro artículo. **No hay que editar ni borrar la columna `ID`:** la app la protege en modo "solo advertencia", así que quien tenga acceso a la planilla (los administradores) ve un aviso antes de modificarla, sin que se bloquee ordenar, insertar o borrar filas.

### Roles (columna B de `config`)

| Rol | Buscar y ver armarios | Reportar incidencias | Fotos, mover, zonas, QR |
|---|:-:|:-:|:-:|
| `ADMIN` | ✅ | ✅ | ✅ |
| `USER`, `LECTOR` o cualquier otro valor | ✅ | ✅ | ❌ |
| `VISOR` (solo lectura) | ✅ | ❌ | ❌ |

Quien no figure en `config` no entra. Con `acceso publico = SI`, cualquiera puede ver un armario escaneando su QR, sin iniciar sesión y sin poder buscar ni reportar.

## Puesta en marcha

Requiere Node.js 20 o superior.

```bash
npm install
cp .env.example .env   # completar los valores
npm start              # o: npm run dev
```

### Variables de entorno

| Variable | Para qué |
|---|---|
| `PORT`, `NODE_ENV` | Puerto y entorno (`production` en el servidor). |
| `APP_BASE_URL` | URL pública; arma la URL de retorno del login y los enlaces de los QR. |
| `SESSION_SECRET` | Firma las cookies de sesión. **Obligatorio en producción**: mínimo 32 caracteres y distinto del de ejemplo; si no, la app no arranca. Generar con `openssl rand -hex 32`. |
| `SESSIONS_DIR` | Carpeta de las sesiones (por defecto `./sessions`). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Clave JSON de la cuenta de servicio, en una sola línea y entre comillas simples. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Cliente OAuth web para el login. |
| `BUSQUEDAS_LOG_DIR` | Dónde se anotan las búsquedas por foto (por defecto `./logs-busquedas`, `busquedas.jsonl`, anónimo: sin email ni imagen; se rota a los 5 MB). Sirve para medir aciertos y afinar el umbral. |
| `AVISO_BUSQUEDAS_MINIMO` | Búsquedas con elección a partir de las cuales los admins ven el aviso "ya se puede verificar" (por defecto 50). Se mide con `npm run medir-busquedas`. |
| `DRIVE_TOKENS_DIR` | Dónde se guarda el permiso de Drive de los admins (por defecto `./drive-tokens`, modo 700/600, ignorada por git). |
| `SHEETS_CACHE_TTL_MS` | Cuánto se reutiliza una lectura de la planilla (por defecto 30000). |
| `SHEETS_CACHE_STALE_MAX_MS` | Si Google falla por cuota o red, hasta qué antigüedad se sirve la última copia buena (por defecto 600000). |
| `GOOGLE_REINTENTOS`, `GOOGLE_BACKOFF_MS` | Reintentos de las escrituras ante 429/5xx o errores de red (por defecto 3, con espera inicial de 500 ms que se duplica en cada intento). Las lecturas ya las reintenta la librería `googleapis`. |

### Configurar Google Cloud

Para una instalación completa, paso a paso, ver [`docs/instalacion-propia.md`](docs/instalacion-propia.md). Para que un docente use su propio laboratorio, [`docs/guia-docentes.md`](docs/guia-docentes.md) (borrador) y el diseño en [`docs/laboratorios-propios.md`](docs/laboratorios-propios.md).

1. Crear un proyecto y habilitar **Google Sheets API** y **Google Drive API**.
2. Crear una **cuenta de servicio** sin roles en el proyecto y una **clave JSON**; cargarla en `GOOGLE_SERVICE_ACCOUNT_JSON`. Se usa para leer y escribir las planillas, **no para guardar fotos**.
3. En **Google Auth Platform**: completar la marca (página principal, política de privacidad, dominio autorizado; **sin logo**, para no requerir verificación), crear un **cliente OAuth web** y **publicar la app** ("En producción"; en "Testing" el permiso de Drive de los admins caduca a los 7 días y las subidas de fotos vuelven a fallar). Registrar **dos URI de redirección**:
   - `<APP_BASE_URL>/inventariolab/auth/google/callback` (login);
   - `<APP_BASE_URL>/inventariolab/auth/drive/callback` (autorización de Drive para guardar fotos).

   Como solo se piden nombre y email (login) y el alcance `drive.file` (archivos creados por la propia app), no hace falta verificación de Google.
4. Compartir cada planilla con el email de la cuenta de servicio como **Editor**.
5. Un administrador del laboratorio entra a la app y toca **"Autorizar Drive para guardar fotos"** (una sola vez por laboratorio). Sin este paso todo funciona salvo guardar fotos nuevas, y la app avisa "Un admin debe autorizar Drive".

Las claves nunca van al repositorio: `.gitignore` excluye `.env`, las claves de cuentas de servicio y los `client_secret*.json`.

## Pruebas

```bash
npm test
```

No llaman a Google: `tests/fake-googleapis.js` simula la API.

- `cache.test.js`: caché, invalidación, errores de Google y roles.
- `escrituras.test.js`: IDs fijos, hoja `HISTORIAL`, escrituras tras reordenar filas, reportes simultáneos y reintentos.
- `escapado.test.js`: renderiza las vistas con datos maliciosos y verifica que se muestren como texto.
- `servidor.test.js`: levanta el servidor real y prueba cada rol (vía modo demo), la persistencia de sesiones y el flujo de autorización de Drive.
- `busquedaFoto.test.js`: índice de embeddings (con un "modelo" falso), persistencia, cola, límite por usuario y descarga solo desde hosts de Google.
- `driveUsuario.test.js`: permiso de Drive de los admins (guardado con modo 600, estado, errores) y subida de fotos con él.

## Despliegue

El servidor de producción es un checkout de la rama `nodejs-saas` gestionado con PM2:

```bash
git pull --ff-only
npm install            # solo si cambió package.json
pm2 restart inventariolab --update-env
```

Las sesiones se guardan en archivos, así que reiniciar no cierra la sesión de los usuarios. Cambiar `SESSION_SECRET` sí las invalida todas.

Estas carpetas del servidor **se conservan entre despliegues** y no están en el repo: `sessions/`, `drive-tokens/` (permiso de Drive de los admins; si se pierde, un admin vuelve a tocar "Autorizar Drive") y `embeddings/` (índice de la búsqueda por foto; se regenera solo). La primera búsqueda por foto de un laboratorio descarga el modelo y calcula todos los embeddings (del orden de un minuto en un VPS chico); conviene precalentarla tras el primer despliegue.

## Estructura

| Archivo | Rol |
|---|---|
| `server.js` | Rutas, autenticación, roles y sesiones. |
| `googleClient.js` | Acceso a Sheets y Drive, caché de lectura y permisos. |
| `sessionStore.js` | Almacén de sesiones en archivos. |
| `driveUsuario.js` | Autorización de Drive con la cuenta de un admin (OAuth, alcance `drive.file`): con ella se suben las fotos. |
| `busquedaFoto.js` | Búsqueda por foto: embeddings de imagen (DINOv2-small, local), índice por laboratorio, cola y límite por usuario. |
| `qrPdf.js` | PDF A4 con las etiquetas QR de los armarios elegidos (8 por hoja), con QR vectoriales generados localmente. |
| `views/*.ejs` | Vistas (portada, login, dashboard, armario, ayuda, privacidad). |
| `public/` | PWA: manifest, service worker e íconos. |
| `WebApp.js`, `Index.html`, `Gatillos.js`, `GenerarQR_PRO.js`, `Gestion_Incidencias.js`, `Recuperar_reportes.js`, `appsscript.json`, `.clasp.json` | **Versión 1.x (Google Apps Script)**, conservada como referencia; la app de Node no los usa. |

## Historia y evolución

### Versión 2.3.1 (20 de noviembre de 2026)
- **PDF de QR:** nuevo maquetado de las etiquetas: QR centrado y más grande, nombre del armario en hasta dos líneas en la cabecera y descripción debajo solo si existe. Se quitó la leyenda «Escaneá el código…».

### Versión 2.3.0 (20 de noviembre de 2026)
- **PDF de QR para imprimir:** desde «Impresión de QRs y Gestión de Zonas», el botón «📄 PDF para imprimir (A4)» arma un PDF con 8 etiquetas por hoja, listas para recortar, de los armarios marcados: uno, varios o todos. Los QR se dibujan en el servidor (bibliotecas `pdfkit` y `qrcode`), sin enviar los enlaces a servicios externos. El envío a la hoja `IMPRIMIR_QR` sigue disponible.

### Versión 2.2.1 (20 de noviembre de 2026)
- **Corrección:** la página principal se veía desarmada (botones y textos en columnas sueltas) por un `</div>` de más que cerraba la tarjeta antes de tiempo.
- **Versionado:** el número del pie de página sale ahora de `package.json` (antes estaba escrito a mano en dos vistas).

### Versión 2.2 (18-19 de noviembre de 2026)
- **Laboratorios propios:** el botón «Crear mi laboratorio» crea la planilla y la carpeta de fotos en el Drive del docente y lo deja como administrador. Cada laboratorio usa sus propias credenciales de Google (permiso de su dueño o cuenta de servicio) y la app avisa con claridad si el permiso se revoca.
- **Importar una planilla existente:** selector de Google, elección de columnas y copia a un laboratorio nuevo, sin tocar la original.
- **Exportar:** la planilla (`.xlsx`) y las fotos (ZIP).
- **Protección contra bots** al crear laboratorios (token firmado, campo trampa, topes por IP, correo, día y total, Turnstile opcional) y aviso por correo al administrador.
- **Registro anónimo de búsquedas por foto**, con aviso a los admins cuando hay casos suficientes para verificar el umbral.
- La app pasa a llamarse **«Inventario Laboratorio»**; licencia GPL-3.0-or-later; README en inglés y guías para docentes y de instalación propia.

### Versión 2.1 (17-18 de noviembre de 2026)
- **Rendimiento:** cliente único de Google y caché de lectura por planilla. Abrir un armario pasó de ~2,8 s de consultas a Google a ~1 ms con la caché caliente, y se reduce el riesgo de agotar la cuota de la API.
- **Seguridad:**
  - escapado de todos los datos de la planilla y de los usuarios al armar el HTML;
  - `SESSION_SECRET` obligatorio en producción;
  - cookies `httpOnly` y `Secure` (detrás de HTTPS).
- **Roles:** nuevo rol `VISOR` de solo lectura.
- **Sesiones persistentes:** se guardan en archivos y sobreviven a reinicios y despliegues.
- **Privacidad:** página `/inventariolab/privacidad`; la app OAuth está publicada, así que cualquier cuenta de Google puede iniciar sesión y el acceso lo decide solo la hoja `config`.
- **Operación:**
  - migración a un proyecto propio de Google Cloud (cuenta de servicio y cliente OAuth nuevos);
  - el email de la cuenta de servicio se toma de la credencial configurada;
  - pruebas automatizadas con `npm test`.
- **Búsqueda por foto:** desde el dashboard, "📸 Buscar por foto" compara una foto con las fotos guardadas de los artículos y muestra los 3 más parecidos (con enlace al armario), o "Parece ser…" si la similitud supera 0,6. "Ninguno de estos" lleva a la búsqueda por texto y, si es admin, permite guardarle la foto al artículo. Usa DINOv2-small cuantizado con `@huggingface/transformers`, sin servicios externos; los embeddings se guardan en `embeddings/` y se recalculan solos al cambiar una foto. Una búsqueda a la vez, 2 hilos y 10 búsquedas por minuto por usuario. Solo reconoce artículos que ya tienen foto. En una medición con 10 fotos nuevas acertó el artículo entre los 3 primeros en 8.
- **Subida de fotos con la cuenta de un admin:** las cuentas de servicio no tienen cuota en Drive y Google no las deja ser dueñas de archivos, así que las fotos las sube un admin con su propio permiso (alcance mínimo `drive.file`). Un admin toca "Autorizar Drive" en el panel una sola vez; el permiso se guarda en `DRIVE_TOKENS_DIR`. Las fotos nuevas van a la carpeta `LAB_FOTOS (InventarioLab)` del Drive de esa cuenta. Requiere registrar `<APP_BASE_URL>/inventariolab/auth/drive/callback` como URI de redirección del cliente OAuth y que la pantalla de consentimiento esté "En producción" (en "Testing" el permiso caduca a los 7 días).
- **Escrituras robustas:**
  - ID fijo por artículo (columna O) en lugar del número de fila;
  - historial en la hoja `HISTORIAL`, una fila por evento, sin límite de tamaño ni escrituras que se pisen;
  - reintentos con espera creciente ante 429/5xx;
  - la carpeta `LAB_FOTOS` se busca una sola vez por planilla;
  - las fechas se registran en hora de Uruguay aunque el servidor esté en UTC;
  - corregido el botón "Reportar" del armario, que no encontraba el texto escrito.

### Versión 2.0 (Node.js + VPS)
Reescritura sobre **Node.js + Express** para resolver los límites de velocidad y concurrencia de Apps Script, manteniendo Google Sheets como base de datos. Login con Google OAuth y roles; PWA instalable en Android e iOS.

### Versión 1.x (Google Apps Script)
Desarrollada 100 % sobre Google Apps Script, que servía el HTML y usaba la planilla como base de datos. Era fácil de instalar, pero lenta y con fallos por cuotas cuando varios docentes escaneaban QR o subían fotos a la vez.

## Lecciones aprendidas

- **Una función migrada no está terminada hasta probarla de punta a punta.** La subida de fotos se reescribió al pasar a Node pero nunca se probó con éxito: hasta entonces las fotos las subía el Apps Script con la cuenta del docente. Falló recién cuando alguien la usó. Al migrar, listar todo lo que hacía la versión anterior y probar cada cosa en producción.
- **Las cuentas de servicio no tienen cuota en Drive** (error `Service Accounts do not have storage quota`). Compartirles una carpeta no alcanza: el archivo sigue siendo suyo. Opciones: unidades compartidas (solo Google Workspace) o subir con OAuth de un usuario. El alcance `drive.file` limita el permiso a los archivos que crea la propia app.
- **Un error de Google no siempre es lo que dice el código.** Conviene reproducirlo contra la API con una consulta mínima (subir un archivo de prueba, listar permisos, leer `storageQuota`) antes de cambiar código.
- **Mirar los datos antes de suponer.** Quién creó y modificó cada foto (`owners`, `lastModifyingUser`) mostró que ninguna la había subido la cuenta de servicio; los nombres de archivo no sirven, porque Node y Apps Script usaban el mismo formato.
- **Medir antes de implementar.** La búsqueda por foto se eligió comparando modelos sobre fotos reales de los usuarios; los resultados iniciales de modelos grandes eran engañosos por una cuantización y un agrupamiento mal elegidos. Las pruebas "foto del mismo artículo" tienen que usar fotos nuevas, no las guardadas.
- **No poner datos de operación ni fotos de prueba en un repo público.** Las fotos de prueba se excluyen con `.git/info/exclude`, y los tokens y embeddings con `.gitignore`.
- **Los permisos de OAuth en modo "Testing" caducan a los 7 días.** Publicar la app antes de depender de refresh tokens.
- **En una migración de propiedad de una planilla con Apps Script ligado, no hacer una copia**: la copia crea un script nuevo con implementaciones nuevas y rompe los QR impresos. Transferir la propiedad conserva los IDs.

## Pendientes conocidos

- Cada laboratorio nuevo necesita que un administrador autorice Drive una vez. Las fotos quedan en el Drive de esa cuenta.
- La búsqueda por foto solo reconoce artículos que ya tienen foto, y su acierto se midió con pocas fotos (8 de 10 entre los 3 primeros). Conviene volver a medir con más fotos.
- La vista del armario muestra el último evento de `HISTORIAL`; las ediciones hechas a mano en la planilla siguen yendo a la columna J (si la planilla tiene el script de Apps Script) y solo se muestran cuando el artículo no tiene eventos en `HISTORIAL`.
- **Materiales sin foto:** agregar filtro por armario y exportación a ODS o PDF.
- **Exportaciones de planillas:** siempre en formatos abiertos: ODS, o CSV como alternativa; nunca XLS/XLSX.
- **Explorar por armarios:** los enlaces no muestran el puntero de manito al pasar el mouse (sí lo hacen en otras vistas); revisar el CSS.

## Licencia

Software libre bajo la **Licencia Pública General GNU, versión 3 o posterior** (GPL-3.0-or-later). Ver [LICENSE](LICENSE). Las bibliotecas y datos de terceros incluidos conservan su propia licencia.
