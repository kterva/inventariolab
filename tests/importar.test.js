const test = require('node:test');
const assert = require('node:assert/strict');
const importar = require('../importar');

test('letraDe: columnas A, Z, AA', () => {
  assert.equal(importar.letraDe(0), 'A');
  assert.equal(importar.letraDe(25), 'Z');
  assert.equal(importar.letraDe(26), 'AA');
});

test('adivinarColumnas: reconoce encabezados comunes, con tildes y mayúsculas, sin repetir columnas', () => {
  const m = importar.adivinarColumnas(['N°', 'MATERIAL', 'Cantidad', 'Rotos', 'Armario', 'Observaciones', 'Código']);
  assert.equal(m.articulo, 1);
  assert.equal(m.bien, 2);
  assert.equal(m.roto, 3);
  assert.equal(m.ubicacion, 4);
  assert.equal(m.obs, 5);
  assert.equal(m.cod, 6);
  assert.equal(m.regular, '');
  const sin = importar.adivinarColumnas(['x', 'y']);
  assert.equal(sin.articulo, '');
});

test('adivinarFilaEncabezados: salta títulos sueltos', () => {
  assert.equal(importar.adivinarFilaEncabezados([['LISTA'], [], ['Artículo', 'Cant'], ['a', '1']]), 3);
  assert.equal(importar.adivinarFilaEncabezados([]), 1);
});

test('convertir: copia al formato de la plantilla, crea zonas, asigna IDs y totaliza', () => {
  const filas = [
    ['Artículo', 'Cant', 'Roto', 'Dónde', 'Nota'],
    ['Probeta', '5', '1', 'Armario A', 'de 100 ml'],
    ['', '', '', '', ''],            // vacía: ni cuenta
    ['Balanza', '2,0', 'x', 'armario a', ''],
    ['Imán', '3', '', 'Armario B', ''],
    ['', '9', '', '', ''],           // sin nombre pero con datos: se omite
    ['=HYPERLINK("http://x")', '1', '0', '', ''],
  ];
  const r = importar.convertir({ filas, filaEncabezados: 1, mapeo: { articulo: 0, bien: 1, roto: 2, ubicacion: 3, obs: 4, cod: '', regular: '' } });
  assert.equal(r.importadas, 4);
  assert.equal(r.omitidas, 1);
  assert.equal(r.cantidadesInvalidas, 1);
  assert.deepEqual(r.zonas, [['Z01', 'Armario A', ''], ['Z02', 'Armario B', '']]);
  const [probeta, balanza, iman, formula] = r.inventario;
  assert.deepEqual([probeta[0], probeta[2], probeta[3], probeta[4], probeta[5], probeta[6], probeta[7], probeta[14]], ['Probeta', 5, 0, 1, 6, 'de 100 ml', 'Armario A', 'A0001']);
  assert.equal(balanza[7], 'Armario A', 'misma zona aunque cambien las mayúsculas');
  assert.deepEqual([balanza[2], balanza[4], balanza[5], balanza[14]], [2, 0, 2, 'A0002']);
  assert.equal(iman[7], 'Armario B');
  assert.equal(formula[0], '=HYPERLINK("http://x")', 'se copia como texto: la planilla nueva se escribe RAW');
  assert.equal(probeta.length, 15);
});

test('convertir: sin columnas de cantidad cada fila vale una unidad; sin artículo falla', () => {
  const r = importar.convertir({ filas: [['Nombre'], ['Vaso']], filaEncabezados: 1, mapeo: { articulo: 0 } });
  assert.deepEqual([r.inventario[0][2], r.inventario[0][5]], [1, 1]);
  assert.throws(() => importar.convertir({ filas: [['x']], filaEncabezados: 1, mapeo: { articulo: '' } }), /nombre del artículo/);
});

test('convertir: respeta el máximo de filas', () => {
  const filas = [['A'], ...Array.from({ length: importar.MAX_FILAS + 5 }, (_, i) => ['art' + i])];
  const r = importar.convertir({ filas, filaEncabezados: 1, mapeo: { articulo: 0 } });
  assert.equal(r.importadas, importar.MAX_FILAS);
  assert.equal(r.omitidas, 5);
});

test('leerOrigen: rechaza ids raros y traduce el 404 en un mensaje claro', async () => {
  await assert.rejects(importar.leerOrigen({}, '../x'), { codigo: 'ID_INVALIDO' });
  const sheets = { spreadsheets: { get: async () => { throw Object.assign(new Error('nf'), { code: 404 }); } } };
  await assert.rejects(importar.leerOrigen(sheets, 'a'.repeat(30)), { codigo: 'SIN_ACCESO' });
});
