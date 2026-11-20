// PDF con las etiquetas QR de los armarios, en hojas A4 listas para imprimir y recortar.
// Los QR se dibujan como vectores con la biblioteca `qrcode`: no se envía ningún enlace a servicios externos.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = 28;
const COLUMNAS = 2;
const FILAS = 4;
const POR_HOJA = COLUMNAS * FILAS;
const COLORES = ['#1a5276', '#117864', '#7d6608', '#6c3483', '#922b21'];

/** Código corto de la zona, igual que en la hoja IMPRIMIR_QR: Z01, Z02… */
function codigoZona(id) {
  return 'Z' + String(id).replace(/\D/g, '').padStart(2, '0');
}

/** Enlace que abre el armario; el mismo que usa la hoja IMPRIMIR_QR */
function urlZona(baseUrl, labId, nombre) {
  return `${baseUrl}/lab/${labId}?zona=${encodeURIComponent(nombre)}`;
}

/**
 * Filtra las zonas por ID. Sin IDs (lista vacía o ausente) devuelve todas las que tienen nombre.
 * Cada zona es una fila de la hoja `ubicaciones`: [id, nombre, …]; en la etiqueta solo van el código, el nombre y el QR.
 */
function elegirZonas(zonas, ids) {
  const conNombre = zonas.filter(z => z && (z[1] || '').toString().trim());
  if (!Array.isArray(ids) || ids.length === 0) return conNombre;
  const pedidos = new Set(ids.map(i => String(i).trim()));
  return conNombre.filter(z => pedidos.has(String(z[0] ?? '').trim()));
}

function dibujarQr(doc, texto, x, y, lado) {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const modulo = lado / (n + 8); // 4 módulos de margen en blanco a cada lado
  doc.rect(x, y, lado, lado).fill('#ffffff');
  doc.fillColor('#000000');
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) {
        // un poco más grande que el módulo para que no queden hilos blancos entre vecinos
        doc.rect(x + (c + 4) * modulo, y + (r + 4) * modulo, modulo + 0.2, modulo + 0.2).fill();
      }
    }
  }
}

function dibujarEtiqueta(doc, zona, indice, x, y, w, h, urlBase, labId) {
  const [id, nombre] = zona;
  const color = COLORES[indice % COLORES.length];
  const cabecera = 38;

  doc.save();
  doc.lineWidth(0.6).dash(3, { space: 3 }).strokeColor('#999999').rect(x, y, w, h).stroke().undash();

  doc.rect(x, y, w, cabecera).fill(color);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13)
    .text(codigoZona(id), x + 10, y + (cabecera - 13) / 2 - 1, { width: 44, lineBreak: false });
  // el nombre ocupa hasta dos líneas, centrado verticalmente en la cabecera
  doc.fontSize(11.5);
  const anchoNombre = w - 66, altoNombre = 28;
  const alto = Math.min(doc.heightOfString(String(nombre), { width: anchoNombre }), altoNombre);
  doc.text(String(nombre), x + 56, y + (cabecera - alto) / 2, { width: anchoNombre, height: altoNombre, ellipsis: true });

  // solo el título y el QR, centrado y lo más grande posible
  const libre = h - cabecera;
  const lado = Math.min(libre - 16, w - 24);
  const qx = x + (w - lado) / 2;
  const qy = y + cabecera + (libre - lado) / 2;
  dibujarQr(doc, urlZona(urlBase, labId, nombre), qx, qy, lado);
  doc.restore();
}

/**
 * Escribe en `salida` un PDF A4 con 8 etiquetas por hoja (2 columnas × 4 filas).
 * Devuelve una promesa que se cumple cuando el PDF terminó de escribirse.
 */
function generarPdfQr({ zonas, baseUrl, labId, salida, titulo = 'Códigos QR de armarios' }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 0, info: { Title: titulo, Creator: 'Inventario Laboratorio' },
    });
    doc.on('error', reject);
    salida.on('error', reject);
    salida.on('finish', resolve);
    doc.pipe(salida);

    const w = (A4.ancho - 2 * MARGEN) / COLUMNAS;
    const h = (A4.alto - 2 * MARGEN) / FILAS;
    zonas.forEach((zona, i) => {
      if (i > 0 && i % POR_HOJA === 0) doc.addPage();
      const pos = i % POR_HOJA;
      const x = MARGEN + (pos % COLUMNAS) * w;
      const y = MARGEN + Math.floor(pos / COLUMNAS) * h;
      dibujarEtiqueta(doc, zona, i, x, y, w, h, baseUrl, labId);
    });
    doc.end();
  });
}

module.exports = { generarPdfQr, elegirZonas, codigoZona, urlZona, POR_HOJA };
