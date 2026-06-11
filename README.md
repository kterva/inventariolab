# InventarioLab 📦

Bienvenido al repositorio oficial de **InventarioLab**, un Gestor de Inventario de Código Abierto diseñado específicamente para los Laboratorios de Educación Media de Uruguay y Latinoamérica.

## 📜 Historia y Evolución (Changelog)

InventarioLab nació como un proyecto impulsado por la necesidad de los docentes de tener un control estricto y en tiempo real de los materiales de laboratorio, sin depender de sistemas comerciales caros o de planillas estáticas propensas a errores.

### 🔹 Versión 1.x (Google Apps Script)
Originalmente, el sistema fue desarrollado 100% sobre **Google Apps Script**. Servía directamente el HTML desde los servidores de Google y utilizaba una planilla de Google Sheets como base de datos.
* **Pros:** Era fácil de instalar (solo copiar la planilla) y no requería servidor propio.
* **Contras:** A medida que el sistema creció, Google Apps Script demostró ser demasiado lento para búsquedas simultáneas. Los límites de tiempo de ejecución de Google (Quotas) hacían que el sistema fallara cuando varios docentes intentaban escanear códigos QR o subir fotos al mismo tiempo.

### 🔹 Versión 2.0 (Node.js + VPS) - *Versión Actual*
Para solucionar los cuellos de botella de velocidad y concurrencia, el sistema fue rescrito y migrado a un servidor profesional (VPS) corriendo bajo **Node.js** y **Express**.
* **Base de Datos:** Se sigue utilizando Google Sheets como base de datos central (gracias a la API de Google Cloud y Cuentas de Servicio) para que los docentes no pierdan la comodidad de editar datos en una planilla de Excel.
* **Velocidad:** Las búsquedas que antes demoraban 5 segundos ahora son instantáneas (<100ms).
* **Seguridad:** Autenticación profesional vía Google OAuth 2.0 con control estricto de roles (Admin/Lector).
* **PWA:** Ahora el sistema es una Aplicación Web Progresiva instalable en Android e iOS, capaz de comportarse como una App nativa.

## 🛠 Ficha Técnica

- **Backend:** Node.js, Express.js
- **Motor de Plantillas:** EJS (Embedded JavaScript templates)
- **Base de Datos:** Google Sheets API (googleapis v4)
- **Autenticación:** Passport.js (Google OAuth20)
- **Almacenamiento de Imágenes:** Google Drive API (Subida en Base64)
- **Frontend:** HTML5, CSS3, JavaScript Vainilla (Diseño minimalista y moderno sin dependencias pesadas).
- **Despliegue:** PM2 + Nginx Proxy 

## 🧑‍💻 Para Docentes Informáticos y Desarrolladores
Si deseas auditar el código o contribuir a este proyecto, puedes revisar los archivos en este repositorio. Todo el código de producción se encuentra en la rama `nodejs-saas`.
