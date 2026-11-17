# InventarioLab 📦

Gestor de inventario de código abierto para los laboratorios de Educación Media de Uruguay y Latinoamérica. Cada centro usa **su propia planilla de Google Sheets** como base de datos, y la aplicación agrega búsqueda, vista por armario con códigos QR, fotos, reportes de incidencias e historial de cambios.

Instancia pública: <https://culturalibre.edu.uy/inventariolab> · [Política de privacidad](https://culturalibre.edu.uy/inventariolab/privacidad)

## Cómo funciona

```
Navegador ──► Cloudflare ──► nginx ──► Node.js/Express (PM2)
                                          │  caché en memoria (30 s)
                                          ▼
                         Google Sheets (planilla de cada liceo)
                         Google Drive  (carpeta LAB_FOTOS)
```

- Cada laboratorio se identifica por el **ID de su planilla**: `/inventariolab/lab/<ID>`.
- La app accede a las planillas con una **cuenta de servicio** de Google. Cada liceo comparte su planilla con el email de esa cuenta como **Editor**; la portada y la pantalla de error muestran cuál es.
- Los usuarios inician sesión con **Google OAuth** (solo nombre y email).

### La planilla

| Hoja | Contenido |
|---|---|
| `config` | Columnas A/B: email y rol de cada usuario. Columnas D/E: parámetros clave/valor (`institucion`, `laboratorio`, `acceso publico`, `modo demo`, `demo rol`). |
| `INVENTARIO` | Desde la fila 3: artículo (A), cantidades bien/regular/roto/total (C–F), observaciones (G), zona (H), fecha (I), historial (J), último reporte (K), foto (N). |
| `ubicaciones` | ID, nombre y descripción de cada zona/armario. |
| `IMPRIMIR_QR` | La genera la app con las etiquetas QR de las zonas. |

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
| `SHEETS_CACHE_TTL_MS` | Cuánto se reutiliza una lectura de la planilla (por defecto 30000). |
| `SHEETS_CACHE_STALE_MAX_MS` | Si Google falla por cuota o red, hasta qué antigüedad se sirve la última copia buena (por defecto 600000). |

### Configurar Google Cloud

1. Crear un proyecto y habilitar **Google Sheets API** y **Google Drive API**.
2. Crear una **cuenta de servicio** sin roles en el proyecto y una **clave JSON**; cargarla en `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. En **Google Auth Platform**: completar la marca (página principal, política de privacidad, dominio autorizado; **sin logo**, para no requerir verificación), crear un **cliente OAuth web** con la URI de redirección `<APP_BASE_URL>/inventariolab/auth/google/callback` y **publicar la app**. Como solo pide nombre y email, no necesita verificación de Google.
4. Compartir cada planilla con el email de la cuenta de servicio como **Editor**.

Las claves nunca van al repositorio: `.gitignore` excluye `.env`, las claves de cuentas de servicio y los `client_secret*.json`.

## Pruebas

```bash
npm test
```

No llaman a Google: `tests/fake-googleapis.js` simula la API.

- `cache.test.js`: caché, invalidación, errores de Google y roles.
- `escapado.test.js`: renderiza las vistas con datos maliciosos y verifica que se muestren como texto.
- `servidor.test.js`: levanta el servidor real y prueba cada rol (vía modo demo) y la persistencia de sesiones.

## Despliegue

El servidor de producción es un checkout de la rama `nodejs-saas` gestionado con PM2:

```bash
git pull --ff-only
npm install            # solo si cambió package.json
pm2 restart inventariolab --update-env
```

Las sesiones se guardan en archivos, así que reiniciar no cierra la sesión de los usuarios. Cambiar `SESSION_SECRET` sí las invalida todas.

## Estructura

| Archivo | Rol |
|---|---|
| `server.js` | Rutas, autenticación, roles y sesiones. |
| `googleClient.js` | Acceso a Sheets y Drive, caché de lectura y permisos. |
| `sessionStore.js` | Almacén de sesiones en archivos. |
| `views/*.ejs` | Vistas (portada, login, dashboard, armario, ayuda, privacidad). |
| `public/` | PWA: manifest, service worker e íconos. |
| `WebApp.js`, `Index.html`, `Gatillos.js`, `GenerarQR_PRO.js`, `Gestion_Incidencias.js`, `Recuperar_reportes.js`, `appsscript.json`, `.clasp.json` | **Versión 1.x (Google Apps Script)**, conservada como referencia; la app de Node no los usa. |

## Historia y evolución

### Versión 2.1 (noviembre 2026)
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

### Versión 2.0 (Node.js + VPS)
Reescritura sobre **Node.js + Express** para resolver los límites de velocidad y concurrencia de Apps Script, manteniendo Google Sheets como base de datos. Login con Google OAuth y roles; PWA instalable en Android e iOS.

### Versión 1.x (Google Apps Script)
Desarrollada 100 % sobre Google Apps Script, que servía el HTML y usaba la planilla como base de datos. Era fácil de instalar, pero lenta y con fallos por cuotas cuando varios docentes escaneaban QR o subían fotos a la vez.

## Pendientes conocidos

- Las escrituras identifican los artículos por **número de fila**: si alguien ordena o inserta filas en la planilla mientras otra persona trabaja en la app, un cambio puede ir al artículo equivocado. Conviene un ID fijo por artículo.
- El historial se guarda en una sola celda (columna J), que admite como máximo 50.000 caracteres, y dos escrituras simultáneas pueden pisarse. Conviene una hoja `HISTORIAL` donde cada entrada sea una fila nueva.
- No hay reintentos automáticos ante errores 429/5xx de Google en las escrituras.
- La carpeta `LAB_FOTOS` se busca en Drive en cada subida de foto.
