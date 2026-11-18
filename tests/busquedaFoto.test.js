// Pruebas de la búsqueda por foto con un "modelo" falso: el embedding de una
// imagen se deduce de sus bytes, así no hace falta descargar nada.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearBuscadorFoto, crearLimitador, ErrorBusquedaFoto, ordenarPorParecido, descargarFoto } = require('../busquedaFoto');

const silencioso = { error() {}, log() {} };
// "imagen" = Buffer con un número; su embedding es un vector unitario según ese número
const img = n => Buffer.from(String(n));
const embeber = async buf => { const n = Number(buf.toString()); const a = n * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; };

function montar(opciones = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'busfoto-'));
  const fotos = { 'https://lh3.googleusercontent.com/d/a': 0, 'https://lh3.googleusercontent.com/d/b': 90, 'https://lh3.googleusercontent.com/d/c': 180 };
  const llamadas = { descargas: 0, embeber: 0 };
  const b = crearBuscadorFoto({
    dir, log: silencioso,
    embeber: async buf => { llamadas.embeber++; return embeber(buf); },
    descargar: async url => { llamadas.descargas++; if (!(url in fotos)) throw new Error('404'); return img(fotos[url]); },
    ...opciones,
  });
  const arts = [
    { id: 'A0001', articulo: 'Lupa', ubicacion: 'Armario 1', foto: 'https://lh3.googleusercontent.com/d/a' },
    { id: 'A0002', articulo: 'Imán', ubicacion: 'Armario 2', foto: 'https://lh3.googleusercontent.com/d/b' },
    { id: 'A0003', articulo: 'Vaso', ubicacion: 'Bajo mesada', foto: 'https://lh3.googleusercontent.com/d/c' },
  ];
  return { b, dir, arts, fotos, llamadas };
}

test('devuelve los más parecidos, de mayor a menor, con los datos del artículo', async () => {
  const { b, arts } = montar();
  const r = await b.buscar('L', arts, img(80), 3); // cerca de 90 (Imán)
  assert.deepStrictEqual(r.resultados.map(x => x.id), ['A0002', 'A0001', 'A0003']);
  assert.strictEqual(r.resultados[0].articulo, 'Imán');
  assert.strictEqual(r.resultados[0].ubicacion, 'Armario 2');
  assert.ok(r.resultados[0].puntaje > r.resultados[1].puntaje);
});

test('coincide solo si el mejor puntaje supera el umbral', async () => {
  const { b, arts } = montar();
  assert.strictEqual((await b.buscar('L', arts, img(5), 3)).coincide, true);   // casi igual a A0001
  assert.strictEqual((await b.buscar('L', arts, img(270), 3)).coincide, false); // lejos de todas
});

test('el índice se arma una vez y se reutiliza; solo se recalcula lo cambiado', async () => {
  const { b, arts, llamadas, fotos } = montar();
  await b.buscar('L', arts, img(0));
  assert.strictEqual(llamadas.descargas, 3);
  await b.buscar('L', arts, img(0));
  assert.strictEqual(llamadas.descargas, 3, 'la segunda búsqueda no vuelve a descargar');

  // el admin cambia la foto de un artículo: otra URL
  fotos['https://lh3.googleusercontent.com/d/nueva'] = 45;
  arts[0] = { ...arts[0], foto: 'https://lh3.googleusercontent.com/d/nueva' };
  await b.buscar('L', arts, img(0));
  assert.strictEqual(llamadas.descargas, 4, 'solo la foto cambiada');
});

test('el índice persiste en disco y sobrevive a un reinicio', async () => {
  const { b, dir, arts } = montar();
  await b.buscar('L', arts, img(0));
  const { b: otro, llamadas } = montar({ dir });
  await otro.buscar('L', arts, img(0));
  assert.strictEqual(llamadas.descargas, 0);
});

test('un artículo al que se le quitó la foto sale del índice', async () => {
  const { b, arts } = montar();
  await b.buscar('L', arts, img(0));
  const r = await b.buscar('L', arts.slice(1), img(0), 3);
  assert.ok(!r.resultados.some(x => x.id === 'A0001'));
});

test('una foto que no se puede bajar no tumba la búsqueda y se reintenta', async () => {
  const { b, arts, fotos } = montar();
  arts.push({ id: 'A0004', articulo: 'Rota', ubicacion: 'X', foto: 'https://lh3.googleusercontent.com/d/rota' });
  let r = await b.buscar('L', arts, img(0));
  assert.strictEqual(r.indexados, 3);
  fotos['https://lh3.googleusercontent.com/d/rota'] = 10; // ahora sí existe
  r = await b.buscar('L', arts, img(0));
  assert.strictEqual(r.indexados, 4);
});

test('sin fotos guardadas devuelve lista vacía', async () => {
  const { b } = montar();
  const r = await b.buscar('L', [], img(0));
  assert.deepStrictEqual(r, { resultados: [], coincide: false, indexados: 0 });
});

test('los laboratorios tienen índices separados', async () => {
  const { b, arts, llamadas } = montar();
  await b.buscar('LAB1', arts, img(0));
  await b.buscar('LAB2', arts, img(0));
  assert.strictEqual(llamadas.descargas, 6);
});

test('procesa de a una y rechaza cuando hay demasiadas en cola', async () => {
  let activas = 0, maxActivas = 0;
  const { b, arts } = montar({
    maxCola: 2,
    embeber: async buf => { activas++; maxActivas = Math.max(maxActivas, activas); await new Promise(r => setTimeout(r, 20)); activas--; return embeber(buf); },
  });
  const a = b.buscar('L', arts, img(0));
  const c = b.buscar('L', arts, img(0));
  assert.throws(() => b.buscar('L', arts, img(0)), e => e instanceof ErrorBusquedaFoto && e.codigo === 'OCUPADO');
  await Promise.all([a, c]);
  assert.strictEqual(maxActivas, 1);
  await b.buscar('L', arts, img(0)); // la cola se vació: vuelve a aceptar
});

test('un índice de otra versión del modelo se descarta', async () => {
  const { b, dir, arts } = montar();
  await b.buscar('L', arts, img(0));
  const f = path.join(dir, 'L.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.modelo = 'otro/modelo'; fs.writeFileSync(f, JSON.stringify(j));
  const { b: nuevo, llamadas } = montar({ dir });
  await nuevo.buscar('L', arts, img(0));
  assert.strictEqual(llamadas.descargas, 3);
});

test('ordenarPorParecido respeta el límite n', () => {
  const ix = new Map([['a', { vec: [1, 0] }], ['b', { vec: [0, 1] }], ['c', { vec: [-1, 0] }]]);
  assert.deepStrictEqual(ordenarPorParecido([1, 0], ix, 2).map(x => x.id), ['a', 'b']);
});

test('limitador por usuario: bloquea al pasar el máximo y libera con la ventana', () => {
  const permitir = crearLimitador(2, 1000);
  assert.ok(permitir('u', 0)); assert.ok(permitir('u', 10));
  assert.ok(!permitir('u', 20));
  assert.ok(permitir('otro', 20));
  assert.ok(permitir('u', 1500));
});

test('solo descarga fotos de los hosts de Google', async () => {
  await assert.rejects(descargarFoto('http://lh3.googleusercontent.com/d/x'), /no permitida/);
  await assert.rejects(descargarFoto('https://ejemplo.com/foto.jpg'), /no permitida/);
  await assert.rejects(descargarFoto('https://169.254.169.254/latest'), /no permitida/);
});
