// Escrituras por ID fijo, historial en hoja aparte y reintentos, contra el
// simulador de Google (que modela la planilla como una grilla real).
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
process.env.SHEETS_CACHE_TTL_MS = '50';
process.env.GOOGLE_BACKOFF_MS = '1';
require('./fake-googleapis');
const test = require('node:test');
const assert = require('node:assert');
const gc = require('../googleClient');
const m = global.__mock;
const { calcularIdsFaltantes, getFormattedDate, esTransitorio } = gc._internos;

const silenciar = t => {
  const e = console.error, w = console.warn, l = console.log;
  console.error = console.warn = console.log = () => {};
  t.after(() => { console.error = e; console.warn = w; console.log = l; });
};
const inv = lab => m.valores(lab, 'INVENTARIO');
const historial = lab => m.valores(lab, 'HISTORIAL');
const filaDe = (lab, nombre) => inv(lab).find(r => r[0] === nombre);

test('calcularIdsFaltantes: continúa la numeración, ignora vacías y reemplaza repetidos o inválidos', () => {
  const datos = [
    ['enc'],
    ['A', '', '', '', '', '', '', '', '', '', '', '', '', '', 'A0007'],
    ['B'],
    [''],                                                              // fila sin artículo
    ['C', '', '', '', '', '', '', '', '', '', '', '', '', '', 'A0007'], // copiada y pegada
    ['D', '', '', '', '', '', '', '', '', '', '', '', '', '', "x' or"], // inválido
    ['E', '', '', '', '', '', '', '', '', '', '', '', '', '', 'propio-1'],
  ];
  assert.deepEqual(calcularIdsFaltantes(datos).map(a => [a.fila, a.id]), [[4, 'A0008'], [6, 'A0009'], [7, 'A0010']]);
});

test('fecha en hora de Uruguay aunque el servidor esté en UTC', () => {
  assert.equal(getFormattedDate(new Date('2026-11-17T02:05:00Z')), '16/11/26 23:05');
});

test('qué errores se reintentan', () => {
  assert.ok(esTransitorio({ code: 429, message: 'Quota exceeded' }));
  assert.ok(esTransitorio({ response: { status: 503 }, message: 'x' }));
  assert.ok(esTransitorio({ code: 'ECONNRESET', message: 'socket hang up' }));
  assert.ok(!esTransitorio({ code: 400, message: 'Unable to parse range' }));
  assert.ok(!esTransitorio({ code: 403, message: 'The caller does not have permission' }));
});

test('al abrir un laboratorio se crean la columna ID, los IDs y la hoja HISTORIAL (una sola vez)', async (t) => {
  silenciar(t);
  const filas = await gc.getFilasPorZona('P1', 'Z1');
  assert.deepEqual(filas.map(f => [f.articulo, f.id]), [['Balanza', 'A0002'], ['Probeta', 'A0001']]);
  assert.equal(inv('P1')[1][14], 'ID');
  assert.equal(filaDe('P1', 'Imán')[14], 'A0003');
  assert.deepEqual(historial('P1'), [['Fecha', 'ID', 'Artículo', 'Usuario', 'Acción', 'Detalle']]);
  assert.deepEqual(m.libro('P1').INVENTARIO.protegidos.map(p => [p.warningOnly, p.range.startColumnIndex, p.range.endColumnIndex, p.range.startRowIndex]),
    [[true, 14, 15, 1]], 'columna O protegida con advertencia, desde la fila 2');
  assert.equal(filas.find(f => f.articulo === 'Probeta').ultimo, 'log', 'sin eventos nuevos se muestra la columna J');

  const antes = m.escrituras;
  gc.invalidarLab('P1');
  await gc.getFilasPorZona('P1', 'Z1');
  assert.equal(m.escrituras, antes, 'la segunda carga no escribe nada');
});

test('una fila agregada a mano recibe ID en la próxima carga; una copiada recibe uno nuevo', async (t) => {
  silenciar(t);
  await gc.getAppConfig('P2');
  const libro = m.libro('P2');
  libro.INVENTARIO.filas.push(['Lupa', '', '1', '0', '0', '1', '', 'Z2']);
  libro.INVENTARIO.filas.push([...libro.INVENTARIO.filas[2]]); // Probeta duplicada con su ID
  libro.INVENTARIO.filas[6][0] = 'Probeta (copia)';
  gc.invalidarLab('P2');
  await gc.getAppConfig('P2');
  assert.equal(filaDe('P2', 'Lupa')[14], 'A0004');
  assert.equal(filaDe('P2', 'Probeta')[14], 'A0001', 'el original conserva su ID');
  assert.equal(filaDe('P2', 'Probeta (copia)')[14], 'A0005');
});

