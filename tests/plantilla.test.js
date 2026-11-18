// La plantilla: lo que "Crear mi laboratorio" deja en el Drive del docente.
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
process.env.SHEETS_CACHE_TTL_MS = '50';
process.env.GOOGLE_BACKOFF_MS = '1';
process.env.GOOGLE_CLIENT_ID = 'cliente-id';
process.env.GOOGLE_CLIENT_SECRET = 'cliente-secreto';
process.env.APP_BASE_URL = 'https://ejemplo.uy';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DRIVE_TOKENS_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plantilla-tokens-')), 'carpeta');
require('./fake-googleapis');
const test = require('node:test');
const assert = require('node:assert');
const du = require('../driveUsuario');
const gc = require('../googleClient');
const pl = require('../plantilla');
const m = global.__mock;

const silenciar = t => {
  const e = console.error, w = console.warn, l = console.log;
  console.error = console.warn = console.log = () => {};
  t.after(() => { console.error = e; console.warn = w; console.log = l; });
};

test('limpiarNombre: una línea, sin caracteres de control, con largo acotado', () => {
  assert.equal(pl.limpiarNombre('  Liceo \n\t Sauce   2 '), 'Liceo Sauce 2');
  assert.equal(pl.limpiarNombre(null), '');
  assert.equal(pl.limpiarNombre('x'.repeat(500)).length, 80);
});

test('crea las 4 hojas, la columna ID protegida, la carpeta de fotos y deja al docente de admin', async (t) => {
  silenciar(t);
  const cuenta = await du.identificarYConectar('lucia');
  assert.equal(cuenta.email, 'lucia@x.uy');
  const r = await pl.crearLaboratorio({ sheets: cuenta.sheets, drive: cuenta.drive, institucion: 'Liceo Norte', laboratorio: 'Biología', adminEmail: cuenta.email });
  assert.match(r.sheetId, /^PLANILLA-NUEVA-/);
  assert.equal(r.carpetaId, 'archivo-' + pl.NOMBRE_CARPETA_FOTOS);
  assert.equal(m.propietarios[r.sheetId], 'rt-lucia', 'la planilla se creó con el permiso de la docente');

  const libro = m.libros[r.sheetId];
  assert.deepEqual(Object.keys(libro).sort(), ['HISTORIAL', 'INVENTARIO', 'config', 'ubicaciones']);
  assert.match(libro.INVENTARIO.titulo, /Biología.*Liceo Norte/);
  assert.deepEqual(m.valores(r.sheetId, 'INVENTARIO')[1], pl.ENCABEZADOS_INVENTARIO);
  assert.deepEqual(m.valores(r.sheetId, 'HISTORIAL')[0], pl.ENCABEZADOS_HISTORIAL);
  assert.deepEqual(m.valores(r.sheetId, 'config')[1].slice(0, 2), ['lucia@x.uy', 'ADMIN']);
  assert.equal(libro.INVENTARIO.protegidos.length, 1);
  assert.equal(libro.INVENTARIO.protegidos[0].description, pl.DESC_PROTECCION_ID);
  assert.equal(libro.INVENTARIO.protegidos[0].range.startColumnIndex, 14, 'protege la columna O (ID)');
});

test('la app lee el laboratorio nuevo sin prepararlo de nuevo y reconoce a la docente como admin', async (t) => {
  silenciar(t);
  const cuenta = await du.identificarYConectar('marta');
  const { sheetId } = await pl.crearLaboratorio({ sheets: cuenta.sheets, drive: cuenta.drive, institucion: 'Liceo Sur', laboratorio: 'Física', adminEmail: cuenta.email });
  du.guardarToken(sheetId, cuenta.refreshToken, cuenta.email, { modo: 'usuario' });

  const cfg = await gc.getAppConfig(sheetId);
  assert.equal(cfg.institucion, 'Liceo Sur');
  assert.equal(cfg.laboratorio, 'Física');
  assert.equal(cfg.accesoPublico, 'SI');
  const permisos = await gc.verificarPermisos(sheetId, 'MARTA@x.uy');
  assert.equal(permisos.esAdmin, true);
  assert.equal((await gc.verificarPermisos(sheetId, 'otra@x.uy')).autorizado, false);

  const antes = m.escrituras;
  await gc.getAppConfig(sheetId);
  assert.equal(m.escrituras, antes, 'no hay nada que preparar: la estructura ya está completa');

  // y se puede crear una zona con el permiso de la docente
  const z = await gc.guardarZona(sheetId, '', 'Armario 1', '');
  assert.equal(z.success, true);
});

test('un nombre que parece fórmula se guarda como texto', async (t) => {
  silenciar(t);
  const cuenta = await du.identificarYConectar('nora');
  const { sheetId } = await pl.crearLaboratorio({ sheets: cuenta.sheets, drive: cuenta.drive, institucion: '=HYPERLINK("http://malo")', laboratorio: 'Lab', adminEmail: cuenta.email });
  const config = m.valores(sheetId, 'config');
  assert.equal(config[1][4], '=HYPERLINK("http://malo")');
});

test('dos docentes crean laboratorios distintos, cada uno con su permiso', async (t) => {
  silenciar(t);
  const a = await du.identificarYConectar('ines'), b = await du.identificarYConectar('olga');
  const ra = await pl.crearLaboratorio({ sheets: a.sheets, drive: a.drive, institucion: 'A', laboratorio: 'LA', adminEmail: a.email });
  const rb = await pl.crearLaboratorio({ sheets: b.sheets, drive: b.drive, institucion: 'B', laboratorio: 'LB', adminEmail: b.email });
  assert.notEqual(ra.sheetId, rb.sheetId);
  assert.equal(m.propietarios[ra.sheetId], 'rt-ines');
  assert.equal(m.propietarios[rb.sheetId], 'rt-olga');
});

test('sin nombres o sin correo no se crea nada', async () => {
  const cuenta = await du.identificarYConectar('pia');
  const antes = m.escrituras;
  await assert.rejects(pl.crearLaboratorio({ sheets: cuenta.sheets, drive: cuenta.drive, institucion: ' ', laboratorio: 'x', adminEmail: cuenta.email }), /nombre del centro/);
  await assert.rejects(pl.crearLaboratorio({ sheets: cuenta.sheets, drive: cuenta.drive, institucion: 'x', laboratorio: 'y', adminEmail: '' }), /correo/);
  assert.equal(m.escrituras, antes);
});

test('una cuenta sin correo verificado o un código sin permiso permanente se rechazan', async () => {
  await assert.rejects(du.identificarYConectar('sin-verificar'), /correo verificado/);
  await assert.rejects(du.identificarYConectar('sin-refresh'), /permiso permanente/);
});
