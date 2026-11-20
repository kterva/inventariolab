// PDF de etiquetas QR: selección de zonas, paginado A4 y contenido válido.
const test = require('node:test');
const assert = require('node:assert');
const { Writable } = require('node:stream');
const qr = require('../qrPdf');

const ZONAS = Array.from({ length: 11 }, (_, i) => [`Z${String(i + 1).padStart(2, '0')}`, `Armario ${i + 1}`, `Descripción ${i + 1}`]);

async function pdf(zonas) {
  const trozos = [];
  const salida = new Writable({ write(c, _, cb) { trozos.push(c); cb(); } });
  await qr.generarPdfQr({ zonas, baseUrl: 'https://x.test/inventariolab', labId: 'LAB', salida });
  return Buffer.concat(trozos);
}
const paginas = buf => (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

test('elegirZonas: todas, algunas o una; ignora IDs inexistentes y zonas sin nombre', () => {
  const con = [...ZONAS, ['Z99', '', 'sin nombre'], null];
  assert.equal(qr.elegirZonas(con, undefined).length, 11);
  assert.equal(qr.elegirZonas(con, []).length, 11);
  assert.deepEqual(qr.elegirZonas(con, ['Z03']).map(z => z[0]), ['Z03']);
  assert.deepEqual(qr.elegirZonas(con, ['Z05', ' Z02 ', 'ZXX']).map(z => z[0]), ['Z02', 'Z05']);
  assert.equal(qr.elegirZonas(con, ['ZXX']).length, 0);
  assert.equal(qr.elegirZonas(con, ['Z99']).length, 0, 'sin nombre no se imprime');
});

test('urlZona y codigoZona coinciden con los de la hoja IMPRIMIR_QR', () => {
  assert.equal(qr.codigoZona('Z7'), 'Z07');
  assert.equal(qr.codigoZona('12'), 'Z12');
  assert.equal(qr.urlZona('https://x/inventariolab', 'L', 'Estante Vidriería'), 'https://x/inventariolab/lab/L?zona=Estante%20Vidrier%C3%ADa');
});

test('PDF: A4, 8 etiquetas por hoja', async () => {
  const uno = await pdf(ZONAS.slice(0, 1));
  assert.ok(uno.subarray(0, 5).toString() === '%PDF-');
  assert.equal(paginas(uno), 1);
  assert.match(uno.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.equal(paginas(await pdf(ZONAS.slice(0, 8))), 1);
  assert.equal(paginas(await pdf(ZONAS.slice(0, 9))), 2);
  assert.equal(paginas(await pdf(ZONAS)), 2);
});

test('PDF: nombres con tildes, comillas y paréntesis no lo rompen', async () => {
  const buf = await pdf([['Z1', 'Vidriería (ñandú) "A" \\ ) (', 'ción <b>x</b>']]);
  assert.equal(paginas(buf), 1);
  assert.ok(buf.toString('latin1').includes('%%EOF'));
});
