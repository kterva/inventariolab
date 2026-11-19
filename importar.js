// Importar una planilla que el docente ya tenía.
//
// La planilla original NO se modifica: se lee (con el permiso que el docente
// le dio a la app al elegirla con el selector de Google), se muestran sus
// columnas y la persona indica cuál es cada cosa. Después se crea una planilla
// nueva con la estructura de la plantilla y se copian los datos.
//
// Las funciones de este archivo no hablan con Google salvo `leerOrigen` y
// `copiarDatos`, que reciben el cliente ya autenticado.
const { ENCABEZADOS_INVENTARIO } = require('./plantilla');

const MAX_FILAS = 2000;        // filas de artículos que se importan
const MAX_COLUMNAS = 40;       // columnas que se leen (A..AN)
const MAX_HOJAS = 30;
const VISTA_PREVIA = 6;        // filas que se muestran para elegir columnas
const MAX_TEXTO = 500;         // largo máximo de un texto copiado
const MAX_CANTIDAD = 1000000;

/** Id de archivo de Drive/Sheets: solo letras, números, guion y guion bajo */
const ID_ARCHIVO = /^[A-Za-z0-9_-]{10,100}$/;

/** Letra de columna (0 → A, 26 → AA) */
function letraDe(i) {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

const sinTildes = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Qué campo de la plantilla parece ser cada encabezado de la planilla original */
const SINONIMOS = {
  articulo: ['articulo', 'articulos', 'nombre', 'material', 'materiales', 'item', 'descripcion', 'elemento', 'equipo', 'insumo'],
  cod: ['cod', 'codigo', 'cod interno', 'codigo interno', 'inventario', 'n inventario', 'nro', 'numero'],
  bien: ['bien', 'buen estado', 'buenos', 'buen', 'cantidad', 'cant', 'existencia', 'stock', 'unidades'],
  regular: ['regular', 'regulares', 'estado regular'],
  roto: ['roto', 'rotos', 'danado', 'danados', 'mal estado', 'malos', 'baja'],
  obs: ['observaciones', 'observacion', 'obs', 'notas', 'nota', 'comentarios', 'comentario'],
  ubicacion: ['ubicacion', 'ubicaciones', 'armario', 'armarios', 'zona', 'lugar', 'estante', 'deposito', 'sector'],
};

/** { campo: índice de columna o '' } según los encabezados; cada columna se usa una sola vez */
function adivinarColumnas(encabezados) {
  const norm = encabezados.map(sinTildes);
  const usadas = new Set();
  const mapeo = {};
  for (const campo of Object.keys(SINONIMOS)) {
    let hallada = norm.findIndex((n, i) => !usadas.has(i) && n && SINONIMOS[campo].includes(n));
    if (hallada < 0) hallada = norm.findIndex((n, i) => !usadas.has(i) && n && campo === 'articulo' && SINONIMOS[campo].some(s => n.startsWith(s + ' ')));
    mapeo[campo] = hallada >= 0 ? hallada : '';
    if (hallada >= 0) usadas.add(hallada);
  }
  return mapeo;
}

/** Fila (1 = primera) de los encabezados: la primera de las 10 primeras con al menos dos celdas con texto */
function adivinarFilaEncabezados(filas) {
  for (let i = 0; i < Math.min(filas.length, 10); i++) {
    if ((filas[i] || []).filter(c => String(c == null ? '' : c).trim()).length >= 2) return i + 1;
  }
  return 1;
}

const texto = v => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_TEXTO);

function cantidad(v) {
  const t = String(v == null ? '' : v).trim().replace(',', '.');
  if (!t) return { n: 0, ok: true };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { n: 0, ok: false };
  return { n: Math.min(Math.round(n), MAX_CANTIDAD), ok: true };
}

/**
 * Convierte las filas de la planilla original en las de la plantilla.
 * `mapeo` = { articulo, cod, bien, regular, roto, obs, ubicacion } con el
 * índice de columna (o '' si no se usa). Devuelve
 * { inventario, zonas, importadas, omitidas, cantidadesInvalidas }.
 * `inventario` son filas de 15 columnas con ID ya asignado (A0001…); `zonas`
 * son filas [ID, Nombre, Desc] de la hoja ubicaciones.
 */
