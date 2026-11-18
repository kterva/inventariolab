# Laboratorios propios: que cada docente tenga su planilla, sin cuenta de servicio

Estado: **diseño validado con prototipos** (2026-11-18); falta implementar.

Qué se comprobó, con una cuenta real de Google:

1. **Crear:** con el permiso `drive.file` la app crea la planilla (4 hojas) y la carpeta de fotos en el Drive del docente, escribe, lee, agrega filas y protege la columna ID. `files.list` solo ve lo que creó la app.
2. **Alcance:** una planilla del docente que la app no creó da **404** aunque se conozca su ID.
3. **Importar:** después de elegirla con el **Picker**, la app puede leerla, escribirla y borrar una celda.
4. **Fase 0, el cruce Picker ↔ servidor:** el Picker concede el acceso en el navegador, pero el servidor trabaja con otro token (flujo de código, `prompt=consent`). Un token de servidor **recién emitido leyó la planilla elegida con el Picker horas antes** (HTTP 200). La concesión es del usuario y de la app, no de un token en particular, así que el diseño se sostiene.
5. **El Picker anduvo sin clave de API** (solo con el token OAuth y el número de proyecto como `appId`). No hace falta crear una clave de API para producir esto.

Lo que **no** se probó: el Picker elegido y leído por el servidor en la misma sesión desde cero (con una planilla nunca concedida), y la duración del token (ver "Riesgos").

## Objetivo

Que un docente que no sea informático pueda usar InventarioLab en tres minutos, con los datos en **su** Drive, sin compartir nada con una cuenta de servicio y pudiendo llevarse todo cuando quiera.

## Cómo es hoy y qué cambia

Hoy toda planilla se lee y se escribe con **una sola cuenta de servicio** a la que el dueño comparte su planilla. Las fotos ya usan el permiso OAuth `drive.file` de un admin.

Con este diseño hay dos tipos de laboratorio:

| | Servicio (los actuales) | Usuario (los nuevos) |
|---|---|---|
| Quién accede a la planilla | cuenta de servicio, compartida como Editora | el permiso `drive.file` del docente que la creó o la eligió |
| Cómo nace | el dueño comparte su planilla | botón "Crear mi laboratorio" o "Importar" |
| Revocar | quitar a la cuenta de servicio | el docente quita la app en su cuenta de Google |

Los laboratorios actuales **no cambian**: siguen en modo servicio hasta que alguien quiera migrarlos.

## Piezas

### 1. Credenciales por laboratorio (implementado)

Reemplaza el `getApis()` global por `getApis(labId)`. Devuelve `{ sheets, drive }` ya autenticados para ese laboratorio:

- si el laboratorio es de **usuario**, un cliente OAuth con el refresh token guardado de su dueño;
- si no, el cliente de la cuenta de servicio, como hoy.

**Implementación:** `driveUsuario.js` guarda `modo: "usuario"` en el token y expone `esModoUsuario(labId)` y `clienteSheets(labId)`; `googleClient.getApis(labId)` elige entre ese cliente y el de la cuenta de servicio. Si Google responde `invalid_grant` (permiso revocado o vencido), se lanza un error `CONEXION_VENCIDA` y el servidor responde con una página 503 "Laboratorio desconectado". Los clientes se guardan en memoria por laboratorio. El token vive en `drive-tokens/<labId>.json` (ya existe, modo 600); se le suma un campo `modo: "usuario"`. Un token sin ese campo (como el actual de fisicasauce2) sigue sirviendo solo para fotos.

Hay 11 llamadas a `getApis()` en `googleClient.js` y todas tienen el `sheetId` a mano, así que el cambio es mecánico. Ningún laboratorio puede recibir nunca las credenciales de otro: el único dato de entrada es el `labId` de la ruta, y hace falta una prueba automática que lo asegure.

### 2. Plantilla en código (`plantilla.js`)

La estructura de la planilla (hojas, encabezados, fila de `config`) pasa a vivir en un solo lugar. La usan "Crear mi laboratorio" y la preparación que hoy hace `ejecutarPreparacion` (columna ID y hoja HISTORIAL). El prototipo ya tiene el cuerpo de `spreadsheets.create`.

### 3. Crear mi laboratorio

1. La persona entra con Google (ya existe) y toca "Crear mi laboratorio" en una página nueva.
2. Pide el permiso `drive.file` con un flujo de código (offline, con refresh token).
3. El servidor crea la planilla desde la plantilla y la carpeta de fotos, deja a la persona como `ADMIN` en `config` y guarda el token con `modo: "usuario"`.
4. Redirige a `/inventariolab/lab/<id>` con los QR listos para imprimir.

### 4. Exportar

