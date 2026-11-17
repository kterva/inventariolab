// Caché de lectura y permisos de googleClient, contra el simulador de Google.
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
process.env.SHEETS_CACHE_TTL_MS = '300';
process.env.GOOGLE_BACKOFF_MS = '1';
require('./fake-googleapis');
const test = require('node:test');
const assert = require('node:assert');
const gc = require('../googleClient');
const m = global.__mock;
const dormir = ms => new Promise(r => setTimeout(r, ms));

test('caché, permisos e invalidación', async (t) => {
  const consola = console.error; const aviso = console.warn;
  console.error = () => {}; console.warn = () => {};
  t.after(() => { console.error = consola; console.warn = aviso; });

  await t.test('lecturas concurrentes comparten una sola llamada a Google', async () => {
    const [cfg, perm, filas, zonas] = await Promise.all([
      gc.getAppConfig('L1'), gc.verificarPermisos('L1', 'ADMIN@x.uy '),
      gc.getFilasPorZona('L1', 'Z1'), gc.obtenerZonasAdmin('L1')]);
    assert.equal(m.batchGet, 1);
    assert.equal(cfg.institucion, 'Liceo Test');
    assert.deepEqual(perm, { autorizado: true, esAdmin: true, puedeReportar: true, rol: 'ADMIN' });
    assert.deepEqual(filas.map(f => [f.articulo, f.fila]), [['Balanza', 4], ['Probeta', 3]]);
    assert.deepEqual(zonas, [['Z01', 'Z1', 'a'], ['Z02', 'Z2', 'b']]);
    assert.equal(m.authCreados, 1, 'cliente único');
  });

  await t.test('roles', async () => {
    assert.deepEqual(await gc.verificarPermisos('L1', 'lector@x.uy'), { autorizado: true, esAdmin: false, puedeReportar: true, rol: 'LECTOR' });
    assert.deepEqual(await gc.verificarPermisos('L1', 'visor@x.uy'), { autorizado: true, esAdmin: false, puedeReportar: false, rol: 'VISOR' });
    assert.deepEqual(await gc.verificarPermisos('L1', 'otro@x.uy'), { autorizado: false, esAdmin: false, puedeReportar: false, rol: '' });
  });

  await t.test('búsqueda desde caché', async () => {
    const b = await gc.buscarEnInventario('L1', 'imá');
    assert.deepEqual(b, [{ id: 'A0003', articulo: 'Imán', bien: '2', regular: '0', roto: '0', ubicacion: 'Z2', foto: '', fila: 5 }]);
    assert.equal(m.batchGet, 1, 'dentro del TTL no se vuelve a consultar');
  });

  await t.test('al vencer el TTL se vuelve a leer', async () => {
    await dormir(350);
    await gc.getAppConfig('L1');
    assert.equal(m.batchGet, 2);
  });

  await t.test('una lectura en curso durante una escritura no queda en caché', async () => {
    await dormir(350);
    const enCurso = gc.getAppConfig('L1');
    gc.invalidarLab('L1');
    await enCurso;
    const antes = m.batchGet;
    await gc.getAppConfig('L1');
    assert.equal(m.batchGet, antes + 1);
  });

  await t.test('error transitorio con copia previa: se sirve la copia', async () => {
    await dormir(350);
    m.fallar = 'Quota exceeded (429)';
    assert.equal((await gc.getAppConfig('L1')).institucion, 'Liceo Test');
  });

  await t.test('error de acceso: ACCESO_DENEGADO aunque haya copia', async () => {
    m.fallar = 'Requested entity was not found.'; gc.invalidarLab('L1');
    await assert.rejects(gc.getAppConfig('L1'), /ACCESO_DENEGADO/);
  });

  await t.test('planilla nueva con 429 y sin copia: config por defecto, búsqueda falla', async () => {
    m.fallar = 'Quota exceeded (429)';
    assert.equal((await gc.getAppConfig('L9')).institucion, 'Liceo Sauce 2');
    await assert.rejects(gc.buscarEnInventario('L9', 'x'), /Error interno al buscar: Quota/);
    m.fallar = null;
  });

  await t.test('si falta una hoja, las demás siguen funcionando', async () => {
    m.faltaHoja = 'ubicaciones!A:C';
    assert.equal((await gc.getAppConfig('L2')).institucion, 'Liceo Test');
    assert.deepEqual(await gc.obtenerZonasAdmin('L2'), []);
    assert.equal((await gc.getFilasPorZona('L2', 'Z2')).length, 1);
    m.faltaHoja = null;
  });

  await t.test('modificar lo devuelto no corrompe la caché', async () => {
    (await gc.obtenerZonasAdmin('L1'))[0][1] = 'ROTO';
    assert.equal((await gc.obtenerZonasAdmin('L1'))[0][1], 'Z1');
  });

  await t.test('las escrituras invalidan la caché', async () => {
    await gc.getAppConfig('L3');
    const antes = m.batchGet;
    await gc.registrarReporte('L3', 'a@b', 'A0001', 'roto');
    await gc.getAppConfig('L3');
    assert.equal(m.batchGet, antes + 1);
  });
});
