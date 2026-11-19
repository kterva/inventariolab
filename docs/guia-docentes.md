# Guía para docentes: tu propio laboratorio en Inventario Laboratorio

> **Estado:** crear, importar y exportar ya funcionan. Pasar el laboratorio a otra persona y «Desconectar y borrar mis datos» todavía no existen (están marcados abajo). Diseño: [`laboratorios-propios.md`](laboratorios-propios.md).

Inventario Laboratorio sirve para llevar el inventario de un laboratorio de un centro educativo: buscar un material, saber en qué armario está, reportar si algo se rompió y ver fotos. No necesitas instalar nada ni saber de informática.

## Cómo funciona, en pocas palabras

**El inventario vive en una planilla de Google Sheets que es tuya**, dentro de tu cuenta de Google. La aplicación es una **comodidad que se apoya en esa planilla**: lee lo que hay, escribe lo que se reporta y agrega la búsqueda, los QR y las fotos. **No es dueña de nada.**

```
   Tu Drive (de tu cuenta de Google)                 Servidor de Inventario Laboratorio
 ┌────────────────────────────────┐   permiso   ┌──────────────────────────────┐
 │  Planilla "Inventario…"        │ ◄──────────►│  Lee y escribe tu planilla,  │ ◄── tus colegas
 │  Carpeta "LAB_FOTOS (…)"       │  (el que tú │  y decide qué puede hacer    │     entran con su
 │  (las fotos)                   │   le diste) │  cada persona (según config) │     cuenta de Google
 └────────────────────────────────┘             └──────────────────────────────┘
```

### ¿De quién es la planilla?
**Tuya.** Se crea en tu Drive, con tu cuenta como dueña. Tú decides con quién compartirla (o no compartirla con nadie). El servicio no tiene ninguna copia propia ni es cotitular.

### ¿La aplicación es un intermediario?
**Sí, y por eso funciona sin que tus colegas toquen tu Drive.** Cuando alguien de tu equipo busca un material o reporta un problema, el servidor lee o escribe tu planilla **usando el permiso que tú le diste**, y comprueba en la hoja `config` qué puede hacer esa persona (administrar, reportar o solo mirar). Tus colegas **no necesitan acceso a tu planilla ni a tu Drive**: solo entran con su cuenta de Google, y si su correo no está en `config`, no ven nada.

### ¿Qué permisos pide y por qué?
| Permiso | A quién se le pide | Para qué | Qué **no** permite |
|---|---|---|---|
| **Nombre y correo** (inicio de sesión con Google) | A todas las personas que entran | Saber quién eres y comprobar que tu correo está en `config` | No da acceso a tu Drive, tu correo ni tus contactos |
| **"Ver, editar, crear y borrar solo los archivos de Drive que uses con esta app"** (`drive.file`) | **Solo a quien crea o conecta el laboratorio** (el administrador) | Crear la planilla y la carpeta de fotos, leer y escribir la planilla, y guardar las fotos | **No ve ningún otro archivo de tu Drive.** Solo alcanza lo que la app crea o lo que tú le muestras en la ventana de elegir archivo |

El segundo permiso es el más pequeño que ofrece Google para esto, y se puede quitar cuando quieras (ver "Si cambias de centro").

### ¿Dónde se guardan las fotos?
**En tu Drive**, en una carpeta que crea la aplicación: **"LAB_FOTOS (InventarioLab)"**. Ocupan **tu** espacio de Drive. Para poder mostrarse en la aplicación, cada foto queda **visible para cualquiera que tenga su enlace** (el enlace es largo y no se puede adivinar, pero no es privado). **No subas fotos de personas ni información sensible.**

Por otro lado, la foto que alguien saca **para buscar** un material se analiza en el servidor y **no se guarda**.

### ¿Puedo usar la planilla sin la aplicación?
**Sí.** La planilla es una planilla de Google común y sigue siendo tuya si dejas de usar la aplicación, si el servicio cambia o si desaparece:

