// Listados en formatos abiertos: filtro por armario, CSV, ODS (ZIP + XML) y PDF.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { Writable } = require('node:stream');
const L = require('../listados');

const ART = [
  { id: 'A1', articulo: 'Probeta', ubicacion: 'Estante 1', foto: '' },
  { id: 'A2', articulo: 'Balanza', ubicacion: ' Estante 1 ', foto: '  ' },
  { id: 'A3', articulo: 'Imán', ubicacion: 'Estante 2', foto: undefined },
  { id: 'A4', articulo: 'Lupa', ubicacion: '', foto: null },
  { id: 'A5', articulo: 'Con foto', ubicacion: 'Estante 1', foto: 'https://lh3.googleusercontent.com/d/x' },
];

function colector() {
  const trozos = [];
  return { salida: new Writable({ write(c, _, cb) { trozos.push(c); cb(); } }), buffer: () => Buffer.concat(trozos) };
}

/** Lector mínimo de ZIP: directorio central, métodos "store" y "deflate" */
function leerZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  const cantidad = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const archivos = [];
  for (let i = 0; i < cantidad; i++) {
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20);
    const n = buf.readUInt16LE(p + 28), x = buf.readUInt16LE(p + 30), c = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + n);
    const datos = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const crudo = buf.subarray(datos, datos + tam);
    archivos.push({ nombre, metodo, contenido: metodo === 8 ? zlib.inflateRawSync(crudo) : crudo });
    p += 46 + n + x + c;
  }
  return archivos;
}

test('sinFoto: solo los que no tienen foto; todos, un armario, o los sin armario', () => {
  assert.deepEqual(L.sinFoto(ART).map(a => a.id), ['A1', 'A2', 'A3', 'A4']);
  assert.deepEqual(L.sinFoto(ART, '').map(a => a.id), ['A1', 'A2', 'A3', 'A4']);
  assert.deepEqual(L.sinFoto(ART, 'Estante 1').map(a => a.id), ['A1', 'A2'], 'ignora espacios y los que ya tienen foto');
  assert.deepEqual(L.sinFoto(ART, 'Estante 2').map(a => a.id), ['A3']);
  assert.deepEqual(L.sinFoto(ART, L.SIN_UBICACION).map(a => a.id), ['A4']);
  assert.deepEqual(L.sinFoto(ART, 'No existe'), []);
});

test('filasSinFoto: texto plano, «Sin ubicación» para los que no tienen armario', () => {
  assert.deepEqual(L.filasSinFoto(L.sinFoto(ART, L.SIN_UBICACION)), [['Lupa', 'Sin ubicación', 'A4']]);
});

test('CSV: BOM, comillas y fórmulas neutralizadas', () => {
  const csv = L.generarCsv(['Artículo', 'Armario', 'ID'], [['Pinza, "grande"', 'Z1', 'A1'], ['=1+1', 'Z2', 'A2'], ['Imán', 'Z1', 'A3']]);
  assert.ok(csv.startsWith('﻿Artículo,Armario,ID\r\n'));
  assert.ok(csv.includes('"Pinza, ""grande""",Z1,A1\r\n'));
  assert.ok(csv.includes("'=1+1,Z2,A2\r\n"), 'una fórmula no se ejecuta al abrirla');
  assert.ok(csv.endsWith('\r\n'));
});

test('ODS: ZIP válido, mimetype primero y sin comprimir, contenido escapado', async () => {
  const c = colector();
  await L.generarOds({ nombreHoja: 'Sin foto', encabezados: ['Artículo', 'Armario'], filas: [['A & B <x> "y"', 'Z1'], ['dos  espacios\nlínea', 'Z2']], salida: c.salida });
  const arch = leerZip(c.buffer());
  assert.deepEqual(arch.map(a => a.nombre), ['mimetype', 'META-INF/manifest.xml', 'content.xml']);
  assert.equal(arch[0].metodo, 0, 'mimetype sin comprimir');
  assert.equal(arch[0].contenido.toString(), 'application/vnd.oasis.opendocument.spreadsheet');
  const xml = arch[2].contenido.toString();
  assert.ok(xml.includes('A &amp; B &lt;x&gt; &quot;y&quot;'));
  assert.ok(xml.includes('<text:line-break/>') && xml.includes('<text:s text:c="1"/>'));
  assert.ok(xml.includes('table:name="Sin foto"'));
  assert.equal((xml.match(/<table:table-row>/g) || []).length, 3, 'encabezado + 2 filas');
  assert.ok(!xml.includes('<x>'), 'nada sin escapar');
});

test('PDF: A4, repite el encabezado y pagina las listas largas', async () => {
  const filas = Array.from({ length: 120 }, (_, i) => [`Material número ${i + 1}`, `Armario ${i % 7}`, `A${i + 1}`]);
  const c = colector();
  await L.generarPdfListado({ titulo: 'Materiales sin foto', subtitulo: 'Lab', encabezados: L.ENCABEZADOS_SIN_FOTO, filas, anchos: [0.55, 0.3, 0.15], salida: c.salida });
  const buf = c.buffer();
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const paginas = (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.ok(paginas >= 3 && paginas <= 4, `120 filas ocupan 3 o 4 páginas (${paginas})`);
  const vacio = colector();
  await L.generarPdfListado({ titulo: 'x', encabezados: ['a'], filas: [], salida: vacio.salida });
  assert.equal((vacio.buffer().toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
});
