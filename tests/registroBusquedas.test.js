const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { crearRegistro } = require('../registroBusquedas');

const silencioso = { error() {}, log() {} };
const nuevo = () => crearRegistro({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'regbus-')), log: silencioso });
const leer = r => fs.readFileSync(r.archivo, 'utf8').trim().split('\n').map(l => JSON.parse(l));

test('anota la búsqueda sin imagen ni datos de la persona', () => {
  const r = nuevo();
  const id = r.busqueda('lab1', {
    resultados: [{ id: 'A0001', articulo: 'Lupa', foto: 'https://x', puntaje: 0.71 }, { id: 'A0002', puntaje: 0.4 }],
    coincide: true, indexados: 105,
  }, 120);
  assert.match(id, /^[0-9a-f]{16}$/);
  const [e] = leer(r);
  assert.deepStrictEqual(e.top, [{ id: 'A0001', p: 0.71 }, { id: 'A0002', p: 0.4 }]);
  assert.strictEqual(e.coincide, true);
  assert.strictEqual(e.ms, 120);
  assert.ok(!JSON.stringify(e).includes('Lupa') && !JSON.stringify(e).includes('https'));
});

test('anota lo que eligió la persona y rechaza datos mal formados', () => {
  const r = nuevo();
  assert.ok(r.eleccion('lab1', { busquedaId: 'a'.repeat(16), accion: 'abrio', articuloId: 'A0001' }));
  assert.ok(r.eleccion('lab1', { busquedaId: 'a'.repeat(16), accion: 'ninguno' }));
  assert.ok(!r.eleccion('lab1', { busquedaId: 'zzz', accion: 'ninguno' }));
  assert.ok(!r.eleccion('lab1', { busquedaId: 'a'.repeat(16), accion: 'borrar' }));
  assert.ok(!r.eleccion('lab1', { busquedaId: 'a'.repeat(16), accion: 'abrio', articuloId: '../x y' }));
  assert.deepStrictEqual(leer(r).map(e => e.accion), ['abrio', 'ninguno']);
});

test('si no puede escribir, no rompe', () => {
  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'regbus-')), 'es-un-archivo');
  fs.writeFileSync(archivo, '');
  const r = crearRegistro({ dir: path.join(archivo, 'adentro'), log: silencioso }); // ENOTDIR
  assert.doesNotThrow(() => r.busqueda('lab1', { resultados: [], coincide: false, indexados: 0 }, 1));
});

test('el contador cuenta búsquedas con elección, sobrevive al reinicio y el aviso se puede descartar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regbus-'));
  const r = crearRegistro({ dir, log: silencioso });
  const ids = [];
  for (let i = 0; i < r.minimo; i++) ids.push(r.busqueda('lab1', { resultados: [{ id: 'A1', puntaje: 0.5 }], coincide: false, indexados: 1 }, 1));
  assert.strictEqual(r.cantidad(), 0, 'sin elección no cuenta');
  for (const id of ids.slice(0, r.minimo - 1)) r.eleccion('lab1', { busquedaId: id, accion: 'ninguno' });
  r.eleccion('lab1', { busquedaId: ids[0], accion: 'abrio', articuloId: 'A1' }); // repetida: no suma
  assert.strictEqual(r.cantidad(), r.minimo - 1);
  assert.strictEqual(r.listoParaVerificar(), false);

  const reiniciado = crearRegistro({ dir, log: silencioso });
  assert.strictEqual(reiniciado.cantidad(), r.minimo - 1, 'el conteo se reconstruye del archivo');
  reiniciado.eleccion('lab1', { busquedaId: ids[r.minimo - 1], accion: 'ninguno' });
  assert.strictEqual(reiniciado.listoParaVerificar(), true);
  reiniciado.descartarAviso();
  assert.strictEqual(reiniciado.listoParaVerificar(), false);
  assert.strictEqual(crearRegistro({ dir, log: silencioso }).listoParaVerificar(), false, 'descartado queda guardado');
});

test('medir-busquedas resume los casos', () => {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regbus-'));
  const r = crearRegistro({ dir, log: silencioso });
  for (let i = 0; i < 6; i++) {
    const id = r.busqueda('lab1', { resultados: [{ id: 'A1', puntaje: 0.7 }, { id: 'A2', puntaje: 0.5 }], coincide: true, indexados: 2 }, 5);
    r.eleccion('lab1', { busquedaId: id, accion: 'abrio', articuloId: 'A1' });
  }
  const salida = execFileSync(process.execPath, [path.join(__dirname, '..', 'medirBusquedas.js'), r.archivo], { encoding: 'utf8' });
  assert.match(salida, /con elección \(casos\): 6/);
  assert.match(salida, /Acertó el 1\.º:\s+6 \(100 %\)/);
  assert.match(salida, /Umbral sugerido/);
});