test('reportar escribe en la fila correcta aunque se hayan reordenado e insertado filas', async (t) => {
  silenciar(t);
  const filas = await gc.getFilasPorZona('P3', 'Z1');
  const probeta = filas.find(f => f.articulo === 'Probeta');
  assert.equal(probeta.fila, 3);

  // Mientras la página está abierta, alguien ordena la planilla e inserta una fila arriba
  const datos = m.libro('P3').INVENTARIO.filas;
  const [tit, enc, ...resto] = datos;
  resto.sort((a, b) => a[0].localeCompare(b[0]));
  datos.splice(0, datos.length, tit, enc, ['Nuevo', '', '1', '0', '0', '1', '', 'Z1'], ...resto);

  await gc.registrarReporte('P3', 'docente@x.uy', probeta.id, '=HYPERLINK("http://malo") se rompió');
  const actual = filaDe('P3', 'Probeta');
  assert.equal(actual[10], '(docente@x.uy) =HYPERLINK("http://malo") se rompió', 'ticket en K de la Probeta');
  assert.match(actual[8], /^\d\d\/\d\d\/\d\d \d\d:\d\d$/, 'fecha en I');
  assert.ok(!filaDe('P3', 'Balanza')[10], 'la Balanza (que quedó en la fila 3) no se tocó');
  assert.ok(!filaDe('P3', 'Nuevo')[10]);
  assert.equal(actual[9], 'log', 'la columna J vieja no se reescribe');

  const ev = historial('P3').slice(1);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].slice(1), ['A0001', 'Probeta', 'docente@x.uy', 'REPORTE', '=HYPERLINK("http://malo") se rompió']);
  assert.equal(m.llamadas.filter(x => x === 'values.append').length >= 1, true);

  const tras = await gc.getFilasPorZona('P3', 'Z1');
  assert.match(tras.find(f => f.id === 'A0001').ultimo, /^\[.*\] \(docente@x\.uy\) =HYPERLINK/, 'la vista muestra el último evento');
});

