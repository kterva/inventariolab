// Pruebas de punta a punta: levanta server.js real con Google simulado y
// prueba roles (vía modo demo) y sesiones persistentes.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SECRETO = 'x'.repeat(64);
let puerto = 3900;

async function arrancar(env) {
  const p = puerto++;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'invlab-'));
  const proc = spawn(process.execPath, ['-r', './tests/fake-googleapis.js', 'server.js'], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(p), SESSION_SECRET: SECRETO, SESSIONS_DIR: path.join(tmp, 'sessions'),
      LOG_ESCRITURAS: path.join(tmp, 'escrituras.log'), GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"sa@test"}',
      GOOGLE_CLIENT_ID: '', NODE_ENV: 'development', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  proc.stdout.on('data', d => { salida += d; }); proc.stderr.on('data', d => { salida += d; });
  for (let i = 0; i < 50 && !salida.includes('Servidor ejecutándose'); i++) {
    if (proc.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const base = `http://127.0.0.1:${p}/inventariolab/lab/LABTEST`;
  const escrituras = () => { try { return fs.readFileSync(path.join(tmp, 'escrituras.log'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
  return { proc, base, tmp, escrituras, salida: () => salida,
    parar: () => new Promise(r => { if (proc.exitCode !== null) return r(); proc.on('exit', r); proc.kill(); }) };
}

// Cliente HTTP mínimo que conserva la cookie de sesión
function cliente() {
  let cookie = '';
  return async (url, opciones = {}) => {
    const res = await fetch(url, { redirect: 'manual', ...opciones,
      headers: { ...(cookie && { cookie }), ...(opciones.body && { 'content-type': 'application/json' }), ...opciones.headers } });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), texto: await res.text(), cookie: () => cookie, setCookie: sc };
  };
}

for (const [rol, esperado] of Object.entries({
  // Escrituras: 2 al abrir el laboratorio por primera vez (columna ID, IDs y
  // hoja HISTORIAL) + 2 por cada cambio permitido (fila + historial).
  VISOR: { etiqueta: '· solo lectura', reportar: 403, mover: 403, escrituras: 2 },
  LECTOR: { etiqueta: '· docente', reportar: 200, mover: 403, escrituras: 4 },
  ADMIN: { etiqueta: '· admin', reportar: 200, mover: 200, escrituras: 6 },
})) {
  test(`rol ${rol}`, async () => {
    const s = await arrancar({ MODO_DEMO: 'SI', DEMO_ROL: rol });
    try {
      const http = cliente();
      assert.ok((await http(`${s.base}?zona=Z1`)).texto.includes(esperado.etiqueta));
      assert.equal((await http(`${s.base}/api/buscar?q=pro`)).status, 200);
      assert.equal((await http(`${s.base}/api/reportar`, { method: 'POST', body: JSON.stringify({ id: 'A0001', texto: 'roto' }) })).status, esperado.reportar);
      assert.equal((await http(`${s.base}/api/mover`, { method: 'POST', body: JSON.stringify({ id: 'A0001', nuevaZona: 'Z2' }) })).status, esperado.mover);
      assert.equal(s.escrituras(), esperado.escrituras, 'escrituras en la planilla');
    } finally { await s.parar(); }
  });
}

test('sesiones: sobreviven a un reinicio, logout y cookies manipuladas', async () => {
  // 1) Se crea la sesión entrando en modo demo
  let s = await arrancar({ MODO_DEMO: 'SI', DEMO_ROL: 'ADMIN' });
  const http = cliente();
  await http(s.base);
  const dir = path.join(s.tmp, 'sessions');
  const archivos = fs.readdirSync(dir);
  assert.equal(archivos.length, 1);
  assert.equal((fs.statSync(dir).mode & 0o777).toString(8), '700');
  assert.equal((fs.statSync(path.join(dir, archivos[0])).mode & 0o777).toString(8), '600');
  await s.parar();

  // 2) Se reinicia SIN modo demo, con la misma carpeta: la cookie sigue valiendo
  //    (invitado@demo.com es ADMIN en la planilla simulada)
  s = await arrancar({ MODO_DEMO: 'NO', SESSIONS_DIR: dir });
  try {
    const r = await http(s.base);
    assert.equal(r.status, 200, 'sigue logueado tras el reinicio');

    // 3) Cookie manipulada: al login, sin romperse
    const falsa = await fetch(s.base, { redirect: 'manual', headers: { cookie: 'connect.sid=s%3A..%2F..%2Fetc%2Fpasswd.firma' } });
    assert.equal(falsa.status, 302);

    // 4) Logout borra la sesión
    await http(`${s.base}/logout`);
    assert.equal(fs.readdirSync(dir).length, 0);
  } finally { await s.parar(); }
});

test('invitado: el armario ofrece login y vuelve al mismo lugar; sin redirecciones a otros sitios', async () => {
  const s = await arrancar({ MODO_DEMO: 'NO' });
  try {
    const http = cliente();
    const armario = await http(`${s.base}?zona=Z1`);
    assert.equal(armario.status, 200);
    const login = `/inventariolab/lab/LABTEST/login?redirect=${encodeURIComponent('/inventariolab/lab/LABTEST?zona=Z1')}`;
    assert.ok(armario.texto.includes(`href="${login.replace(/&/g, '&amp;')}"`), 'botón de login con regreso al armario');

    // La página de login arma el enlace a Google con ese mismo destino...
    const pagLogin = await http(`http://127.0.0.1:${new URL(s.base).port}${login}`);
    assert.ok(pagLogin.texto.includes(encodeURIComponent('/inventariolab/lab/LABTEST?zona=Z1')));
    // ...y descarta destinos fuera de la app
    for (const malo of ['https://malo.example/x', '//malo.example', '/\\malo.example', '/inventariolab/x y']) {
      const r = await http(`http://127.0.0.1:${new URL(s.base).port}/inventariolab/lab/LABTEST/login?redirect=${encodeURIComponent(malo)}`);
      assert.ok(!r.texto.includes('malo.example') && r.texto.includes(encodeURIComponent('/inventariolab/lab/LABTEST')), malo);
    }
  } finally { await s.parar(); }
});

test('con sesión iniciada, /login vuelve directo al destino (validado)', async () => {
  const s = await arrancar({ MODO_DEMO: 'SI', DEMO_ROL: 'ADMIN' });
  try {
    const http = cliente();
    await http(s.base); // el modo demo crea la sesión
    const base = `http://127.0.0.1:${new URL(s.base).port}/inventariolab/lab/LABTEST/login?redirect=`;
    assert.equal((await http(base + encodeURIComponent('/inventariolab/lab/LABTEST?zona=Z2'))).location, '/inventariolab/lab/LABTEST?zona=Z2');
    assert.equal((await http(base + encodeURIComponent('https://malo.example'))).location, '/inventariolab/lab/LABTEST');
  } finally { await s.parar(); }
});

test('sesiones: se limpian vencidas y corruptas al arrancar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invlab-ses-'));
  fs.writeFileSync(path.join(dir, 'vencida.json'), '{"cookie":{"expires":"2020-01-01T00:00:00.000Z"}}');
  fs.writeFileSync(path.join(dir, 'corrupta.json'), '{roto');
  const s = await arrancar({ SESSIONS_DIR: dir });
  await new Promise(r => setTimeout(r, 300));
  await s.parar();
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('producción no arranca con el SESSION_SECRET de ejemplo', async () => {
  const s = await arrancar({ NODE_ENV: 'production', SESSION_SECRET: 'un_secreto_super_seguro_para_vps' });
  await new Promise(r => setTimeout(r, 500));
  assert.notEqual(s.proc.exitCode, null, 'el proceso debe terminar');
  assert.match(s.salida(), /SESSION_SECRET falta o es inseguro/);
  await s.parar();
});

test('buscar por foto: exige sesión, rechaza imágenes vacías y el dashboard ofrece la función', async () => {
  let s = await arrancar({ MODO_DEMO: 'NO' });
  try {
    const sinSesion = await cliente()(`${s.base}/api/buscar-foto`, { method: 'POST', body: JSON.stringify({ base64: 'data:image/jpeg;base64,AAAA' }) });
    assert.equal(sinSesion.status, 401);
  } finally { await s.parar(); }

  s = await arrancar({ MODO_DEMO: 'SI', DEMO_ROL: 'LECTOR' });
  try {
    const http = cliente();
    const vacia = await http(`${s.base}/api/buscar-foto`, { method: 'POST', body: JSON.stringify({ base64: '' }) });
    assert.equal(vacia.status, 400);
    const dash = await http(s.base);
    assert.ok(dash.texto.includes('Buscar por foto'));
  } finally { await s.parar(); }
});

test('autorizar Drive: solo admins, con estado anti-falsificación, y el permiso queda guardado', async () => {
  const tokens = fs.mkdtempSync(path.join(os.tmpdir(), 'invlab-tokens-'));
  const env = { MODO_DEMO: 'NO', GOOGLE_CLIENT_ID: 'cliente-id', GOOGLE_CLIENT_SECRET: 'secreto', APP_BASE_URL: 'http://127.0.0.1', DRIVE_TOKENS_DIR: tokens };

  // Se crea una sesión entrando en modo demo y se reabre sin demo (invitado@demo.com es ADMIN en la planilla simulada)
  let s = await arrancar({ ...env, MODO_DEMO: 'SI', DEMO_ROL: 'ADMIN' });
  const http = cliente();
  await http(s.base);
  const sesiones = path.join(s.tmp, 'sessions');
  await s.parar();

  s = await arrancar({ ...env, SESSIONS_DIR: sesiones });
  try {
    const raiz = `http://127.0.0.1:${new URL(s.base).port}`;
    // sin sesión: al login
    assert.match((await cliente()(`${s.base}/auth/drive`)).location, /\/login$/);

    // con sesión de admin: redirige a Google pidiendo solo drive.file
    const ini = await http(`${s.base}/auth/drive`);
    assert.equal(ini.status, 302);
    const u = new URL(ini.location);
    assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
    const state = u.searchParams.get('state');
    assert.ok(state && state.length >= 32);

    // el panel avisa que falta autorizar
    assert.ok((await http(s.base)).texto.includes('Autorizar Drive para guardar fotos'));

    // estado falso o ausente: rechazado y sin guardar nada
    assert.equal((await http(`${raiz}/inventariolab/auth/drive/callback?state=falso&code=c`)).status, 400);
    assert.equal(fs.readdirSync(tokens).length, 0);

    // estado correcto: guarda el permiso y vuelve al panel
    const ok = await http(`${raiz}/inventariolab/auth/drive/callback?state=${state}&code=codigo-ok`);
    assert.equal(ok.status, 302);
    assert.match(ok.location, /\/lab\/LABTEST\?drive=ok$/);
    assert.deepEqual(fs.readdirSync(tokens), ['LABTEST.json']);

    // el estado es de un solo uso
    assert.equal((await http(`${raiz}/inventariolab/auth/drive/callback?state=${state}&code=codigo-ok`)).status, 400);

    // ya autorizado: el aviso desaparece y se muestra la confirmación
    const panel = await http(`${s.base}?drive=ok`);
    assert.ok(!panel.texto.includes('Autorizar Drive para guardar fotos'));
    assert.ok(panel.texto.includes('Drive autorizado'));
  } finally { await s.parar(); }
});
