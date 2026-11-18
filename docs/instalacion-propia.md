# Instalar tu propio servidor de InventarioLab

Para un centro, una inspección o una comunidad que quiera **tener su propia instancia** y no depender de otro servidor. Lleva entre 1 y 2 horas y requiere comodidad con una terminal; si solo quieres usar InventarioLab, lee [`guia-docentes.md`](guia-docentes.md).

> **Estado:** estos pasos describen la instalación que funciona hoy (planillas compartidas con una cuenta de servicio). Cuando se implemente el modo "laboratorio propio" (ver [`laboratorios-propios.md`](laboratorios-propios.md)), el paso 3 de Google Cloud (cuenta de servicio) dejará de ser obligatorio. No hay todavía imagen de Docker.

## Qué vas a necesitar

- Un servidor Linux (un VPS pequeño alcanza) con **Node.js 20 o superior**, **nginx** y un **dominio con HTTPS** (Google exige HTTPS para el inicio de sesión fuera de `localhost`).
- Una cuenta de Google para crear el proyecto de Google Cloud.
- Si usas la búsqueda por foto: memoria y CPU para cargar un modelo pequeño de imágenes. Una instalación en un VPS chico tarda alrededor de un minuto en indexar un centenar de fotos la primera vez.

> La aplicación se sirve en la subruta **`/inventariolab`** (por ejemplo `https://tu-dominio.edu.uy/inventariolab`). Está fija en el código.

## Paso 1. Descargar el código

```bash
git clone https://github.com/kterva/inventariolab.git /opt/inventariolab
cd /opt/inventariolab
git checkout nodejs-saas
npm ci --omit=dev
```

Comprobación: `node -v` muestra v20 o superior y `npm ci` termina sin errores.

## Paso 2. Crear el proyecto de Google Cloud

En https://console.cloud.google.com:

1. Crea un proyecto nuevo (por ejemplo "Inventario de laboratorio").
2. En **APIs y servicios → Biblioteca**, habilita **Google Sheets API** y **Google Drive API**.

## Paso 3. Cuenta de servicio (lee y escribe las planillas)

1. En **IAM y administración → Cuentas de servicio**, crea una cuenta **sin roles**.
2. Entra en ella → **Claves → Agregar clave → JSON**. Se descarga un archivo.
3. Guárdalo fuera del repo (por ejemplo en `/root/secretos/`). **Nunca** lo subas a git.
4. Anota su correo (termina en `…iam.gserviceaccount.com`): lo usarás para compartir las planillas.

## Paso 4. Cliente OAuth (inicio de sesión y permiso para las fotos)

En **Google Auth Platform**:

1. **Información de la marca:** nombre de la aplicación, correo de contacto, página principal, **enlace a la política de privacidad** (`https://tu-dominio.edu.uy/inventariolab/privacidad`) y a las condiciones, y tu dominio en "Dominios autorizados". **No pongas logo**: así no se pide verificación.
2. **Clientes → Crear cliente → Aplicación web.** En **URIs de redireccionamiento autorizados** agrega las dos:
   - `https://tu-dominio.edu.uy/inventariolab/auth/google/callback`
   - `https://tu-dominio.edu.uy/inventariolab/auth/drive/callback`
3. Copia el **ID de cliente** y el **secreto**.
4. **Público → Publicar aplicación** (estado **"En producción"**). Si queda en "Testing", el permiso de Drive de los administradores caduca a los 7 días y las fotos dejan de guardarse.

La aplicación solo pide nombre y correo (inicio de sesión) y el alcance `drive.file` (archivos que ella misma crea), por lo que no hace falta que Google la verifique.

## Paso 5. Configurar la aplicación

```bash
cp .env.example .env
chmod 600 .env
```

Edita `.env`:

| Variable | Qué poner |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `APP_BASE_URL` | `https://tu-dominio.edu.uy` (sin barra final) |
| `SESSION_SECRET` | el resultado de `openssl rand -hex 32` (**obligatorio**: sin él la aplicación no arranca) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | el contenido del JSON del paso 3, **en una sola línea y entre comillas simples** |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | los del paso 4 |

Las demás variables son opcionales (están en el README).

## Paso 6. Dejarla andando con PM2

```bash
npm install -g pm2
pm2 start server.js --name inventariolab
pm2 save
pm2 startup        # ejecuta el comando que imprime, para que arranque con el servidor
```

Comprobación: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/inventariolab/privacidad` imprime `200`.

## Paso 7. nginx y HTTPS

Con un certificado válido para tu dominio (Let's Encrypt, o el proxy de tu proveedor), reenvía `/inventariolab` al puerto 3000:

```nginx
location /inventariolab/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 6m;   # las fotos llegan reducidas, pero conviene dejar margen
}
```

Comprobación: `https://tu-dominio.edu.uy/inventariolab/privacidad` abre en el navegador, con candado.

## Paso 8. Preparar la primera planilla

1. Crea una planilla con las hojas **INVENTARIO**, **ubicaciones** y **config** (estructura en el README).
2. En **config**, columna A tu correo y columna B `ADMIN`.
3. **Comparte la planilla con el correo de la cuenta de servicio** (paso 3), como **Editor**.
4. Abre `https://tu-dominio.edu.uy/inventariolab/lab/<ID de la planilla>` y entra con Google.
5. En el panel, toca **Autorizar Drive para guardar fotos** (una vez por laboratorio).

Comprobación final: sube una foto a un material y fíjate que aparezca en la carpeta `LAB_FOTOS (InventarioLab)` de tu Drive.

## Mantenimiento

- **Actualizar:** `git pull --ff-only`, `npm ci --omit=dev` (si cambió `package.json`) y `pm2 restart inventariolab --update-env`.
- **Carpetas que debes conservar** (no están en git): `sessions/`, `drive-tokens/` y `embeddings/`. Haz copia de `.env` y de `drive-tokens/`.
- **Cambiar `SESSION_SECRET`** cierra la sesión de todos.
- **Si falla algo:** `pm2 logs inventariolab --lines 50`.

## Si algo sale mal

| Síntoma | Causa probable |
|---|---|
| La aplicación no arranca y menciona `SESSION_SECRET` | Falta o es el valor de ejemplo. Genera uno con `openssl rand -hex 32`. |
| `redirect_uri_mismatch` al entrar | Las URIs del paso 4 no coinciden **exactamente** con `APP_BASE_URL` (esquema, dominio, sin barra final). |
| "No se puede abrir la planilla" | No está compartida con la cuenta de servicio como Editor, o falta habilitar Sheets API. |
| Las fotos no se guardan | Falta **Autorizar Drive** en el panel, o la pantalla de consentimiento está en "Testing". |
| Error de Google "app no verificada" al entrar | Pusiste un logo en la marca o pediste permisos de más. Quita el logo y deja solo `drive.file`. |
