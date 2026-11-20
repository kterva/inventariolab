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
 * Cada zona es una fila de la hoja `ubicaciones`: [id, nombre, descripción].
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
  const [id, nombre, descripcion] = zona;
  const color = COLORES[indice % COLORES.length];
  const cabecera = 30;

  doc.save();
  doc.lineWidth(0.6).dash(3, { space: 3 }).strokeColor('#999999').rect(x, y, w, h).stroke().undash();

  doc.rect(x, y, w, cabecera).fill(color);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(13)
    .text(codigoZona(id), x + 10, y + 9, { width: 44, lineBreak: false });
  doc.fontSize(12).text(String(nombre), x + 56, y + 9, { width: w - 66, height: 16, ellipsis: true });

  const lado = Math.min(h - cabecera - 22, 120);
  const qx = x + 12, qy = y + cabecera + 11;
  dibujarQr(doc, urlZona(urlBase, labId, nombre), qx, qy, lado);

  const tx = qx + lado + 12;
  const tw = x + w - tx - 10;
  doc.fillColor('#333333').font('Helvetica').fontSize(10)
    .text((descripcion || '').toString(), tx, qy + 4, { width: tw, height: lado - 34, ellipsis: true });
  doc.fillColor('#777777').fontSize(8)
    .text('Escaneá el código para ver el contenido del armario.', tx, qy + lado - 26, { width: tw, height: 26 });
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
