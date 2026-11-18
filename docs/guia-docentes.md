# Guía para docentes: tu propio laboratorio en InventarioLab

> **Estado: borrador.** Describe el flujo previsto para las fases 2 a 4 del diseño (ver [`laboratorios-propios.md`](laboratorios-propios.md)). Hoy el alta es manual; los pasos que ya funcionan están en la sección "Mientras tanto". Se actualizará cuando exista el botón "Crear mi laboratorio".

InventarioLab guarda el inventario de tu laboratorio en **una planilla de Google Sheets que es tuya**, en tu cuenta de Google. La aplicación solo agrega la búsqueda, los armarios con QR, las fotos y los reportes. No necesitas instalar nada ni saber de informática.

## Qué vas a necesitar

- Una cuenta de Google (puede ser la personal o la del centro).
- 5 minutos.
- Un celular para probar los códigos QR.

## 1. Crear tu laboratorio (3 minutos)

1. Entra a la dirección de InventarioLab que te dio tu centro o tu inspector.
2. Toca **Entrar con Google** y elige tu cuenta.
3. Toca **Crear mi laboratorio**.
4. Google te va a mostrar una pantalla de permisos que dice: *"Ver, editar, crear y borrar solo los archivos específicos de Google Drive que uses con esta app"*. Es el permiso mínimo: la aplicación **solo puede tocar lo que ella misma crea o lo que tú le muestres**; no ve el resto de tu Drive. Toca **Continuar**.
5. Escribe el nombre del centro y del laboratorio, y toca **Crear**.

La aplicación crea en **tu Drive**:
- la planilla **"Inventario de laboratorio"**, con las hojas ya preparadas;
- la carpeta **"LAB_FOTOS (InventarioLab)"**, donde se guardarán las fotos.

Tú quedas como **administrador**. La dirección de tu laboratorio aparece al terminar: guárdala o tócala para agregarla a la pantalla de inicio del celular.

## 2. Cargar tus materiales

Tienes dos caminos:

**A. Empezar de cero.** Abre la planilla desde tu Drive y completa la hoja **INVENTARIO**: un material por fila (nombre, cantidades en buen estado, regular y roto, y en qué armario está). No toques la columna **ID**: la completa la aplicación sola.

**B. Traer lo que ya tienes.** Si ya tienes un inventario en otra planilla:
1. En tu laboratorio, toca **Importar una planilla**.
2. Elige tu planilla en la ventana de Google. La aplicación solo la **lee**; tu planilla original no se modifica.
3. Indica qué columna es el nombre, cuáles son las cantidades y cuál el armario.
4. Revisa la vista previa y confirma. Se crea una planilla nueva con tus datos ordenados.

## 3. Armarios y códigos QR

1. En el panel de administración, entra a **Gestión de zonas** y agrega tus armarios (por ejemplo "Armario 1", "Bajo mesada").
2. Asigna cada material a su armario.
3. Toca **Impresión de QR**, elige los armarios y **imprime las etiquetas**. Pégalas en cada armario.
4. Prueba con el celular: al escanear un QR debe abrir el contenido de ese armario.

## 4. Invitar a tus colegas

Los demás usuarios **no necesitan acceso a tu planilla ni a tu Drive**. Se agregan en la hoja **config** de la planilla, en las columnas A y B:

| Columna A: correo | Columna B: rol |
|---|---|
| colega@centro.edu.uy | USER |
| otra.persona@gmail.com | ADMIN |

- **ADMIN:** puede subir fotos, mover materiales y gestionar armarios y QR.
- **USER:** puede buscar y reportar incidencias.
- **VISOR:** solo mira.

Cada persona entra con su cuenta de Google. Si su correo no está en la lista, no ve nada.

## 5. Fotos y búsqueda por foto

- Un administrador abre un material y toca **Guardar mi foto en este artículo**.
- Con fotos cargadas, cualquiera puede tocar **Buscar por foto**, sacar una foto de un material y ver en qué armario está. La foto que se usa para buscar **no se guarda**.
- Las fotos de los materiales quedan visibles para cualquiera que tenga su enlace: **no subas fotos de personas ni información sensible**.

## 6. Llevarte tus datos

- **Planilla:** ábrela en tu Drive. Es tuya: puedes descargarla como Excel (**Archivo → Descargar**).
- **Con fotos:** en el panel, toca **Exportar todo** para descargar la planilla en Excel y un ZIP con las fotos.

## 7. Si cambias de centro o dejas de usarlo

- **Pasar el laboratorio a otra persona:** la persona entra con su cuenta, toca **Conectar este laboratorio** y elige la misma planilla, que tú debes haberle compartido antes. La conexión pasa a su cuenta.
- **Desconectar:** en el panel, toca **Desconectar y borrar mis datos del servidor**. Se borran el permiso, la caché y los índices de fotos del servidor. **Tu planilla y tus fotos no se tocan**: siguen en tu Drive.
- **Quitar el permiso desde Google:** https://myaccount.google.com/permissions → InventarioLab → **Quitar acceso**.

## Qué guarda el servidor y qué no

| Lo guarda el servidor | Lo guardas tú, en tu Drive |
|---|---|
| El permiso que le diste (para poder leer y escribir tu planilla), una copia temporal de la planilla de pocos minutos, una representación numérica de cada foto (no la imagen) y un registro anónimo de las búsquedas por foto (sin tu correo ni la imagen). | La planilla, las fotos, los usuarios y roles, y el historial de cambios. |

Más detalles en la página de privacidad de la aplicación.

## Mientras tanto: cómo se da de alta hoy (manual)

Hasta que exista el botón "Crear mi laboratorio", el alta se hace con la ayuda de quien administra el servicio:

1. Crea una planilla de Google Sheets con las hojas **INVENTARIO**, **ubicaciones** y **config** (la estructura está en el README del proyecto).
2. En **config**, escribe tu correo en la columna A y `ADMIN` en la B.
3. Comparte la planilla, como **Editor**, con el correo de la cuenta de servicio que te indique quien administra el servicio.
4. Abre `<dirección del servicio>/inventariolab/lab/<ID de tu planilla>` (el ID es el tramo largo de la dirección de tu planilla, entre `/d/` y `/edit`).
5. Entra con Google y, en el panel, toca **Autorizar Drive para guardar fotos** (una sola vez).

## Problemas frecuentes

| Qué pasa | Qué hacer |
|---|---|
| "No tienes acceso" al entrar | Tu correo no está en la hoja **config**. Pídele a un administrador que lo agregue. |
| Las fotos no se guardan | El permiso de Drive venció o fue revocado: un administrador debe tocar **Autorizar Drive** (o **Conectar este laboratorio**) otra vez. |
| Un cambio hecho a mano en la planilla no aparece | La aplicación se actualiza sola en menos de un minuto. Si no, recarga la página. |
| Borré o reordené filas y se mezclaron datos | No borres ni edites la columna **ID**. Ordenar, insertar y borrar filas es seguro mientras el ID no se toque. |
