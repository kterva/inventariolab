// Exportar: nombres de archivo seguros, ZIP de fotos en streaming y planilla .xlsx.
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
process.env.SHEETS_CACHE_TTL_MS = '50';
process.env.GOOGLE_BACKOFF_MS = '1';
require('./fake-googleapis');
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { Writable } = require('node:stream');
const ex = require('../exportar');
const gc = require('../googleClient');
const m = global.__mock;

/** Lector mínimo de ZIP (método "store"): lee el directorio central y comprueba el CRC de cada archivo */
function leerZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  assert.ok(e >= 0, 'es un ZIP (se encontró el final del directorio central)');
  const cantidad = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const archivos = {};
  for (let i = 0; i < cantidad; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const metodo = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), tam = buf.readUInt32LE(p + 24);
    const n = buf.readUInt16LE(p + 28), x = buf.readUInt16LE(p + 30), c = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + n);
    const datos = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    assert.equal(metodo, 0, `${nombre}: sin compresión`);
    const contenido = buf.subarray(datos, datos + tam);
    assert.equal(zlib.crc32(contenido), crc, `${nombre}: CRC correcto`);
    archivos[nombre] = contenido;
    p += 46 + n + x + c;
  }
  return archivos;
}

function colector() {
  const trozos = [];
  const salida = new Writable({ write(c, _, cb) { trozos.push(c); cb(); } });
  return { salida, buffer: () => Buffer.concat(trozos) };
}
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
const art = (id, articulo, foto, ubicacion = 'Z1') => ({ id, articulo, ubicacion, foto });
const url = id => `https://lh3.googleusercontent.com/d/${id}`;

test('nombreSeguro: sin separadores ni caracteres reservados, con largo acotado', () => {
  assert.equal(ex.nombreSeguro('../../etc/passwd'), 'etc passwd');
  assert.equal(ex.nombreSeguro('Probeta: 50 ml *grande*?'), 'Probeta 50 ml grande');
  assert.equal(ex.nombreSeguro('  ...  '), 'sin nombre');
  assert.equal(ex.nombreSeguro(null), 'sin nombre');
  assert.equal(ex.nombreSeguro('Balanza analítica ñandú'), 'Balanza analítica ñandú');
  assert.equal(ex.nombreSeguro('x'.repeat(500)).length, 60);
});

test('idDeFoto: solo enlaces propios de la app; extensionDe mira los bytes', () => {
  assert.equal(ex.idDeFoto('https://lh3.googleusercontent.com/d/abc_123-XY'), 'abc_123-XY');
  assert.equal(ex.idDeFoto('https://lh3.googleusercontent.com/d/abc=w512'), null);
  assert.equal(ex.idDeFoto('http://lh3.googleusercontent.com/d/abc'), null, 'sin https no');
  assert.equal(ex.idDeFoto('https://evil.example/d/abc'), null);
  assert.equal(ex.idDeFoto('https://lh3.googleusercontent.com.evil.example/d/abc'), null);
  assert.equal(ex.idDeFoto('no es una url'), null);
  assert.equal(ex.extensionDe(JPG), 'jpg');
  assert.equal(ex.extensionDe(PNG), 'png');
  assert.equal(ex.extensionDe(Buffer.from('<html>')), 'img');
});

