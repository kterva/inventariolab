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

test('buscar por foto: la elección se anota sin datos personales y exige sesión', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invlab-busq-'));
  let s = await arrancar({ MODO_DEMO: 'NO', BUSQUEDAS_LOG_DIR: dir });
  try {
    const sinSesion = await cliente()(`${s.base}/api/buscar-foto/eleccion`, { method: 'POST', body: JSON.stringify({ busquedaId: 'a'.repeat(16), accion: 'ninguno' }) });
    assert.equal(sinSesion.status, 401);
  } finally { await s.parar(); }

  s = await arrancar({ MODO_DEMO: 'SI', DEMO_ROL: 'LECTOR', BUSQUEDAS_LOG_DIR: dir });
  try {
    const http = cliente();
    const ok = await http(`${s.base}/api/buscar-foto/eleccion`, { method: 'POST', body: JSON.stringify({ busquedaId: 'a'.repeat(16), accion: 'abrio', articuloId: 'A0001' }) });
    assert.equal(ok.status, 200);
    await http(`${s.base}/api/buscar-foto/eleccion`, { method: 'POST', body: JSON.stringify({ busquedaId: 'malo', accion: 'abrio' }) });
    const lineas = fs.readFileSync(path.join(dir, 'busquedas.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lineas.length, 1, 'lo mal formado no se anota');
    const e = JSON.parse(lineas[0]);
    assert.equal(e.accion, 'abrio'); assert.equal(e.articulo, 'A0001');
    assert.ok(!('email' in e) && !('usuario' in e));
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

const ENV_CREAR = (tokens, correos, extra = {}) => ({ MODO_DEMO: 'NO', GOOGLE_CLIENT_ID: 'cliente-id', GOOGLE_CLIENT_SECRET: 'secreto', APP_BASE_URL: 'http://127.0.0.1',
  DRIVE_TOKENS_DIR: tokens, CREAR_MIN_MS: '0', AVISO_CREACION_EMAIL: 'leo@aviso.test', SMTP_HOST: 'smtp.test', LOG_CORREOS: correos, ...extra });

/** Abre el formulario (con su token firmado) y lo envía como lo haría el navegador */
async function enviarFormulario(http, raiz, datos = { institucion: 'Liceo', laboratorio: 'Fisica' }, { sinToken = false } = {}) {
  const pagina = await http(`${raiz}/crear`);
  const token = (/name="token" value="([^"]+)"/.exec(pagina.texto) || [])[1] || '';
  return http(`${raiz}/crear`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...(sinToken ? {} : { token }), ...datos }).toString() });
}
const leerCorreos = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
const esperarCorreos = async (f, n) => { for (let i = 0; i < 30 && leerCorreos(f).length < n; i++) await new Promise(r => setTimeout(r, 100)); return leerCorreos(f); };

