// Escapado de HTML en las vistas: renderiza las plantillas con datos hostiles
// y ejecuta el JS de la página en un navegador simulado.
const test = require('node:test');
const assert = require('node:assert');
const ejs = require('ejs');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const vista = n => fs.readFileSync(path.join(__dirname, '..', 'views', n), 'utf8');
const scripts = html => [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
// Objeto "comodín": cualquier propiedad o llamada devuelve otro comodín
const stub = () => new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : stub(), apply: () => stub() });
const navegador = () => vm.createContext({ document: stub(), window: stub(), history: stub(), navigator: stub(), localStorage: stub(), location: stub(), setTimeout() {}, console });

const X = `<img src=x onerror=alert(1)>'"</script><script>alert(2)</script>`;
const fila = { id: 'A0007', fila: 7, articulo: 'Probeta ' + X, bien: 2, regular: '1' + X, roto: 0, total: 3, obs: 'obs ' + X,
  ultimo: '[17/11/26] (a@b) ' + X, foto: 'javascript:alert(3)', zona: "Z1');alert(4);('" };
const config = { laboratorio: 'Lab', institucion: 'Liceo', esAdmin: true, autorizado: true, puedeReportar: true, email: 'yo@x', zonasAdmin: ['Z1', X] };

function cargarArmario(cfg) {
  const html = ejs.render(vista('armario.ejs'), { zona: 'Z1', filas: [fila], config: cfg, labId: 'ABC',
    urlLogin: '/inventariolab/lab/ABC/login?redirect=%2Finventariolab%2Flab%2FABC%3Fzona%3DZ1',
    urlCambiarCuenta: '/inventariolab/lab/ABC/logout?redirect=%2Finventariolab%2Flab%2FABC%3Fzona%3DZ1' });
  const sc = scripts(html);
  sc.forEach((c, i) => new vm.Script(c, { filename: 'armario-' + i }));
  const ctx = navegador();
  vm.runInContext(sc.find(c => c.includes('function render(')), ctx);
  return { html, ctx };
}

test('armario: los datos se muestran como texto', () => {
  const { html, ctx } = cargarArmario(config);
  assert.ok(!html.includes('<script>alert(2)'), 'el JSON embebido no corta el <script>');
  const out = vm.runInContext('render(DATA[0])', ctx);
  assert.ok(!/<img src=x/i.test(out) && !/<script>/i.test(out), 'sin etiquetas inyectadas');
  assert.ok(out.includes('Probeta &lt;img src=x onerror=alert(1)&gt;&#39;&quot;&lt;/script&gt;'));
  assert.ok(!out.includes('javascript:'), 'foto con URL no https descartada');
  assert.ok(out.includes(`data-zona='Z1&#39;);alert(4);(&#39;'`) && out.includes('abrirModalMover(this)'));
  assert.ok(out.includes("id='item-A0007' data-id='A0007'"), 'el artículo se identifica por su ID');
  assert.ok(out.includes('(a@b) &lt;img'), 'el último evento también se escapa');
  assert.equal(vm.runInContext('DATA[0].articulo', ctx), fila.articulo, 'los datos llegan intactos al JS');
  const conFoto = vm.runInContext(`render(Object.assign({}, DATA[0], {foto:'https://lh3.googleusercontent.com/d/abc'}))`, ctx);
  assert.ok(conFoto.includes("data-src='https://lh3.googleusercontent.com/d/abc'"));
});

test('armario: formulario de reporte según el rol', () => {
  const render = cfg => vm.runInContext('render(DATA[0])', cargarArmario({ ...config, esAdmin: false, ...cfg }).ctx);
  assert.ok(!render({ autorizado: true, puedeReportar: false }).includes('rep-input'), 'VISOR: sin formulario');
  const lector = render({ autorizado: true, puedeReportar: true });
  assert.ok(lector.includes('rep-input') && !lector.includes('disabled'), 'LECTOR: formulario activo');
  const invitado = render({ autorizado: false, puedeReportar: false, email: '' });
  assert.ok(invitado.includes("class='rep-login' href='/inventariolab/lab/ABC/login?redirect=%2Finventariolab%2Flab%2FABC%3Fzona%3DZ1'"),
    'invitado: enlace al login que vuelve al armario');
  assert.ok(!invitado.includes('rep-input'), 'invitado: sin formulario deshabilitado');
  assert.ok(render({ autorizado: false, puedeReportar: false, email: 'otro@x.uy' }).includes('/logout?redirect='),
    'cuenta sin acceso: cambiar de cuenta, no un login que vuelve acá');
});

test('armario: encabezado con botón de login para el invitado', () => {
  const invitado = cargarArmario({ ...config, esAdmin: false, autorizado: false, puedeReportar: false, email: '' }).html;
  assert.match(invitado, /<header>[\s\S]*class="btn-login" href="\/inventariolab\/lab\/ABC\/login\?redirect=%2Finventariolab%2Flab%2FABC%3Fzona%3DZ1"[\s\S]*<\/header>/);
  const sinAcceso = cargarArmario({ ...config, esAdmin: false, autorizado: false, puedeReportar: false, email: 'otro@x.uy' }).html;
  assert.ok(sinAcceso.includes('no tiene acceso') && sinAcceso.includes('Cambiar de cuenta') && !sinAcceso.includes('🔑 Iniciar sesión'));
  const docente = cargarArmario({ ...config, esAdmin: false }).html;
  assert.ok(!docente.includes('class="btn-login"'), 'con sesión no aparece');
});

test('armario: sin ID no se ofrecen escrituras, y un ID raro se escapa', () => {
  const { ctx } = cargarArmario(config);
  const sinId = vm.runInContext('render(Object.assign({}, DATA[0], { id: "" }))', ctx);
  assert.ok(!sinId.includes('btn-foto') && !sinId.includes('Mover') && sinId.includes('aún no tiene ID'));
  assert.ok(sinId.includes("id='item-fila7'"), 'se puede enlazar por fila mientras no tenga ID');
  const raro = vm.runInContext(`render(Object.assign({}, DATA[0], { id: "x' onmouseover='alert(5)" }))`, ctx);
  assert.ok(!raro.includes("' onmouseover='") && raro.includes('x&#39; onmouseover=&#39;alert(5)'));
});

test('dashboard: esc() y scripts válidos', () => {
  const html = ejs.render(vista('dashboard.ejs'), { config, esAdmin: true, rol: 'ADMIN', email: 'yo@x', labId: 'ABC' });
  scripts(html).forEach((c, i) => new vm.Script(c, { filename: 'dashboard-' + i }));
  const ctx = navegador();
  vm.runInContext(scripts(html).find(c => c.includes('function esc(')), ctx);
  assert.equal(vm.runInContext('WEB_APP_URL', ctx), '/inventariolab/lab/ABC');
  assert.equal(vm.runInContext(`esc(${JSON.stringify(X)})`, ctx),
    '&lt;img src=x onerror=alert(1)&gt;&#39;&quot;&lt;/script&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
});