test('mover y foto quedan en el historial; reportes concurrentes no se pisan', async (t) => {
  silenciar(t);
  await gc.getAppConfig('P4');
  await gc.cambiarUbicacion('P4', 'admin@x.uy', 'A0002', 'Z2');
  assert.equal(filaDe('P4', 'Balanza')[7], 'Z2');
  const url = await gc.subirFoto('P4', 'admin@x.uy', 'A0003', 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64'), 'x.jpg');
  assert.match(url, /^https:\/\/lh3\.googleusercontent\.com\/d\/archivo-img_A0003_/);
  assert.equal(filaDe('P4', 'Imán')[13], url);

  await Promise.all(Array.from({ length: 5 }, (_, i) => gc.registrarReporte('P4', `d${i}@x.uy`, 'A0001', `problema ${i}`)));
  const ev = historial('P4').slice(1);
  assert.deepEqual(ev.slice(0, 2).map(r => [r[1], r[4], r[5]]), [
    ['A0002', 'MOVIDO', "🚚 Movido de 'Z1' a 'Z2'"],
    ['A0003', 'FOTO', '📸 Imagen agregada'],
  ]);
  assert.deepEqual(ev.slice(2).map(r => r[5]).sort(), [0, 1, 2, 3, 4].map(i => `problema ${i}`), 'los 5 reportes quedaron registrados');
});

test('la carpeta LAB_FOTOS se busca una sola vez por laboratorio', async (t) => {
  silenciar(t);
  await gc.getAppConfig('P5');
  const img = 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64');
  const antes = m.llamadas.filter(x => x === 'drive.list').length;
  await gc.subirFoto('P5', 'a@x.uy', 'A0001', img, 'a.jpg');
  await gc.subirFoto('P5', 'a@x.uy', 'A0002', img, 'b.jpg');
  assert.equal(m.llamadas.filter(x => x === 'drive.list').length - antes, 1);
  assert.equal(historial('P5')[2][5], '📸 Imagen agregada');
});

test('errores claros: ID inexistente, duplicado o faltante', async (t) => {
  silenciar(t);
  await gc.getAppConfig('P6');
  await assert.rejects(gc.registrarReporte('P6', 'a@x.uy', 'A0999', 'roto'), /ya no está en la planilla/);
  await assert.rejects(gc.registrarReporte('P6', 'a@x.uy', 3, 'roto'), /Falta el ID/, 'un número de fila viejo no se acepta');
  await assert.rejects(gc.registrarReporte('P6', 'a@x.uy', undefined, 'roto'), /Falta el ID/);
  m.libro('P6').INVENTARIO.filas[4][14] = 'A0001'; // alguien pegó un ID repetido a mano
  await assert.rejects(gc.registrarReporte('P6', 'a@x.uy', 'A0001', 'roto'), /Hay 2 filas con el ID A0001/);
  assert.equal(historial('P6').length, 1, 'nada se registró');
});

test('una escritura que falla con 503 se reintenta y no se duplica', async (t) => {
  silenciar(t);
  await gc.getAppConfig('P7');
  m.fallarEscrituras = 2; // falla la escritura de la fila dos veces, la tercera anda
  await gc.registrarReporte('P7', 'a@x.uy', 'A0002', 'se cayó');
  assert.equal(filaDe('P7', 'Balanza')[10], '(a@x.uy) se cayó');
  assert.equal(historial('P7').length, 2, 'un solo evento');

  m.fallarEscrituras = 10; // falla siempre: se rinde tras 3 reintentos
  await assert.rejects(gc.registrarReporte('P7', 'a@x.uy', 'A0002', 'otra vez'), /unavailable/);
  assert.equal(m.fallarEscrituras, 6, '1 intento + 3 reintentos');
  m.fallarEscrituras = 0;
});

test('si la cuenta de servicio solo puede leer, la app sigue mostrando el inventario', async (t) => {
  silenciar(t);
  m.soloLectura = true;
  try {
    const filas = await gc.getFilasPorZona('P8', 'Z1');
    assert.deepEqual(filas.map(f => [f.articulo, f.id]), [['Balanza', ''], ['Probeta', '']]);
    await assert.rejects(gc.registrarReporte('P8', 'a@x.uy', 'A0001', 'roto'), /debe llamarse "ID"/);
  } finally { m.soloLectura = false; }
});

test('una planilla ya preparada pero sin protección la recibe una sola vez', async (t) => {
  silenciar(t);
  // Planilla que ya tiene columna ID e HISTORIAL (p. ej. preparada por una versión anterior)
  const libro = m.libro('P9');
  libro.INVENTARIO.columnas = 15;
  libro.INVENTARIO.filas[1][14] = 'ID';
  ['A0001', 'A0002', 'A0003'].forEach((id, i) => { const f = libro.INVENTARIO.filas[i + 2]; while (f.length < 14) f.push(''); f[14] = id; });
  libro.HISTORIAL = { filas: [['Fecha', 'ID', 'Artículo', 'Usuario', 'Acción', 'Detalle']], columnas: 26 };
  const antes = m.escrituras;
  await gc.getAppConfig('P9');
  assert.equal(m.escrituras - antes, 1, 'solo el pedido de protección');
  assert.equal(libro.INVENTARIO.protegidos.length, 1);
  gc.invalidarLab('P9');
  await gc.getAppConfig('P9');
  assert.equal(libro.INVENTARIO.protegidos.length, 1, 'no se duplica');
  assert.equal(m.escrituras - antes, 1);
});

test('un rango protegido que la app no puede editar da un mensaje claro', async (t) => {
  silenciar(t);
  await gc.getAppConfig('P10');
  m.protegidas = [7, 8]; // columnas H e I, como la protección "A:J" de una planilla real
  try {
    await assert.rejects(gc.cambiarUbicacion('P10', 'a@x.uy', 'A0001', 'Z2'), /rango protegido.*columnas H, I.*cuenta de servicio/);
    assert.equal(historial('P10').length, 1, 'no se registró un evento que no ocurrió');
  } finally { m.protegidas = null; }
});
