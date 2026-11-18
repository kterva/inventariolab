const test = require('node:test');
const assert = require('node:assert');
const ab = require('../antibots');
const av = require('../avisos');

const SECRETO = 's'.repeat(40);

test('token del formulario: firmado, no demasiado rápido ni vencido', () => {
  const t = ab.emitirToken(SECRETO, 1_700_000_000_000);
  assert.equal(ab.validarToken(t, SECRETO, { ahora: 1_700_000_005_000 }), 'ok');
  assert.equal(ab.validarToken(t, SECRETO, { ahora: 1_700_000_001_000 }), 'rapido');
  assert.equal(ab.validarToken(t, SECRETO, { ahora: 1_700_000_000_000 + 3 * 3600 * 1000 }), 'vencido');
  assert.equal(ab.validarToken(t, 'otro-secreto'.repeat(4), { ahora: 1_700_000_005_000 }), 'invalido');
  assert.equal(ab.validarToken('1700000000000.' + 'a'.repeat(64), SECRETO), 'invalido');
  for (const raro of [undefined, '', 'x', null, {}, '1.2', t + 'x']) assert.equal(ab.validarToken(raro, SECRETO), 'invalido');
});

test('topes: total, por día y por correo (sin contar a otros)', () => {
  const ahora = Date.parse('2026-11-18T12:00:00Z');
  const hoy = e => ({ email: e, autorizadoEn: '2026-11-18T08:00:00Z' });
  const ayer = e => ({ email: e, autorizadoEn: '2026-11-16T08:00:00Z' });
  const lim = { total: 5, porDia: 2, porCorreo: 2 };
  assert.equal(ab.motivoDeLimite([], lim, { email: 'a@x', ahora }), null);
  assert.equal(ab.motivoDeLimite([hoy('a@x'), hoy('b@x')], lim, { ahora }), 'limite-dia');
  assert.equal(ab.motivoDeLimite([ayer('a@x'), ayer('a@x'), hoy('b@x')], lim, { email: 'A@x', ahora }), 'limite-correo', 'el correo se compara sin mayúsculas');
  assert.equal(ab.motivoDeLimite([ayer('a@x'), ayer('b@x'), ayer('c@x'), ayer('d@x'), ayer('e@x')], lim, { ahora }), 'limite-total');
  assert.equal(ab.motivoDeLimite([ayer('a@x'), ayer('a@x')], lim, { email: 'otro@x', ahora }), null);
});

test('topes: valores por defecto y variables de entorno', () => {
  assert.deepEqual(ab.topes({}), { total: 200, porDia: 10, porCorreo: 3, porIpHora: 5, minMs: 3000 });
  assert.equal(ab.topes({ CREAR_MAX_POR_DIA: '4', CREAR_MIN_MS: '0' }).minMs, 0);
  assert.equal(ab.topes({ CREAR_MAX_TOTAL: 'mucho' }).total, 200);
});

test('Turnstile: acepta solo si Cloudflare confirma, y falla cerrado ante errores', async () => {
  const llamadas = [];
  const respuesta = ok => async (url, op) => { llamadas.push({ url, cuerpo: String(op.body) }); return { json: async () => ({ success: ok }) }; };
  assert.equal(await ab.verificarTurnstile({ secreto: 's', token: 't', ip: '1.2.3.4', fetchFn: respuesta(true) }), true);
  assert.match(llamadas[0].url, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify$/);
  assert.match(llamadas[0].cuerpo, /secret=s/); assert.match(llamadas[0].cuerpo, /response=t/);
  assert.equal(await ab.verificarTurnstile({ secreto: 's', token: 't', fetchFn: respuesta(false) }), false);
  assert.equal(await ab.verificarTurnstile({ secreto: 's', token: '', fetchFn: respuesta(true) }), false, 'sin respuesta del widget');
  const orig = console.error; console.error = () => {};
  try { assert.equal(await ab.verificarTurnstile({ secreto: 's', token: 't', fetchFn: async () => { throw new Error('red'); } }), false); }
  finally { console.error = orig; }
});

test('aviso: sin configurar no hace nada; el texto lleva quién, qué y dónde', async () => {
  const w = console.warn; console.warn = () => {};
  try { assert.equal(await av.avisarCreacion({}, {}), false); } finally { console.warn = w; }
  assert.equal(av.configuracion({ AVISO_CREACION_EMAIL: 'a@b' }), null, 'falta el servidor SMTP');
  const cfg = av.configuracion({ AVISO_CREACION_EMAIL: 'leo@x', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_SECURE: 'SI', SMTP_PORT: '465' });
  assert.deepEqual(cfg.transporte, { host: 'h', port: 465, secure: true, auth: { user: 'u', pass: 'p' } });
  assert.equal(cfg.de, 'Inventario Laboratorio <u>');
  const m = av.redactar({ email: 'ana@x.uy', institucion: 'Liceo', laboratorio: 'Lab', labId: 'ID1', total: 7, baseUrl: 'https://app.uy', ahora: new Date('2026-11-18T10:00:00Z') });
  assert.match(m.subject, /ana@x\.uy/);
  assert.match(m.text, /https:\/\/app\.uy\/inventariolab\/lab\/ID1/);
  assert.match(m.text, /2026-11-18T10:00:00\.000Z/);
  assert.match(m.text, /: 7$/);
});