- Todos tus datos están ahí: materiales, cantidades, armarios, historial y usuarios.
- Puedes abrirla, editarla y descargarla como Excel (**Archivo → Descargar**).
- Las fotos siguen en tu Drive, y los enlaces de la planilla siguen abriéndolas.
- Lo único que deja de funcionar sin la aplicación son las funciones que dependen de ella: la búsqueda, los reportes desde el celular y los **códigos QR**, que abren una dirección de la aplicación.

Los cambios que hagas a mano en la planilla aparecen en la aplicación en menos de un minuto.

### ¿Qué guarda el servidor?
Solo lo necesario para funcionar:

- el **permiso** que le diste, para poder leer y escribir tu planilla;
- una **copia temporal** de la planilla, de 30 segundos (hasta 10 minutos si Google falla un momento), para responder rápido;
- una **representación numérica de cada foto** (no la imagen) para la búsqueda por foto;
- un **registro anónimo** de las búsquedas por foto (qué materiales propuso y qué eligió la persona, **sin correo ni imagen**), para mejorar la búsqueda.

No guarda tu inventario, ni tus usuarios, ni tus fotos. Si quieres, puedes pedir que borre todo eso (ver "Si cambias de centro").

---

## Paso a paso

### 1. Crear tu laboratorio (3 minutos)

1. Entra a la dirección de Inventario Laboratorio que te dio tu centro o tu inspector y toca **«✨ Crear mi laboratorio»**.
2. Escribe el nombre del centro y el del laboratorio y toca **Continuar con Google**.
3. Elige tu cuenta de Google. Google muestra una pantalla de permisos: la aplicación quiere **ver tu correo** y **usar solo los archivos que ella misma crea**. Acepta.
   > *Qué pasa:* le das el permiso `drive.file`. La aplicación **no ve** el resto de tu Drive. Si quieres retirarlo, ve a https://myaccount.google.com/permissions.
4. Listo. La aplicación crea **en tu Drive** la planilla "Inventario Laboratorio - <nombre del centro>" (con sus hojas ya preparadas) y la carpeta "LAB_FOTOS (InventarioLab)", y entras al panel como **administrador**.
   > *Qué pasa:* tu correo queda como ADMIN en la hoja `config`. El servidor guarda el permiso para poder trabajar con esos archivos. Quien administra el servicio recibe un aviso con tu correo y los nombres que elegiste, y cada cuenta puede crear un número limitado de laboratorios.

Guarda la dirección de tu laboratorio o agrégala a la pantalla de inicio del celular.

### 2. Cargar tus materiales

**A. Empezar de cero.** Abre la planilla desde tu Drive y completa la hoja **INVENTARIO**: un material por fila (nombre, cantidades en buen estado, regular y roto, y el armario). **No toques la columna ID**: la completa la aplicación sola.

**B. Traer lo que ya tienes.** Si ya tienes un inventario en otra planilla:
1. En la pantalla principal toca **«📥 Importar mi planilla»**, escribe el nombre del centro y del laboratorio y entra con Google.
2. En la ventana de Google Drive, elige tu planilla.
   > *Qué pasa:* al elegirla, le das a la aplicación permiso **solo sobre ese archivo**. La aplicación únicamente la **lee**; **tu planilla original no se modifica**.
3. Elige la hoja y la fila de los títulos, e indica qué columna es el nombre, cuáles son las cantidades y cuál el armario (la aplicación propone una elección según los títulos). Revisa la vista previa.
4. Toca **Crear el laboratorio con estos datos**.
   > *Qué pasa:* se crea un laboratorio **nuevo** (en tu Drive) con tus datos ordenados: IDs asignados, un armario por cada ubicación distinta, hasta 2000 artículos. La original queda como estaba. **Las fotos no se copian**: se agregan después desde la aplicación.

### 3. Armarios y códigos QR

1. En el panel de administración, entra a **Gestión de zonas** y agrega tus armarios (por ejemplo "Armario 1" o "Bajo mesada").
2. Asigna cada material a su armario.
3. Toca **Impresión de QR**, elige los armarios e **imprime las etiquetas**. Pégalas en cada armario.
   > *Qué pasa:* la aplicación agrega a tu planilla una hoja **IMPRIMIR_QR** con las etiquetas. Cada QR contiene la dirección del armario **dentro de la aplicación**.
