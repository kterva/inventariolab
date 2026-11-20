// Listados exportables en formatos abiertos: ODS (OpenDocument), CSV y PDF.
// Hoy se usa para «Materiales sin foto»; sirve para cualquier tabla de texto.
const archiver = require('archiver');
const PDFDocument = require('pdfkit');
const { celdaCsv } = require('./exportar');

const SIN_UBICACION = '__SIN_UBICACION__';
const MIME_ODS = 'application/vnd.oasis.opendocument.spreadsheet';
const MIME_CSV = 'text/csv; charset=utf-8';

/** Artículos sin foto, opcionalmente de un solo armario (SIN_UBICACION = los que no tienen armario) */
function sinFoto(articulos, zona) {
  const faltan = articulos.filter(a => !a.foto || String(a.foto).trim() === '');
  if (zona === undefined || zona === null || zona === '') return faltan;
  const ubi = a => (a.ubicacion == null ? '' : String(a.ubicacion)).trim();
  if (zona === SIN_UBICACION) return faltan.filter(a => ubi(a) === '');
  return faltan.filter(a => ubi(a) === String(zona).trim());
}

/** Filas de texto [artículo, armario, ID] listas para exportar */
function filasSinFoto(articulos) {
  return articulos.map(a => [String(a.articulo ?? ''), String(a.ubicacion ?? '').trim() || 'Sin ubicación', String(a.id ?? '')]);
}
const ENCABEZADOS_SIN_FOTO = ['Artículo', 'Armario', 'ID'];

// ─── CSV ──────────────────────────────────────────────

/** CSV en UTF-8 con BOM (para que Excel y LibreOffice reconozcan las tildes) */
function generarCsv(encabezados, filas) {
  return '﻿' + [encabezados, ...filas].map(f => f.map(celdaCsv).join(',')).join('\r\n') + '\r\n';
}

// ─── ODS ──────────────────────────────────────────────

function xml(t) {
  return String(t == null ? '' : t)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function celdaOds(valor, estilo) {
  const e = estilo ? ` table:style-name="${estilo}"` : '';
  // los saltos de línea y los espacios múltiples se conservan con text:line-break y text:s
  const partes = String(valor == null ? '' : valor).split(/\r?\n/).map(l => xml(l).replace(/ {2,}/g, m => ` <text:s text:c="${m.length - 1}"/>`));
  return `<table:table-cell office:value-type="string"${e}><text:p>${partes.join('<text:line-break/>')}</text:p></table:table-cell>`;
}

function contenidoOds(nombreHoja, encabezados, filas) {
  const nombre = xml(String(nombreHoja).replace(/[\[\]*?:/\\]/g, ' ').slice(0, 31) || 'Hoja');
  const cols = encabezados.map(() => '<table:table-column table:style-name="co1"/>').join('');
  const fila = (celdas, estilo) => `<table:table-row>${celdas.map(c => celdaOds(c, estilo)).join('')}</table:table-row>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
<office:automatic-styles>
<style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="6cm"/></style:style>
<style:style style:name="ce1" style:family="table-cell"><style:text-properties fo:font-weight="bold"/></style:style>
</office:automatic-styles>
<office:body><office:spreadsheet><table:table table:name="${nombre}">${cols}${fila(encabezados, 'ce1')}${filas.map(f => fila(f)).join('')}</table:table></office:spreadsheet></office:body>
</office:document-content>`;
}

const MANIFEST_ODS = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${MIME_ODS}"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

/** Escribe en `salida` un archivo .ods de una hoja. Devuelve una promesa que termina cuando se escribió todo. */
function generarOds({ nombreHoja, encabezados, filas, salida }) {
  return new Promise((resolve, reject) => {
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', reject);
    salida.on('error', reject);
    salida.on('finish', resolve);
    zip.pipe(salida);
    // el tipo de archivo va primero y sin comprimir, como pide el estándar
    zip.append(MIME_ODS, { name: 'mimetype', store: true });
    zip.append(MANIFEST_ODS, { name: 'META-INF/manifest.xml' });
    zip.append(contenidoOds(nombreHoja, encabezados, filas), { name: 'content.xml' });
    zip.finalize().catch(reject);
  });
}

// ─── PDF ──────────────────────────────────────────────

/** PDF A4 con una tabla (encabezado repetido en cada página y numeración) */
function generarPdfListado({ titulo, subtitulo, encabezados, filas, anchos, salida }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: titulo, Creator: 'Inventario Laboratorio' } });
    doc.on('error', reject);
    salida.on('error', reject);
    salida.on('finish', resolve);
    doc.pipe(salida);

    const ancho = doc.page.width - 80;
    const proporciones = anchos || encabezados.map(() => 1 / encabezados.length);
    const cols = proporciones.map(p => p * ancho);
    const pie = doc.page.height - 40;

    const cabecera = () => {
      let x = 40;
      const y = doc.y;
      doc.rect(40, y, ancho, 20).fill('#1a5276');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10);
      encabezados.forEach((h, i) => { doc.text(h, x + 6, y + 6, { width: cols[i] - 12, lineBreak: false }); x += cols[i]; });
      doc.y = y + 20;
    };

    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1a5276').text(titulo, 40, 40, { width: ancho });
    if (subtitulo) doc.font('Helvetica').fontSize(10).fillColor('#555555').text(subtitulo, { width: ancho });
    doc.moveDown(0.8);
    cabecera();

    filas.forEach((fila, n) => {
      doc.font('Helvetica').fontSize(9.5);
      const alto = Math.max(...fila.map((c, i) => doc.heightOfString(String(c), { width: cols[i] - 12 }))) + 10;
      if (doc.y + alto > pie - 20) { doc.addPage(); doc.y = 40; cabecera(); }
      const y = doc.y;
      if (n % 2 === 1) doc.rect(40, y, ancho, alto).fill('#f2f5f8');
      let x = 40;
      doc.fillColor('#222222');
      fila.forEach((c, i) => { doc.text(String(c), x + 6, y + 5, { width: cols[i] - 12 }); x += cols[i]; });
      doc.y = y + alto;
    });

    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(paginas.start + i);
      doc.page.margins.bottom = 0; // escribir en el pie no debe abrir otra página
      doc.font('Helvetica').fontSize(8).fillColor('#888888')
        .text(`Página ${i + 1} de ${paginas.count}`, 40, doc.page.height - 30, { width: ancho, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { SIN_UBICACION, MIME_ODS, MIME_CSV, sinFoto, filasSinFoto, ENCABEZADOS_SIN_FOTO, generarCsv, generarOds, generarPdfListado };
