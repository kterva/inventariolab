// Autorización de Drive con la cuenta de un admin (las cuentas de servicio no
// tienen cuota en Drive y no pueden ser dueñas de las fotos).
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
process.env.SHEETS_CACHE_TTL_MS = '50';
process.env.GOOGLE_BACKOFF_MS = '1';
process.env.GOOGLE_CLIENT_ID = 'cliente-id';
process.env.GOOGLE_CLIENT_SECRET = 'cliente-secreto';
process.env.APP_BASE_URL = 'https://ejemplo.uy';
const fs = require('fs'), os = require('os'), path = require('path');
const tokens = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-tokens-'));
process.env.DRIVE_TOKENS_DIR = path.join(tokens, 'carpeta'); // todavía no existe
require('./fake-googleapis');
const test = require('node:test');
const assert = require('node:assert');
const du = require('../driveUsuario');
const gc = require('../googleClient');
const m = global.__mock;

const silenciar = t => {
  const e = console.error, w = console.warn, l = console.log;
  console.error = console.warn = console.log = () => {};
  t.after(() => { console.error = e; console.warn = w; console.log = l; });
};
const img = 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64');

test('sin autorización: estado vacío y la subida falla con un mensaje claro, sin escribir nada', async (t) => {
  silenciar(t);
  assert.deepStrictEqual(du.estado('LABX'), { autorizado: false, email: null });
  assert.equal(du.clienteDrive('LABX'), null);
  await gc.getAppConfig('P7');
  await assert.rejects(gc.subirFoto('P7', 'a@x.uy', 'A0001', img, 'a.jpg'), /admin debe autorizar Drive/);
  assert.equal(m.valores('P7', 'INVENTARIO').find(r => r[0] === 'Probeta')[13] || '', '', 'la planilla no se tocó');
});

test('la URL de autorización pide solo drive.file, permiso permanente y vuelve a la URI esperada', () => {
  assert.equal(du.urlRetorno(), 'https://ejemplo.uy/inventariolab/auth/drive/callback');
  const u = new URL(du.urlAutorizacion('estado123', 'admin@x.uy'));
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.equal(u.searchParams.get('state'), 'estado123');
  assert.equal(u.searchParams.get('redirect_uri'), du.urlRetorno());
});

test('guardar el permiso: archivo con modo 600 en carpeta 700, y desde ahí la subida funciona', async (t) => {
  silenciar(t);
  await du.guardarDesdeCodigo('P8', 'codigo-ok', 'fisica@x.uy');
  const dir = process.env.DRIVE_TOKENS_DIR;
  assert.equal((fs.statSync(dir).mode & 0o777).toString(8), '700');
  assert.equal((fs.statSync(path.join(dir, 'P8.json')).mode & 0o777).toString(8), '600');
  assert.deepStrictEqual(du.estado('P8'), { autorizado: true, email: 'fisica@x.uy' });

  await gc.getAppConfig('P8');
  const { url } = await gc.subirFoto('P8', 'fisica@x.uy', 'A0001', img, 'a.jpg');
  assert.match(url, /^https:\/\/lh3\.googleusercontent\.com\/d\/archivo-img_A0001_/);
});

test('si Google no entrega permiso permanente, se rechaza y no se guarda nada', async () => {
  await assert.rejects(du.guardarDesdeCodigo('P9', 'sin-refresh', 'a@x.uy'), /permiso permanente/);
  await assert.rejects(du.guardarDesdeCodigo('P9', 'malo', 'a@x.uy'), /invalid_grant/);
  assert.equal(du.estado('P9').autorizado, false);
});

test('cada laboratorio tiene su propia autorización', () => {
  assert.equal(du.estado('P8').autorizado, true);
  assert.equal(du.estado('OTRO').autorizado, false);
});