4. Prueba con el celular: al escanear un QR debe abrir el contenido de ese armario.

### 4. Invitar a tus colegas

Se agregan en la hoja **config** de la planilla, columnas A y B:

| Columna A: correo | Columna B: rol |
|---|---|
| colega@centro.edu.uy | USER |
| otra.persona@gmail.com | ADMIN |

- **ADMIN:** sube fotos, mueve materiales y gestiona armarios y QR.
- **USER:** busca y reporta incidencias.
- **VISOR:** solo mira.

> *Qué pasa:* cada persona entra con su cuenta de Google y la aplicación mira esa lista. **No hace falta compartirles tu planilla.** Cuando alguien reporta o cambia algo, la aplicación anota en tu hoja **HISTORIAL** la fecha, **su correo** y la acción, para que el centro sepa quién hizo cada cambio.

### 5. Fotos y búsqueda por foto

- Un administrador abre un material y toca **Guardar mi foto en este artículo**.
  > *Qué pasa:* la foto se guarda **en tu Drive**, en la carpeta "LAB_FOTOS (InventarioLab)", y su enlace se anota en la columna de fotos de la planilla.
- Con fotos cargadas, cualquiera puede tocar **Buscar por foto**, sacar una foto de un material y ver en qué armario está.
  > *Qué pasa:* la foto se compara en el servidor con las de tu inventario y **no se guarda**.

### 6. Llevarte tus datos

- **La planilla:** ábrela en tu Drive. Descárgala como Excel con **Archivo → Descargar**.
- **Desde el panel (solo administradores):** en la tarjeta **Exportar mis datos**, toca **Planilla (.xlsx)** para bajarla en Excel y **Fotos (.zip)** para bajar todas las fotos. El ZIP trae además un `indice.csv` que dice qué artículo es cada foto. Si hay muchas fotos puede tardar un poco; dejá la pestaña abierta.
  > *Qué pasa:* la app te prepara una copia en tu computadora. No borra nada ni cambia tu planilla.

### 7. Si cambias de centro o dejas de usarlo

- **Pasar el laboratorio a otra persona** *(todavía no disponible)*: la otra persona entra con su cuenta, toca **Conectar este laboratorio** y elige la misma planilla (que tú debes haberle compartido antes). La conexión pasa a su cuenta.
- **Desconectar** *(todavía no disponible)*: en el panel, toca **Desconectar y borrar mis datos del servidor**. Se borran el permiso, la copia temporal y los índices de fotos del servidor. **Tu planilla y tus fotos no se tocan:** siguen en tu Drive.
- **Quitar el permiso desde Google:** https://myaccount.google.com/permissions → Inventario Laboratorio → **Quitar acceso**. La aplicación deja de poder leer o escribir; tus archivos quedan igual.

---

## Si ya usabas la versión anterior

Los laboratorios que ya existían siguen funcionando igual: el servicio usa una *cuenta de servicio* (una cuenta técnica de Google) con la que compartiste tu planilla como **Editora**, y las fotos las sube un administrador tocando **Autorizar Drive para guardar fotos** (una sola vez). Si quieres, puedes pasar a un laboratorio propio con **Importar mi planilla**.

## Problemas frecuentes

| Qué pasa | Qué hacer |
|---|---|
| "No tienes acceso" al entrar | Tu correo no está en la hoja **config**. Pídele a un administrador que lo agregue. |
| Las fotos no se guardan | El permiso de Drive venció o fue revocado: un administrador debe tocar **Autorizar Drive** (o **Conectar este laboratorio**) otra vez. |
| Un cambio hecho a mano en la planilla no aparece | La aplicación se actualiza sola en menos de un minuto. Si no, recarga la página. |
| Se mezclaron datos tras borrar o reordenar filas | No borres ni edites la columna **ID**. Ordenar, insertar y borrar filas es seguro mientras el ID no se toque. |
| Los QR no abren nada | Los QR apuntan a la aplicación: si el servicio está caído o cambió de dirección, no abren. La planilla y las fotos siguen intactas. |