test('crear mi laboratorio: pide Drive + correo, crea la planilla del docente, lo deja de admin y avisa por correo', async () => {
  const tokens = fs.mkdtempSync(path.join(os.tmpdir(), 'invlab-tokens-'));
  const correos = path.join(tokens, '..', path.basename(tokens) + '-correos.log');
  const s = await arrancar(ENV_CREAR(tokens, correos));
  try {
    const raiz = `http://127.0.0.1:${new URL(s.base).port}/inventariolab`;

    // la página existe y la portada la enlaza
    const http = cliente();
    assert.ok((await http(`${raiz}/crear`)).texto.includes('Continuar con Google'));
    assert.ok((await http(raiz)).texto.includes('/inventariolab/crear'));

    // sin nombres no se llega a Google
    assert.match((await enviarFormulario(http, raiz, { institucion: '  ', laboratorio: 'Física' })).location, /\/crear\?error=nombres$/);

    // con nombres: Google recibe Drive limitado + identidad, con un estado de un solo uso
    const ini = await enviarFormulario(http, raiz, { institucion: 'Liceo Prueba', laboratorio: 'Laboratorio de Química' });
    assert.equal(ini.status, 302);
    const u = new URL(ini.location);
    assert.deepEqual(u.searchParams.get('scope').split(' ').sort(), ['email', 'https://www.googleapis.com/auth/drive.file', 'openid']);
    assert.equal(u.searchParams.get('access_type'), 'offline');
    const state = u.searchParams.get('state');
    assert.ok(state && state.length >= 32);

    // estado falso: rechazado y no se crea nada ni se avisa
    assert.equal((await http(`${raiz}/auth/drive/callback?state=falso&code=ana`)).status, 400);
    assert.equal(fs.readdirSync(tokens).length, 0);
    assert.equal(s.escrituras(), 0);
    assert.equal(leerCorreos(correos).length, 0);

    // estado correcto: crea, guarda el permiso con modo usuario y entra al laboratorio nuevo
    const ok = await http(`${raiz}/auth/drive/callback?state=${state}&code=ana`);
    assert.equal(ok.status, 302);
    assert.match(ok.location, /\/lab\/PLANILLA-NUEVA-1\?creado=1$/);
    assert.deepEqual(fs.readdirSync(tokens), ['PLANILLA-NUEVA-1.json']);
    const guardado = JSON.parse(fs.readFileSync(path.join(tokens, 'PLANILLA-NUEVA-1.json'), 'utf8'));
    assert.equal(guardado.modo, 'usuario'); assert.equal(guardado.email, 'ana@x.uy'); assert.equal(guardado.refresh_token, 'rt-ana');

    // el administrador del servicio recibe un correo con quién fue
    const [aviso] = await esperarCorreos(correos, 1);
    assert.equal(aviso.to, 'leo@aviso.test');
    assert.match(aviso.subject, /ana@x\.uy/);
    assert.match(aviso.text, /Correo: +ana@x\.uy/);
    assert.match(aviso.text, /Centro: +Liceo Prueba/);
    assert.match(aviso.text, /Laboratorio: +Laboratorio de Química/);
    assert.match(aviso.text, /\/inventariolab\/lab\/PLANILLA-NUEVA-1/);

    // la persona ya quedó con sesión y es admin del laboratorio nuevo
    const panel = await http(`${raiz}/lab/PLANILLA-NUEVA-1?creado=1`);
    assert.equal(panel.status, 200);
    assert.ok(panel.texto.includes('Tu laboratorio está creado'));
    assert.ok(panel.texto.includes('Laboratorio de Química'));
    assert.ok(!panel.texto.includes('Autorizar Drive para guardar fotos'), 'ya tiene el permiso de Drive');

    // el estado es de un solo uso y no hay un segundo aviso
    assert.equal((await http(`${raiz}/auth/drive/callback?state=${state}&code=ana`)).status, 400);
    assert.equal(fs.readdirSync(tokens).length, 1);
    assert.equal(leerCorreos(correos).length, 1);
  } finally { await s.parar(); }
});

test('crear mi laboratorio: si se cancela el permiso no se crea nada ni se avisa', async () => {
  const tokens = fs.mkdtempSync(path.join(os.tmpdir(), 'invlab-tokens-'));
  const correos = path.join(tokens, 'correos.log');
  const s = await arrancar(ENV_CREAR(tokens, correos));
  try {
    const raiz = `http://127.0.0.1:${new URL(s.base).port}/inventariolab`;
    const http = cliente();
    const state = new URL((await enviarFormulario(http, raiz)).location).searchParams.get('state');
    const cancelado = await http(`${raiz}/auth/drive/callback?state=${state}&error=access_denied`);
    assert.match(cancelado.location, /\/crear\?error=cancelado$/);
    assert.ok((await http(`${raiz}/crear?error=cancelado`)).texto.includes('Cancelaste el permiso'));

    // una cuenta sin correo verificado tampoco crea nada
    const state2 = new URL((await enviarFormulario(http, raiz)).location).searchParams.get('state');
    assert.match((await http(`${raiz}/auth/drive/callback?state=${state2}&code=sin-verificar`)).location, /\/crear\?error=fallo$/);
    assert.equal(fs.readdirSync(tokens).length, 0);
    assert.equal(s.escrituras(), 0);
    assert.equal(leerCorreos(correos).length, 0);
  } finally { await s.parar(); }
});

test('crear mi laboratorio: un fallo del correo no impide crear el laboratorio', async () => {
  const tokens = fs.mkdtempSync(path.join(os.tmpdir(), 'invlab-tokens-'));
  const s = await arrancar(ENV_CREAR(tokens, path.join(tokens, 'correos.log'), { CORREO_FALLA: 'SI' }));
  try {
    const raiz = `http://127.0.0.1:${new URL(s.base).port}/inventariolab`;
    const http = cliente();
    const state = new URL((await enviarFormulario(http, raiz)).location).searchParams.get('state');
    const ok = await http(`${raiz}/auth/drive/callback?state=${state}&code=eva`);
    assert.match(ok.location, /\/lab\/PLANILLA-NUEVA-1\?creado=1$/);
    assert.deepEqual(fs.readdirSync(tokens), ['PLANILLA-NUEVA-1.json']);
  } finally { await s.parar(); }
});