- **Planilla:** `drive.files.export` a `.xlsx`, ya que la planilla es del docente y el permiso la cubre.
- **Fotos:** un ZIP generado en streaming, solo para admins. La planilla sola no alcanza porque las fotos son enlaces de Drive.
- Siempre disponible, también para laboratorios de servicio con fotos propias.

### 5. Importar una planilla existente

Con el Picker el docente elige su planilla. La app **no la modifica**: la lee, muestra las columnas y deja asignar cuáles son artículo, cantidades, zona y foto. Después crea una planilla **nueva** con la estructura de la plantilla y copia los datos. Así se evita adaptar en el lugar planillas con estructuras muy distintas, y el original queda intacto.

### 6. Relevo y reconexión

Todo el laboratorio depende del permiso de una sola cuenta. Hace falta que otro admin pueda **tomar la conexión**: repite el flujo con el Picker sobre la misma planilla (que el dueño ya le compartió) y reemplaza el token. Sirve también cuando el docente revoca el permiso o cambia de cuenta. Si el token falla (`invalid_grant`), la app lo dice y sigue mostrando la última copia guardada, como ya hace con los errores de Google.

### 7. Privacidad y operación

- Token guardado con permiso 600, y como mejora, cifrado con una clave del `.env`.
- Botón "Desconectar y borrar mis datos del servidor": borra el token, los embeddings y la caché del laboratorio. La planilla y las fotos son del docente y no se tocan.
- La política de privacidad dice qué guarda el servidor (token, caché, embeddings, registro anónimo) y qué no.
- La pantalla de consentimiento de Google debe enlazar la política y las condiciones ("Información de la marca").
- Los usuarios con rol `USER` o `LECTOR` no necesitan acceso a la planilla: el servidor hace de intermediario.

Una ventaja de pasar a permisos de usuario: la cuota de la API de Sheets es por usuario, y hoy todos los laboratorios comparten la de la cuenta de servicio.

## Riesgos y cosas por verificar

1. ~~El permiso del Picker y el token del servidor.~~ **Resuelto en la fase 0** (ver arriba): la concesión la comparten distintos tokens del mismo usuario y cliente.
2. **Duración del token.** Con la app "En producción" el refresh token no debería caducar a los 7 días, pero hay que confirmarlo. El token de la fase 0 se emitió el **2026-11-18**; la lectura de control se repite con `relectura.js` (ver "Cómo repetir la comprobación"). Si pasados 8 días sigue dando 200, queda confirmado.
3. **Un token por laboratorio** concentra riesgo en el servidor, pero con alcance mínimo (solo archivos de la app) y revocable por cada docente.
4. **Planillas importadas muy distintas.** El mapeo cubre lo común; lo raro se resuelve a mano o no se importa.
5. **Carga:** los embeddings de fotos comparten CPU del VPS entre laboratorios; el límite por usuario ya existe, falta uno global.

## Fases

| Fase | Contenido | Riesgo |
|---|---|---|
| 0 | ✅ Cruce Picker → token del servidor (hecho). Falta confirmar la duración del token | decidía si el diseño se sostiene |
| 1 | ✅ `getApis(labId)` y modo usuario (hecho; vive en `driveUsuario.js` y `googleClient.js`, no en un archivo aparte); pruebas de aislamiento en `tests/credencialesLab.test.js` | bajo |
| 2 | `plantilla.js` y "Crear mi laboratorio" | medio |
| 3 | Exportar planilla y ZIP de fotos | bajo |
| 4 | Importar con Picker y mapeo | medio |
| 5 | Relevo y reconexión, desconectar y borrar, cifrado de tokens, QR cortos | medio |

Los QR cortos (`/q/<código>` → dirección del laboratorio) permiten cambiar de servidor sin reimprimir; pueden esperar a la fase 5.

## Cómo repetir la comprobación de duración del token

Los archivos de la fase 0 están **fuera del repo**, en `~/.config/inventariolab/fase0/` (el token es sensible: permisos 600). Pasados 8 días o más desde el 2026-11-18:

```bash
NODE_PATH=<repo>/node_modules node ~/.config/inventariolab/fase0/relectura.js
```

Imprime los días que tiene el token y si el servidor todavía lee las planillas elegidas con el Picker; anota cada resultado en `relectura.log`. Si da `OK`, el token no caducó a los 7 días. Si da `FALLA … invalid_grant`, la pantalla de consentimiento sigue en modo "Testing" o el docente revocó el permiso. Al terminar, borrar la carpeta con `shred -u` y revocar el acceso en https://myaccount.google.com/permissions.

## Documentos relacionados

- [`guia-docentes.md`](guia-docentes.md): paso a paso para un docente (borrador: describe el flujo de las fases 2 a 4).
- [`instalacion-propia.md`](instalacion-propia.md): paso a paso para montar un servidor propio.