test('celdaCsv: comillas y neutraliza fórmulas', () => {
  assert.equal(ex.celdaCsv('a,b'), '"a,b"');
  assert.equal(ex.celdaCsv('di "hola"'), '"di ""hola"""');
  assert.equal(ex.celdaCsv('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(ex.celdaCsv('+1'), "'+1");
  assert.equal(ex.celdaCsv(undefined), '');
});

test('el ZIP lleva cada foto con su nombre, un índice y el LEEME; una foto que falla no frena al resto', async () => {
  const fotos = { A1: JPG, A2: PNG, A4: JPG };
  const articulos = [
    art('A0001', 'Probeta 50 ml', url('A1')),
    art('A0002', 'Probeta 50 ml', url('A2')),            // mismo nombre: no se pisa
    art('A0003', 'Imán', url('A3')),                      // la foto no está
    art('A0004', '../../=cmd|calc', url('A4'), '=Z9'),    // nombre malicioso y celda con fórmula
    art('A0005', 'Balanza', 'https://evil.example/x.jpg'), // origen no admitido
  ];
  const descargar = async u => { const id = ex.idDeFoto(u); if (!id) throw new Error('origen no admitido'); if (!fotos[id]) throw new Error('HTTP 404'); return fotos[id]; };
  const { salida, buffer } = colector();
  const r = await ex.armarZip({ articulos, salida, descargar });
  assert.deepEqual([r.fotos, r.fallidas], [3, 2]);

  const z = leerZip(buffer());
  assert.deepEqual(Object.keys(z).sort(), ['LEEME.txt', 'fotos/A0001_Probeta 50 ml.jpg', 'fotos/A0002_Probeta 50 ml.png', 'fotos/A0004_=cmd calc.jpg', 'indice.csv']);
  assert.deepEqual(z['fotos/A0001_Probeta 50 ml.jpg'], JPG);
  assert.deepEqual(z['fotos/A0002_Probeta 50 ml.png'], PNG);
  const indice = z['indice.csv'].toString('utf8');
  assert.ok(indice.startsWith('﻿ID,Artículo,Ubicación,Archivo,Estado'));
  assert.match(indice, /A0001,Probeta 50 ml,Z1,fotos\/A0001_Probeta 50 ml\.jpg,ok/);
  assert.match(indice, /A0003,Imán,Z1,,no se pudo bajar \(HTTP 404\)/);
  assert.match(indice, /A0005,Balanza,Z1,,no se pudo bajar \(origen no admitido\)/);
  assert.ok(indice.includes("'=Z9"), 'la fórmula de la ubicación queda neutralizada');
  assert.ok(!Object.keys(z).some(n => n.includes('..')), 'ninguna entrada sale de la carpeta');
  assert.match(z['LEEME.txt'].toString(), /indice\.csv/);
});

test('mismo nombre dos veces: se numera sin importar mayúsculas', async () => {
  const { salida, buffer } = colector();
  await ex.armarZip({ articulos: [art('A1', 'Lupa', url('x')), art('A1', 'LUPA', url('y'))], salida, descargar: async () => JPG });
  assert.deepEqual(Object.keys(leerZip(buffer())).filter(n => n.startsWith('fotos/')).sort(), ['fotos/A1_LUPA (2).jpg', 'fotos/A1_Lupa.jpg']);
});

test('sin fotos el ZIP igual es válido; con demasiadas fotos se rechaza antes de empezar', async () => {
  const { salida, buffer } = colector();
  assert.deepEqual(await ex.armarZip({ articulos: [], salida, descargar: async () => JPG }), { fotos: 0, fallidas: 0, bytes: 0 });
  assert.deepEqual(Object.keys(leerZip(buffer())).sort(), ['LEEME.txt', 'indice.csv']);
  const muchas = Array.from({ length: ex.MAX_FOTOS + 1 }, (_, i) => art('A' + i, 'x', url('x')));
  await assert.rejects(ex.armarZip({ articulos: muchas, salida: colector().salida }), /más de \d+ fotos/);
});

test('si el cliente se desconecta, se deja de bajar fotos', async () => {
  const cancelador = new AbortController();
  let llamadas = 0;
  const descargar = async () => { llamadas++; if (llamadas === 2) cancelador.abort(); return JPG; };
  const articulos = Array.from({ length: 20 }, (_, i) => art('A' + i, 'x' + i, url('x')));
  const r = await ex.armarZip({ articulos, salida: colector().salida, descargar, señal: cancelador.signal });
  assert.equal(r.cancelado, true);
  assert.ok(llamadas < 6, `se bajaron ${llamadas} fotos de 20`);
});

test('el ZIP no acumula en memoria: espera a que el destino reciba cada foto', async () => {
  // un destino lento: si se bajaran todas las fotos de golpe, `bajadas` llegaría a 30 enseguida
  let bajadas = 0, maximoAdelantado = 0, recibidas = 0;
  const lento = new Writable({ highWaterMark: 1, write(c, _, cb) { recibidas += c.length; setTimeout(cb, 2); } });
  const grande = Buffer.concat([JPG, Buffer.alloc(200000)]);
  const descargar = async () => { bajadas++; maximoAdelantado = Math.max(maximoAdelantado, bajadas - Math.floor(recibidas / grande.length)); return grande; };
  await ex.armarZip({ articulos: Array.from({ length: 30 }, (_, i) => art('A' + i, 'f' + i, url('x'))), salida: lento, descargar });
  assert.ok(maximoAdelantado <= 5, `llegó a ${maximoAdelantado} fotos por delante del destino`);
});

test('la planilla se exporta con el permiso del laboratorio; si es demasiado grande se explica qué hacer', async () => {
  const stream = await gc.abrirExportacionXlsx('LAB-X');
  const trozos = []; for await (const t of stream) trozos.push(t);
  assert.equal(Buffer.concat(trozos).toString(), `XLSX:LAB-X:${ex.MIME_XLSX}`);
  m.exportFalla = 'grande';
  try {
    const silenciar = console.error; console.error = () => {};
    try { await assert.rejects(gc.abrirExportacionXlsx('LAB-X'), e => e.codigo === 'PLANILLA_GRANDE' && /Archivo → Descargar/.test(e.message)); }
    finally { console.error = silenciar; }
  } finally { m.exportFalla = null; }
});