test('crear mi laboratorio: frena a los bots (formulario falso, apurado, campo trampa, demasiados intentos)', async () => {
  const tokens = fs.mkdtempSync(path.join(os.tmpdir(), 'invlab-tokens-'));
  const s = await arrancar(ENV_CREAR(tokens, path.join(tokens, 'correos.log'), { CREAR_MIN_MS: '60000', CREAR_MAX_POR_IP_HORA: '2' }));
  try {
    const raiz = `http://127.0.0.1:${new URL(s.base).port}/inventariolab`;
    const http = cliente();
    const rechazo = r => assert.match(r.location, /\/crear\?error=formulario$/);
    rechazo(await enviarFormulario(http, raiz, undefined, { sinToken: true }));          // sin token
    rechazo(await enviarFormulario(http, raiz));                                          // enviado en menos de 60 s
    const falso = await http(`${raiz}/crear`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=1700000000000.' + 'a'.repeat(64) + '&institucion=a&laboratorio=b' });
    rechazo(falso);                                                                       // firma inventada
    assert.equal(fs.readdirSync(tokens).filter(n => n.endsWith('.json')).length, 0);
  } finally { await s.parar(); }

  const s2 = await arrancar(ENV_CREAR(tokens, path.join(tokens, 'correos.log'), { CREAR_MAX_POR_IP_HORA: '2' }));
  try {
    const raiz = `http://127.0.0.1:${new URL(s2.base).port}/inventariolab`;
    const http = cliente();
    const pagina = await http(`${raiz}/crear`);
    assert.match(pagina.texto, /name="sitio_web"/, 'el campo trampa está en el formulario');
    const token = /name="token" value="([^"]+)"/.exec(pagina.texto)[1];
    const post = cuerpo => http(`${raiz}/crear`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, institucion: 'L', laboratorio: 'F', ...cuerpo }).toString() });
    assert.match((await post({ sitio_web: 'http://spam' })).location, /error=formulario$/);   // campo trampa completado
    assert.match((await post({})).location, /accounts\.example/);                              // 1.º intento válido de la IP
    assert.match((await post({})).location, /accounts\.example/);                              // 2.º: pasa (el tope es 2 por hora)
    assert.match((await post({})).location, /error=demasiados$/);                                // 3.º: frenado
  } finally { await s2.parar(); }
});

test('crear mi laboratorio: topes por correo, por día y en total', async () => {
  const tokens = fs.mkdtempSync(path.join(os.tmpdir(), 'invlab-tokens-'));
  const s = await arrancar(ENV_CREAR(tokens, path.join(tokens, 'correos.log'), { CREAR_MAX_POR_CORREO: '1', CREAR_MAX_POR_DIA: '2', CREAR_MAX_TOTAL: '3', CREAR_MAX_POR_IP_HORA: '50' }));
  try {
    const raiz = `http://127.0.0.1:${new URL(s.base).port}/inventariolab`;
    const http = cliente();
    const crear = async codigo => {
      const r = await enviarFormulario(http, raiz);
      if (!/accounts\.example/.test(r.location || '')) return r.location;
      return (await http(`${raiz}/auth/drive/callback?state=${new URL(r.location).searchParams.get('state')}&code=${codigo}`)).location;
    };
    assert.match(await crear('ana'), /\/lab\/PLANILLA-NUEVA-1\?creado=1$/);
    assert.match(await crear('ana'), /\/crear\?error=limite-correo$/, 'la misma cuenta no crea otro');
    // un formulario abierto antes de llegar al tope: al enviarlo, el servidor lo rechaza igual
    const abierto = /name="token" value="([^"]+)"/.exec((await http(`${raiz}/crear`)).texto)[1];
    assert.match(await crear('beto'), /\/lab\/PLANILLA-NUEVA-2\?creado=1$/);
    const tarde = await http(`${raiz}/crear`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: abierto, institucion: 'L', laboratorio: 'F' }).toString() });
    assert.match(tarde.location, /\/crear\?error=limite-dia$/, 'tope diario (2)');
    assert.deepEqual(fs.readdirSync(tokens).filter(n => n.endsWith('.json')).sort(), ['PLANILLA-NUEVA-1.json', 'PLANILLA-NUEVA-2.json']);
    // con el tope diario alcanzado la página lo dice y no ofrece el formulario
    const pagina = await http(`${raiz}/crear`);
    assert.ok(pagina.texto.includes('Hoy se alcanzó el máximo'));
    assert.ok(!pagina.texto.includes('Continuar con Google'));
  } finally { await s.parar(); }
});
