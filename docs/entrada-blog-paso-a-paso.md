<!--
Texto para reemplazar la parte de instalación de la entrada
https://leonardotrujillo.uy/soberania-tecnologica-en-el-laboratorio-sistema-de-inventario-con-codigos-qr/

BORRADOR. Antes de publicarlo hay que probar "Crear mi laboratorio" con una cuenta real de Google
en https://culturalibre.edu.uy/inventariolab (todavía solo se probó con Google simulado).
-->

## Cómo crear tu propio laboratorio (3 minutos, sin instalar nada)

Antes había que copiar una planilla, publicar un script de Google Apps Script y aceptar una advertencia de seguridad. **Ya no hace falta nada de eso**: la propia aplicación crea todo en tu Google Drive.

1. **Entrá a [culturalibre.edu.uy/inventariolab](https://culturalibre.edu.uy/inventariolab)** y tocá **«✨ Crear mi laboratorio»**.
2. **Escribí el nombre de tu centro y el del laboratorio** (por ejemplo, «Liceo Sauce 2» y «Laboratorio de Física») y tocá **Continuar con Google**.
3. **Elegí tu cuenta de Google y aceptá los permisos.** Google te dice que InventarioLab quiere ver tu correo (para dejarte como administrador) y crear y usar **solo los archivos que crea la propia aplicación**: tu planilla y la carpeta de fotos. No puede ver el resto de tu Drive, y podés quitar el permiso cuando quieras en [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
4. **Listo.** En tu Drive aparecen la planilla del inventario y la carpeta de fotos, y entrás al panel como administrador.

### Lo que conviene saber

- **La planilla es tuya.** Se crea en tu Drive, con tu cuenta como dueña. Podés abrirla, compartirla o descargarla cuando quieras. Desde el panel, la tarjeta **«Exportar mis datos»** baja la planilla en Excel y un ZIP con todas las fotos.
- **Tus colegas no necesitan acceso a tu Drive.** Entran con su cuenta de Google y la aplicación mira en la pestaña `config` de tu planilla qué puede hacer cada uno:
  - `ADMIN`: control total (armarios, QR, fotos).
  - vacío o `LECTOR`: busca materiales y reporta roturas.
  - `VISOR`: solo mira.
  Quien no esté en `config` ve «acceso denegado».
- **Dentro de la aplicación:** creá tus armarios en «Impresión de QRs y Gestión de Zonas», cargá los materiales en la pestaña `INVENTARIO` de tu planilla (indicando el armario en la columna «Ubicación») e imprimí los QR para pegarlos en las puertas.
- **Si ya tenías una planilla propia** de la versión anterior, la podés seguir usando: hay que compartirla como Editora con el correo del servidor y pegar su enlace en la pantalla principal (el paso a paso está en la [ayuda](https://culturalibre.edu.uy/inventariolab/ayuda), en «alternativa»). Los QR que ya imprimiste siguen funcionando.
- **Privacidad:** el servidor no guarda una base de datos con tus datos: el inventario vive en tu planilla. Quien administra el servidor recibe un aviso con tu correo cuando creás un laboratorio. Más detalles en la [política de privacidad](https://culturalibre.edu.uy/inventariolab/privacidad).

### Código fuente

El código es software libre y está en [github.com/kterva/inventariolab](https://github.com/kterva/inventariolab). Si preferís montar tu propio servidor, la guía paso a paso está en `docs/instalacion-propia.md`.

---

**Qué cambiar en la entrada actual**

- Reemplazar los 4 pasos viejos (copiar la planilla modelo, publicar la aplicación web desde Apps Script, autorizar la advertencia de seguridad, cargar usuarios) por el bloque de arriba.
- Quitar la frase «el propietario de la planilla tiene acceso de administrador sin figurar en `config`»: en la versión nueva el administrador queda escrito en `config` al crear el laboratorio.
- Cambiar «código fuente: próximamente» por el enlace a GitHub.