function convertir({ filas, filaEncabezados, mapeo }) {
  const idx = campo => (mapeo[campo] === '' || mapeo[campo] == null ? -1 : Number(mapeo[campo]));
  const c = { articulo: idx('articulo'), cod: idx('cod'), bien: idx('bien'), regular: idx('regular'), roto: idx('roto'), obs: idx('obs'), ubicacion: idx('ubicacion') };
  if (c.articulo < 0) throw Object.assign(new Error('Elegí qué columna tiene el nombre del artículo.'), { codigo: 'SIN_ARTICULO' });
  const hayCantidades = c.bien >= 0 || c.regular >= 0 || c.roto >= 0;

  const zonas = new Map(); // nombre en minúsculas -> [ID, nombre, '']
  const inventario = [];
  let omitidas = 0, cantidadesInvalidas = 0;

  for (const fila of filas.slice(filaEncabezados)) {
    const f = fila || [];
    const nombre = texto(f[c.articulo]);
    if (!nombre) { if (f.some(x => String(x == null ? '' : x).trim())) omitidas++; continue; }
    if (inventario.length >= MAX_FILAS) { omitidas++; continue; }

    const q = campo => { if (c[campo] < 0) return 0; const r = cantidad(f[c[campo]]); if (!r.ok) cantidadesInvalidas++; return r.n; };
    let bien = q('bien'); const regular = q('regular'), roto = q('roto');
    if (!hayCantidades) bien = 1; // sin columnas de cantidad: se asume una unidad por fila

    let zona = c.ubicacion >= 0 ? texto(f[c.ubicacion]) : '';
    if (zona) {
      const clave = zona.toLowerCase();
      if (!zonas.has(clave)) zonas.set(clave, ['Z' + String(zonas.size + 1).padStart(2, '0'), zona, '']);
      zona = zonas.get(clave)[1];
    }

    const nueva = new Array(ENCABEZADOS_INVENTARIO.length).fill('');
    nueva[0] = nombre;
    nueva[1] = c.cod >= 0 ? texto(f[c.cod]) : '';
    nueva[2] = bien; nueva[3] = regular; nueva[4] = roto; nueva[5] = bien + regular + roto;
    nueva[6] = c.obs >= 0 ? texto(f[c.obs]) : '';
    nueva[7] = zona;
    nueva[14] = 'A' + String(inventario.length + 1).padStart(4, '0');
    inventario.push(nueva);
  }
  return { inventario, zonas: [...zonas.values()], importadas: inventario.length, omitidas, cantidadesInvalidas };
}

/**
 * Lee de la planilla original su título y, de cada hoja, las primeras filas.
 * `sheets` es el cliente de Google con el permiso de quien la eligió.
 * Devuelve { titulo, hojas: [{ nombre, filas }] } (filas de texto).
 */
async function leerOrigen(sheets, fileId) {
  if (!ID_ARCHIVO.test(String(fileId))) throw Object.assign(new Error('Planilla no válida.'), { codigo: 'ID_INVALIDO' });
  let meta;
  try {
    meta = await sheets.spreadsheets.get({ spreadsheetId: fileId, fields: 'properties.title,sheets.properties(title,sheetType)' });
  } catch (err) {
    if (err && (err.code === 404 || err.status === 404 || err.code === 403 || err.status === 403)) {
      throw Object.assign(new Error('No se pudo abrir esa planilla. Elegila de nuevo con el selector de Google.'), { codigo: 'SIN_ACCESO' });
    }
    throw err;
  }
  const nombres = (meta.data.sheets || []).map(s => s.properties).filter(p => !p.sheetType || p.sheetType === 'GRID').map(p => p.title).slice(0, MAX_HOJAS);
  if (!nombres.length) throw Object.assign(new Error('La planilla no tiene hojas con datos.'), { codigo: 'SIN_HOJAS' });
  const rango = n => `'${n.replace(/'/g, "''")}'!A1:${letraDe(MAX_COLUMNAS - 1)}${MAX_FILAS + 20}`;
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId: fileId, ranges: nombres.map(rango) });
  const hojas = nombres.map((nombre, i) => ({
    nombre,
    filas: ((res.data.valueRanges[i] || {}).values || []).map(f => f.map(c => String(c == null ? '' : c))),
  }));
  return { titulo: texto((meta.data.properties || {}).title), hojas };
}

/** Escribe en la planilla nueva (ya creada con la plantilla) los datos convertidos */
async function copiarDatos({ sheets, sheetId, idHojaInventario, convertido }) {
  const { inventario, zonas } = convertido;
  // la planilla nueva trae 1000 filas: si hacen falta más, se agregan
  const necesarias = inventario.length + 10;
  if (necesarias > 1000 && idHojaInventario != null) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: [
      { appendDimension: { sheetId: idHojaInventario, dimension: 'ROWS', length: necesarias - 1000 } },
    ] } });
  }
  const data = [];
  if (inventario.length) data.push({ range: 'INVENTARIO!A3', values: inventario });
  if (zonas.length) data.push({ range: 'ubicaciones!A2', values: zonas });
  if (data.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: 'RAW', data } });
}

module.exports = { MAX_FILAS, VISTA_PREVIA, ID_ARCHIVO, letraDe, adivinarColumnas, adivinarFilaEncabezados, convertir, leerOrigen, copiarDatos };
