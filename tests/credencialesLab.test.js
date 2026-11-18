// Cada laboratorio usa sus propias credenciales: las de su dueño (modo usuario) o, si no,
// la cuenta de servicio. Ningún laboratorio recibe las credenciales de otro.
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
process.env.SHEETS_CACHE_TTL_MS = '50';
process.env.GOOGLE_BACKOFF_MS = '1';
process.env.GOOGLE_CLIENT_ID = 'cliente-id';
process.env.GOOGLE_CLIENT_SECRET = 'cliente-secreto';
process.env.APP_BASE_URL = 'https://ejemplo.uy';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DRIVE_TOKENS_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cred-tokens-')), 'carpeta');
require('./fake-googleapis');
const test = require('node:test');
const assert = require('node:assert');
const du = require('../driveUsuario');
const gc = require('../googleClient');
const m = global.__mock;
const img = 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64');

const silenciar = t => {
  const e = console.error, w = console.warn, l = console.log;
  console.error = console.warn = console.log = () => {};
  t.after(() => { console.error = e; console.warn = w; console.log = l; });
};
const refreshDe = apis => apis.sheets.__auth && apis.sheets.__auth.credenciales && apis.sheets.__auth.credenciales.refresh_token;

test('sin permiso del dueño, el laboratorio usa la cuenta de servicio', () => {
  const apis = gc._internos.getApis('LAB-SERVICIO');
  assert.equal(refreshDe(apis), undefined);
  assert.ok(apis.sheets.__auth, 'hay un cliente de servicio');
  assert.equal(du.esModoUsuario('LAB-SERVICIO'), false);
});

test('en modo usuario, Sheets y Drive usan el permiso de ese dueño', async () => {
  await du.guardarDesdeCodigo('LAB-U1', 'ana', 'ana@x.uy', { modo: 'usuario' });
  assert.equal(du.esModoUsuario('LAB-U1'), true);
  const apis = gc._internos.getApis('LAB-U1');
  assert.equal(refreshDe(apis), 'rt-ana');
  assert.equal(apis.drive.__auth.credenciales.refresh_token, 'rt-ana', 'Drive y Sheets comparten el mismo permiso');
});

test('cada laboratorio recibe solo sus credenciales (no se mezclan)', async () => {
  await du.guardarDesdeCodigo('LAB-U2', 'beto', 'beto@x.uy', { modo: 'usuario' });
  assert.equal(refreshDe(gc._internos.getApis('LAB-U1')), 'rt-ana');
  assert.equal(refreshDe(gc._internos.getApis('LAB-U2')), 'rt-beto');
  assert.equal(refreshDe(gc._internos.getApis('LAB-SERVICIO')), undefined);
  assert.equal(refreshDe(gc._internos.getApis('LAB-QUE-NO-EXISTE')), undefined);
});

test('un permiso guardado solo para fotos (sin modo) no cambia cómo se lee la planilla', async () => {
  await du.guardarDesdeCodigo('LAB-FOTOS', 'carla', 'carla@x.uy'); // como los laboratorios actuales
  const apis = gc._internos.getApis('LAB-FOTOS');
  assert.equal(refreshDe(apis), undefined, 'la planilla se sigue leyendo con la cuenta de servicio');
  assert.equal(du.clienteDrive('LAB-FOTOS').__auth.credenciales.refresh_token, 'rt-carla', 'las fotos siguen usando el permiso del admin');
});

test('un laboratorio en modo usuario se lee y recibe fotos con el permiso de su dueño', async (t) => {
  silenciar(t);
  const cfg = await gc.getAppConfig('LAB-U1');
  assert.ok(cfg, 'se pudo leer la planilla');
  const { url } = await gc.subirFoto('LAB-U1', 'ana@x.uy', 'A0001', img, 'a.jpg');
  assert.match(url, /^https:\/\/lh3\.googleusercontent\.com\/d\//);
});

test('si el dueño revoca el permiso, se dice con claridad que hay que reconectar', async (t) => {
  silenciar(t);
  await du.guardarDesdeCodigo('LAB-REV', 'dani', 'dani@x.uy', { modo: 'usuario' });
  m.revocados.add('rt-dani');
  await assert.rejects(gc.getAppConfig('LAB-REV'), /venció o fue revocada.*volver a conectarlo/);
  // y no afecta a los demás laboratorios
  assert.ok(await gc.getAppConfig('LAB-U2'));
});

test('el modo usuario queda guardado en el archivo del permiso (modo 600)', () => {
  const f = path.join(process.env.DRIVE_TOKENS_DIR, 'LAB-U1.json');
  assert.equal((fs.statSync(f).mode & 0o777).toString(8), '600');
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).modo, 'usuario');
});
