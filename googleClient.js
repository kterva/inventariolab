const { google } = require('googleapis');
const driveUsuario = require('./driveUsuario');
const { NOMBRE_CARPETA_FOTOS, DESC_PROTECCION_ID, ENCABEZADOS_HISTORIAL } = require('./plantilla');

// Inicializa el cliente de Google Auth con la Cuenta de Servicio
function getAuthClient() {
  let credentials;
  try {
    const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!jsonStr) {
      console.warn('⚠️ No se proporcionó GOOGLE_SERVICE_ACCOUNT_JSON. Operaciones en Google fallarán.');
      return null;
    }
    credentials = JSON.parse(jsonStr);
  } catch (err) {
    console.error('Error al parsear GOOGLE_SERVICE_ACCOUNT_JSON:', err);
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  return auth;
}

const MSG_CONEXION_VENCIDA = 'La conexión del laboratorio con Google venció o fue revocada: un administrador debe volver a conectarlo.';
const errConexionVencida = () => Object.assign(new Error(MSG_CONEXION_VENCIDA), { codigo: 'CONEXION_VENCIDA' });

// ─── CLIENTE ÚNICO ─────────────────────────────────────
// Se crea una sola vez por proceso: así GoogleAuth reutiliza el token de la
// cuenta de servicio en vez de pedir uno nuevo en cada consulta.
let _apis = null;
function apisDeServicio() {
  if (_apis) return _apis;
  const auth = getAuthClient();
  _apis = auth
    ? { sheets: google.sheets({ version: 'v4', auth }), drive: google.drive({ version: 'v3', auth }) }
    : { sheets: null, drive: null };
  return _apis;
}

/**
 * Clientes de Google para un laboratorio. Si el laboratorio se maneja con el
 * permiso de su dueño (modo usuario), se usa ese permiso; si no, la cuenta de
 * servicio. Cada laboratorio recibe solo sus propias credenciales.
 */
function getApis(labId) {
  const sheets = labId ? driveUsuario.clienteSheets(labId) : null;
  if (sheets) return { sheets, drive: driveUsuario.clienteDrive(labId) };
  return apisDeServicio();
}

// ─── CACHÉ DE LECTURA ──────────────────────────────────
// Cada laboratorio (planilla) se lee con UN solo batchGet que trae config,
// inventario y ubicaciones, y se guarda en memoria durante CACHE_TTL_MS.
// La planilla sigue siendo la fuente de verdad:
//  - las escrituras de la app invalidan la caché del laboratorio;
//  - los cambios hechos a mano en la planilla aparecen al vencer el TTL.

const CACHE_TTL_MS = Number(process.env.SHEETS_CACHE_TTL_MS) || 30 * 1000;
// Si Google falla de forma transitoria (cuota 429, 5xx, red), se sigue
// sirviendo la última copia buena hasta este límite de antigüedad.
const CACHE_STALE_MAX_MS = Number(process.env.SHEETS_CACHE_STALE_MAX_MS) || 10 * 60 * 1000;
const REINTENTO_TRAS_ERROR_MS = 5 * 1000;

// La hoja INVENTARIO se lee desde la fila 2 (encabezados) para poder ver si
// ya existe la columna ID. Si la grilla tiene menos columnas que O, Google
// recorta el rango sin dar error.
const RANGOS = {
  config: 'config!A1:E100',
  inventario: 'INVENTARIO!A2:O',
  ubicaciones: 'ubicaciones!A:C',
  historial: 'HISTORIAL!A2:F',
};

// Columnas de INVENTARIO (índice 0 = columna A)
const COL = { ART: 0, BIEN: 2, REG: 3, ROTO: 4, TOTAL: 5, OBS: 6, ZONA: 7, FECHA: 8, LOG: 9, REP: 10, FOTO: 13, ID: 14 };
const LETRA = i => String.fromCharCode(65 + i);
const PRIMERA_FILA = 3; // la fila 1 es el título y la 2 los encabezados

const HOJA_HISTORIAL = 'HISTORIAL';

// ─── REINTENTOS ───────────────────────────────────────
// googleapis ya reintenta por su cuenta los GET y PUT (lecturas y
// values.update) ante 429/5xx, pero no los POST: values.batchUpdate,
// values.append, spreadsheets.batchUpdate y las subidas a Drive. Esas
// llamadas pasan por conReintentos().
const REINTENTOS = process.env.GOOGLE_REINTENTOS !== undefined ? Number(process.env.GOOGLE_REINTENTOS) : 3;
const BACKOFF_MS = Number(process.env.GOOGLE_BACKOFF_MS) || 500;
const CODIGOS_RED = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH'];

function esTransitorio(err) {
  const estado = Number((err && (err.status || (err.response && err.response.status))) || err && err.code);
  if ([408, 429, 500, 502, 503, 504].includes(estado)) return true;
  if (err && CODIGOS_RED.includes(err.code)) return true;
  return /quota exceeded|rate limit|backend error|internal error|service unavailable|\b(429|5\d\d)\b/i.test((err && err.message) || '');
}

async function conReintentos(fn, etiqueta = 'llamada a Google') {
  for (let intento = 0; ; intento++) {
    try {
      return await fn();
    } catch (err) {
      if (/invalid_grant/i.test((err && err.message) || '')) throw errConexionVencida();
      if (intento >= REINTENTOS || !esTransitorio(err)) throw err;
      const ms = Math.round(BACKOFF_MS * 2 ** intento * (0.5 + Math.random()));
      console.warn(`[reintento] ${etiqueta} falló (${err.message}); intento ${intento + 2} en ${ms} ms`);
      await new Promise(r => setTimeout(r, ms));
    }
  }
}

// sheetId -> { gen, datos, cargadoEn, expira, promesa }
const _cache = new Map();

function esErrorDeAcceso(err) {
  const msg = (err && err.message) || '';
  return msg.includes('Requested entity was not found') || msg.includes('permission') || msg.includes('unregistered') || /invalid_grant/i.test(msg) || (err && err.codigo === 'CONEXION_VENCIDA');
}


/** Lee las tres hojas de un laboratorio en una sola llamada a la API */
async function leerLab(sheetId) {
  const { sheets } = getApis(sheetId);
  if (!sheets) throw new Error("Google APIs no inicializadas");

  const claves = Object.keys(RANGOS);
  let datos;
  try {
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges: claves.map(k => RANGOS[k]),
    });
    datos = { errores: {} };
    claves.forEach((k, i) => { datos[k] = res.data.valueRanges[i].values || []; });
  } catch (err) {
    // Si falta alguna hoja, batchGet falla entero. En ese caso se leen por
    // separado para que las demás sigan funcionando como antes.
    if (/invalid_grant/i.test(err.message || '')) throw errConexionVencida();
    if (!/Unable to parse range/i.test(err.message || '')) throw err;
    const resultados = await Promise.allSettled(
      claves.map(k => sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: RANGOS[k] }))
    );
    datos = { errores: {} };
    claves.forEach((k, i) => {
      const r = resultados[i];
      if (r.status === 'fulfilled') datos[k] = r.value.data.values || [];
      else { datos[k] = null; datos.errores[k] = r.reason; }
    });
  }

  // La primera vez que se abre un laboratorio se crean la columna ID, los
  // IDs que falten y la hoja HISTORIAL. Si no se puede (p. ej. la cuenta de
  // servicio solo tiene permiso de lectura) la app sigue funcionando para leer.
  try {
    await prepararLab(sheetId, datos);
  } catch (err) {
    console.error(`[prepararLab] ${sheetId}: ${err.message}`);
  }
  return datos;
}

// ─── ID FIJO POR ARTÍCULO E HISTORIAL ─────────────────
// Cada artículo tiene un ID en la columna O de INVENTARIO ("A0001", ...).
// Las escrituras se hacen por ID y no por número de fila, así que ordenar,
// insertar o borrar filas en la planilla no hace que un cambio caiga en otro
// artículo. Los eventos de la app se agregan a la hoja HISTORIAL con
// values.append, que nunca pisa lo que escribió otro.

// Al menos una letra: así un número de fila nunca se confunde con un ID
const ID_VALIDO = /^(?=.*[A-Za-z])[A-Za-z0-9_-]{1,40}$/;

/**
 * Recorre INVENTARIO (leído desde la fila 2) y devuelve los IDs a asignar:
 * filas con artículo y sin ID, con un ID inválido o repetido (fila copiada
 * y pegada: conserva el ID la primera aparición).
 */
function calcularIdsFaltantes(inv) {
  const vistos = new Set();
  const faltan = [];
  let max = 0;
  for (let k = 1; k < inv.length; k++) {
    const row = inv[k] || [];
    if (!(row[COL.ART] || '').toString().trim()) continue;
    const id = (row[COL.ID] || '').toString().trim();
    if (ID_VALIDO.test(id) && !vistos.has(id)) {
      vistos.add(id);
      const m = /^A(\d+)$/.exec(id);
      if (m) max = Math.max(max, Number(m[1]));
    } else {
      faltan.push(k);
    }
  }
  return faltan.map(k => {
    let id;
    do { id = 'A' + String(++max).padStart(4, '0'); } while (vistos.has(id));
    vistos.add(id);
    return { k, fila: k + 2, id };
  });
}

// La columna ID se protege con "solo advertencia": quien puede editar la
// planilla (los administradores) ve un aviso antes de tocar un ID, pero nada
// se bloquea (ni la app, ni ordenar o insertar filas).

// Laboratorios cuya protección de la columna ID ya se verificó en este proceso
const _protegidos = new Set();

function necesitaPreparacion(sheetId, datos) {
  const inv = datos.inventario;
  if (!inv) return false; // sin hoja INVENTARIO no hay nada que preparar
  const enc = ((inv[0] || [])[COL.ID] || '').toString().trim();
  if (enc && enc.toUpperCase() !== 'ID') return false; // columna O ocupada: ver ubicarArticulo
  return datos.historial === null || enc.toUpperCase() !== 'ID' || !_protegidos.has(sheetId) ||
    calcularIdsFaltantes(inv).length > 0;
}

// sheetId -> promesa de la preparación en curso (una a la vez por laboratorio)
const _preparando = new Map();
// sheetId -> momento del último fallo (para no reintentar en cada lectura)
const _prepFallida = new Map();
const ESPERA_TRAS_FALLO_PREP_MS = 10 * 60 * 1000;

async function prepararLab(sheetId, datos) {
  if (!necesitaPreparacion(sheetId, datos)) return;
  if (Date.now() - (_prepFallida.get(sheetId) || 0) < ESPERA_TRAS_FALLO_PREP_MS) return;
  const previa = _preparando.get(sheetId) || Promise.resolve();
  const actual = previa.catch(() => {}).then(() => ejecutarPreparacion(sheetId, datos));
  _preparando.set(sheetId, actual);
  try {
    await actual;
    _prepFallida.delete(sheetId);
  } catch (err) {
    _prepFallida.set(sheetId, Date.now());
    throw err;
  } finally {
    if (_preparando.get(sheetId) === actual) _preparando.delete(sheetId);
  }
}

async function ejecutarPreparacion(sheetId, datos) {
  const { sheets } = getApis(sheetId);

  // Se vuelve a leer en el momento, por si otra preparación o una edición a
  // mano cambió algo desde la lectura que trajo `datos`.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets(properties(title,sheetId,gridProperties.columnCount),protectedRanges(description))',
  });
  const props = meta.data.sheets.map(s => s.properties);
  const pInv = props.find(p => p.title === 'INVENTARIO');
  const protegida = meta.data.sheets.some(s => (s.protectedRanges || []).some(r => r.description === DESC_PROTECCION_ID));
  if (!pInv) return;
  const fresca = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: RANGOS.inventario });
  const inv = fresca.data.values || [];
  const enc = ((inv[0] || [])[COL.ID] || '').toString().trim();
  if (enc && enc.toUpperCase() !== 'ID') {
    console.warn(`[prepararLab] ${sheetId}: la columna ${LETRA(COL.ID)} de INVENTARIO tiene otro encabezado ("${enc}"); no se asignan IDs.`);
    datos.inventario = inv;
    return;
  }

  // 1. Estructura: hoja HISTORIAL y una columna más en INVENTARIO si hace falta
  const pedidos = [];
  const faltaHistorial = !props.some(p => p.title === HOJA_HISTORIAL);
  if (faltaHistorial) pedidos.push({ addSheet: { properties: { title: HOJA_HISTORIAL, gridProperties: { frozenRowCount: 1 } } } });
  if (pInv.gridProperties.columnCount < COL.ID + 1) {
    pedidos.push({ appendDimension: { sheetId: pInv.sheetId, dimension: 'COLUMNS', length: COL.ID + 1 - pInv.gridProperties.columnCount } });
  }
  if (!protegida) {
    pedidos.push({ addProtectedRange: { protectedRange: {
      description: DESC_PROTECCION_ID,
      warningOnly: true,
      range: { sheetId: pInv.sheetId, startRowIndex: 1, startColumnIndex: COL.ID, endColumnIndex: COL.ID + 1 },
    } } });
  }
  if (pedidos.length) {
    await conReintentos(() => sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: pedidos } }), 'preparar estructura');
  }

  // 2. Valores: encabezados e IDs faltantes, en una sola escritura
  const asignar = calcularIdsFaltantes(inv);
  const data = asignar.map(a => ({ range: `INVENTARIO!${LETRA(COL.ID)}${a.fila}`, values: [[a.id]] }));
  if (enc.toUpperCase() !== 'ID') data.push({ range: `INVENTARIO!${LETRA(COL.ID)}2`, values: [['ID']] });
  if (faltaHistorial) data.push({ range: `${HOJA_HISTORIAL}!A1:F1`, values: [ENCABEZADOS_HISTORIAL] });
  if (data.length) {
    await conReintentos(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId, requestBody: { valueInputOption: 'RAW', data },
    }), 'asignar IDs');
  }
  if (asignar.length) console.log(`[prepararLab] ${sheetId}: ${asignar.length} IDs asignados`);

  // 3. Los datos que se van a cachear reflejan lo que quedó en la planilla
  if (!inv[0]) inv[0] = [];
  inv[0][COL.ID] = 'ID';
  for (const a of asignar) {
    const row = inv[a.k];
    while (row.length < COL.ID) row.push('');
    row[COL.ID] = a.id;
  }
  datos.inventario = inv;
  if (datos.historial === null) { datos.historial = []; delete datos.errores.historial; }
  _protegidos.add(sheetId);
}

/** Devuelve los datos del laboratorio desde caché, o los lee si vencieron */
function cargarLab(sheetId) {
  let e = _cache.get(sheetId);
  if (e && e.datos && e.expira > Date.now()) return Promise.resolve(e.datos);
  if (e && e.promesa) return e.promesa; // ya hay una lectura en curso: se comparte

  if (!e) { e = { gen: 0 }; _cache.set(sheetId, e); }
  const gen = e.gen;

  const promesa = leerLab(sheetId).then(
    datos => {
      const actual = _cache.get(sheetId);
      // Solo se guarda si no hubo una escritura (invalidación) mientras se leía
      if (actual && actual.gen === gen) {
        actual.datos = datos;
        actual.cargadoEn = Date.now();
        actual.expira = actual.cargadoEn + CACHE_TTL_MS;
        actual.promesa = null;
      }
      return datos;
    },
    err => {
      const actual = _cache.get(sheetId);
      if (actual && actual.promesa === promesa) actual.promesa = null;
      // Error transitorio con copia previa reciente: servir la copia
      if (actual && actual.datos && !esErrorDeAcceso(err) &&
          Date.now() - actual.cargadoEn < CACHE_STALE_MAX_MS) {
        console.warn(`[cache] Error leyendo ${sheetId}, se sirve copia previa: ${err.message}`);
        actual.expira = Date.now() + REINTENTO_TRAS_ERROR_MS;
        return actual.datos;
      }
      throw err;
    }
  );
  e.promesa = promesa;
  return promesa;
}

/** Descarta la caché de un laboratorio (se llama después de cada escritura) */
function invalidarLab(sheetId) {
  const e = _cache.get(sheetId);
  _cache.set(sheetId, { gen: (e ? e.gen : 0) + 1 });
}

/** Devuelve una hoja de los datos cargados, o lanza el error con que falló */
function hoja(datos, clave) {
  if (datos[clave] === null) throw datos.errores[clave];
  return datos[clave];
}

// Limpieza periódica de laboratorios que nadie consulta hace rato
setInterval(() => {
  const limite = Date.now() - CACHE_STALE_MAX_MS;
  for (const [id, e] of _cache) {
    if (!e.promesa && (!e.cargadoEn || e.cargadoEn < limite)) _cache.delete(id);
  }
}, 5 * 60 * 1000).unref();

// ─── LECTURA ──────────────────────────────────────────

/** Lee los parámetros institucionales y del laboratorio de la hoja 'config' */
async function getAppConfig(sheetId) {
  const config = {
    institucion: "Liceo Sauce 2",
    laboratorio: "Laboratorio de Física",
    accesoPublico: "SI",
    isDemo: "NO",
    demoRol: "LECTOR"
  };

  try {
    const data = hoja(await cargarLab(sheetId), 'config');
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 5) { // Las claves en columna D (3), valores en E (4)
        const clave = (row[3] || '').toString().toLowerCase().trim();
        const valor = (row[4] || '').toString().trim();
        if (clave === 'institucion' || clave === 'liceo' || clave === 'institución') {
          if (valor) config.institucion = valor;
        } else if (clave === 'laboratorio' || clave === 'tipo laboratorio') {
          if (valor) config.laboratorio = valor;
        } else if (clave === 'accesopublico' || clave === 'acceso publico') {
          if (valor) config.accesoPublico = valor.toUpperCase();
        } else if (clave === 'mododemo' || clave === 'modo demo') {
          if (valor) config.isDemo = valor.toUpperCase();
        } else if (clave === 'demorol' || clave === 'demo rol') {
          if (valor) config.demoRol = valor.toUpperCase();
        }
      }
    }
  } catch (e) {
    console.error(`[getAppConfig] Error al leer config de ${sheetId}:`, e.message);
    if (e.message === "Google APIs no inicializadas" || e.codigo === 'CONEXION_VENCIDA') throw e;
    if (esErrorDeAcceso(e)) throw new Error("ACCESO_DENEGADO");
  }
  return config;
}

/**
 * Traduce el rol de la columna B de 'config' a permisos concretos.
 *  - ADMIN: todo (fotos, mover, zonas, QR, reportar).
 *  - VISOR: solo lectura (buscar y ver zonas), no puede reportar.
 *  - cualquier otro valor (USER, LECTOR, vacío...): ve y puede reportar incidencias.
 */
function permisosDeRol(rol) {
  const r = (rol || '').toString().toUpperCase().trim();
  return { autorizado: true, esAdmin: r === 'ADMIN', puedeReportar: r !== 'VISOR', rol: r };
}

const SIN_PERMISOS = Object.freeze({ autorizado: false, esAdmin: false, puedeReportar: false, rol: '' });

/** Verifica si el email está en la columna A de 'config' y retorna el rol de la columna B */
async function verificarPermisos(sheetId, email) {
  // Las llamadas a verificarPermisos en el demo se bypassan en server.js,
  // pero por si acaso, dejamos esta función intacta porque necesita sheetId.
  if (!email) return { ...SIN_PERMISOS };

  try {
    const data = hoja(await cargarLab(sheetId), 'config').slice(1); // equivale a config!A2:B100
    const buscado = email.toLowerCase().trim();
    for (let i = 0; i < data.length; i++) {
      const mailFila = (data[i][0] || '').toString().toLowerCase().trim();
      if (mailFila === buscado) return permisosDeRol(data[i][1]);
    }
  } catch (e) {
    console.error(`[verificarPermisos] Error al leer permisos de ${sheetId}:`, e.message);
  }
  return { ...SIN_PERMISOS };
}

/** Filas de datos de INVENTARIO (sin título ni encabezados), con su número de fila */
function filasDeDatos(datos) {
  return hoja(datos, 'inventario').slice(1).map((row, i) => ({ row, fila: i + PRIMERA_FILA }));
}

/** ID de una fila, o '' si no tiene uno válido todavía */
function idDeFila(row) {
  const id = (row[COL.ID] || '').toString().trim();
  return ID_VALIDO.test(id) ? id : '';
}

/** Cómo se muestra un evento de HISTORIAL en el armario ("🕒 ...") */
function textoEvento(fecha, email, detalle) {
  return `[${fecha || ''}] (${email || ''}) ${detalle || ''}`.trim();
}

/**
 * Última entrada de la hoja HISTORIAL por ID de artículo. Las filas se
 * agregan al final, así que la última que aparece es la más reciente.
 */
function ultimosEventos(datos) {
  const ultimos = new Map();
  for (const r of datos.historial || []) {
    const id = (r[1] || '').toString().trim();
    if (id) ultimos.set(id, textoEvento(r[0], r[3], r[5] || r[4]));
  }
  return ultimos;
}

/** Devuelve las filas de inventario que pertenezcan a una zona específica */
async function getFilasPorZona(sheetId, zona) {
  const datos = await cargarLab(sheetId);
  const eventos = ultimosEventos(datos);
  return filasDeDatos(datos).map(({ row: r, fila }) => {
    const id = idDeFila(r);
    // Lo más reciente de la app está en HISTORIAL; si no hay nada, se muestra
    // la primera línea del historial viejo de la columna J (más nuevo arriba).
    const historialViejo = (r[COL.LOG] || '').toString().split('\n')[0];
    return {
      id,
      fila,
      articulo:  (r[COL.ART] || '').toString().trim(),
      bien:      r[COL.BIEN] || 0,
      regular:   r[COL.REG] || 0,
      roto:      r[COL.ROTO] || 0,
      total:     r[COL.TOTAL] || 0,
      obs:       r[COL.OBS] || '',
      ultimo:    (id && eventos.get(id)) || historialViejo,
      foto:      (r[COL.FOTO] || '').toString(),
      zona:      (r[COL.ZONA] || '').toString().trim()
    };
  })
  .filter(f => f.zona === zona && f.articulo)
  .sort((a, b) => a.articulo.localeCompare(b.articulo, 'es', { sensitivity: 'base', numeric: true }));
}

/** Realiza búsqueda global en el inventario por texto parcial */
async function buscarEnInventario(sheetId, query) {
  try {
    const datos = await cargarLab(sheetId);
    const q = query.toLowerCase().trim();
    const resultados = [];
    filasDeDatos(datos).forEach(({ row, fila }) => {
      if ((row[COL.ART] || '').toString().toLowerCase().includes(q)) {
        resultados.push({
          id: idDeFila(row),
          articulo: row[COL.ART],
          bien: row[COL.BIEN] || 0,
          regular: row[COL.REG] || 0,
          roto: row[COL.ROTO] || 0,
          ubicacion: row[COL.ZONA],
          foto: row[COL.FOTO],
          fila
        });
      }
    });
    return resultados;
  } catch (err) {
    if (err.message.includes("unregistered callers") || err.message.includes("auth")) {
      throw new Error("No se pudo conectar a Google Sheets. Verifica que las credenciales de la cuenta de servicio estén correctamente configuradas en el servidor y que la planilla esté compartida con la cuenta de servicio.");
    }
    if (err.message.includes("Requested entity was not found")) {
      throw new Error("No se encontró la planilla. Verifica que el ID de la planilla sea correcto y esté compartida.");
    }
    throw new Error("Error interno al buscar: " + err.message);
  }
}

/** Artículos con ID y foto, para el índice de búsqueda por foto */
async function articulosConFoto(sheetId) {
  const datos = await cargarLab(sheetId);
  return filasDeDatos(datos)
    .map(({ row }) => ({ id: idDeFila(row), articulo: row[COL.ART] || '', ubicacion: (row[COL.ZONA] || '').toString().trim(), foto: (row[COL.FOTO] || '').toString().trim() }))
    .filter(a => a.id && a.foto);
}

/** Devuelve la lista de zonas desde la hoja ubicaciones */
async function obtenerZonasAdmin(sheetId) {
  try {
    // equivale a ubicaciones!A2:C; se copian las filas para no tocar la caché
    return hoja(await cargarLab(sheetId), 'ubicaciones').slice(1).map(r => r.slice());
  } catch (e) {
    console.error(`[obtenerZonasAdmin] Error:`, e.message);
    return [];
  }
}

// ─── ESCRITURA (CRUD) ─────────────────────────────────

/** Fecha como dd/MM/yy HH:mm en hora de Uruguay (el servidor puede estar en UTC) */
function getFormattedDate(fecha = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('es-UY', {
    timeZone: 'America/Montevideo', day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/**
 * Busca un artículo por su ID leyendo la planilla en ese momento (no la
 * caché), para escribir en la fila donde está ahora aunque se hayan
 * ordenado, insertado o borrado filas desde que se cargó la página.
 */
async function ubicarArticulo(sheetId, id) {
  const { sheets } = getApis(sheetId);
  if (!sheets) throw new Error("Google APIs no inicializadas");
  const idBuscado = (id == null ? '' : id).toString().trim();
  if (!ID_VALIDO.test(idBuscado)) {
    throw new Error('Falta el ID del artículo. Recargá la página e intentá de nuevo.');
  }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: RANGOS.inventario });
  const inv = res.data.values || [];
  const enc = ((inv[0] || [])[COL.ID] || '').toString().trim();
  if (enc.toUpperCase() !== 'ID') {
    throw new Error(`La columna ${LETRA(COL.ID)} de INVENTARIO debe llamarse "ID" (los artículos se identifican por ella).`);
  }
  const encontrados = [];
  for (let k = 1; k < inv.length; k++) {
    if (((inv[k] || [])[COL.ID] || '').toString().trim() === idBuscado) encontrados.push(k);
  }
  if (encontrados.length === 0) {
    throw new Error('El artículo ya no está en la planilla (¿se borró?). Recargá la página.');
  }
  if (encontrados.length > 1) {
    throw new Error(`Hay ${encontrados.length} filas con el ID ${idBuscado} en la planilla; corregilo antes de seguir.`);
  }
  const row = inv[encontrados[0]];
  return {
    id: idBuscado,
    fila: encontrados[0] + 2,
    articulo: (row[COL.ART] || '').toString().trim(),
    zona: (row[COL.ZONA] || '').toString().trim(),
    foto: (row[COL.FOTO] || '').toString().trim(),
  };
}

/** Escribe celdas de la fila de un artículo (valores por letra de columna) */
async function escribirFila(sheetId, fila, celdas) {
  const { sheets } = getApis(sheetId);
  try {
    await conReintentos(() => sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: Object.entries(celdas).map(([col, v]) => ({ range: `INVENTARIO!${col}${fila}`, values: [[v]] })),
      },
    }), `escribir fila ${fila}`);
  } catch (err) {
    if (/protected cell/i.test(err.message || '')) {
      console.error(`[escribirFila] ${sheetId}: rango protegido en las columnas ${Object.keys(celdas).join(', ')}`);
      throw new Error('La planilla tiene un rango protegido que la aplicación no puede editar (columnas ' +
        Object.keys(celdas).join(', ') + ' de INVENTARIO). El propietario tiene que agregar el email de la ' +
        'cuenta de servicio como editor de esa protección (Datos → Proteger hojas y rangos).');
    }
    throw err;
  }
}

/**
 * Agrega un evento al final de la hoja HISTORIAL. RAW: lo que escribió el
 * usuario se guarda como texto y nunca se interpreta como fórmula.
 */
async function registrarEvento(sheetId, art, email, accion, detalle, fecha) {
  const { sheets } = getApis(sheetId);
  await conReintentos(() => sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${HOJA_HISTORIAL}!A:F`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[fecha, art.id, art.articulo, email || '', accion, detalle]] },
  }), 'agregar al historial');
}

// sheetId -> id de la carpeta LAB_FOTOS (no cambia; se vuelve a buscar si falla)
const _carpetaFotos = new Map();

/** Al cambiar la autorización de Drive, la carpeta guardada puede ser de otra cuenta */
function olvidarCarpetaFotos(sheetId) { _carpetaFotos.delete(sheetId); }

/** Busca (o crea) la carpeta de fotos en el Drive del admin que autorizó.
 *  Con el alcance `drive.file` la app solo ve lo que ella misma creó, así que
 *  esta carpeta es siempre la suya (no la LAB_FOTOS de la versión de Apps Script). */
async function carpetaFotos(sheetId, drive) {
  if (_carpetaFotos.has(sheetId)) return _carpetaFotos.get(sheetId);
  const q = `name = '${NOMBRE_CARPETA_FOTOS}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const folderQuery = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive' });

  let folderId;
  if (folderQuery.data.files && folderQuery.data.files.length > 0) {
    folderId = folderQuery.data.files[0].id;
  } else {
    const folderRes = await conReintentos(
      () => drive.files.create({ requestBody: { name: NOMBRE_CARPETA_FOTOS, mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' }),
      'crear carpeta de fotos');
    folderId = folderRes.data.id;
  }
  _carpetaFotos.set(sheetId, folderId);
  return folderId;
}

/** Sube una foto a Drive y actualiza el Inventario */
async function subirFoto(sheetId, email, id, base64Str, nombreArchivo) {
  const { sheets } = getApis(sheetId);
  if (!sheets) throw new Error("Google APIs no inicializadas");

  // Las fotos las sube un admin con su propio permiso: la cuenta de servicio
  // no tiene cuota en Drive y Google no la deja ser dueña de archivos.
  const drive = driveUsuario.clienteDrive(sheetId);
  if (!drive) throw new Error('Un admin debe autorizar Drive para poder guardar fotos (botón "Autorizar Drive" en el panel de control).');

  const art = await ubicarArticulo(sheetId, id);

  // Decodificar Base64
  const parts = (base64Str || '').split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const buffer = Buffer.from(parts[1] || '', 'base64');
  if (!buffer.length) throw new Error('La imagen llegó vacía.');

  const stream = require('stream');
  const subir = async () => {
    const folderId = await carpetaFotos(sheetId, drive);
    const body = new stream.PassThrough();
    body.end(buffer); // un stream nuevo en cada intento
    return drive.files.create({
      requestBody: { name: `img_${art.id}_${Date.now()}.jpg`, parents: [folderId] },
      media: { mimeType, body },
      fields: 'id',
    });
  };

  let fileRes;
  try {
    fileRes = await conReintentos(subir, 'subir foto');
  } catch (err) {
    if (/invalid_grant/i.test(err.message || '')) {
      throw new Error('La autorización de Drive venció o fue revocada: un admin debe volver a autorizar Drive.');
    }
    // La carpeta guardada pudo haberse borrado: se busca de nuevo una vez
    if (!_carpetaFotos.has(sheetId) || !/not found|404/i.test(err.message || '')) throw err;
    _carpetaFotos.delete(sheetId);
    fileRes = await conReintentos(subir, 'subir foto');
  }
  const fileId = fileRes.data.id;

  // Compartir públicamente
  await conReintentos(() => drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  }), 'compartir foto');

  const url = `https://lh3.googleusercontent.com/d/${fileId}`;
  const fecha = getFormattedDate();

  await escribirFila(sheetId, art.fila, { [LETRA(COL.FOTO)]: url, [LETRA(COL.FECHA)]: fecha });
  const detalle = art.foto ? '🔄 Imagen actualizada' : '📸 Imagen agregada';
  await registrarEvento(sheetId, art, email, 'FOTO', detalle, fecha);

  // `ultimo` es lo que la página muestra enseguida, sin recargar
  return { url, ultimo: textoEvento(fecha, email, detalle) };
}

/** Registra un reporte de incidencia */
async function registrarReporte(sheetId, email, id, texto) {
  const { sheets } = getApis(sheetId);
  if (!sheets) throw new Error("Google APIs no inicializadas");
  const txt = (texto || '').toString().trim();
  if (!txt) throw new Error('El reporte está vacío.');

  const art = await ubicarArticulo(sheetId, id);
  const fecha = getFormattedDate();

  // La columna K es el "ticket" abierto que usa el panel de incidencias
  await escribirFila(sheetId, art.fila, {
    [LETRA(COL.FECHA)]: fecha,
    [LETRA(COL.REP)]: `(${email}) ${txt}`,
  });
  await registrarEvento(sheetId, art, email, 'REPORTE', txt, fecha);
  // Texto del evento, para que la página lo muestre enseguida sin recargar
  return { ultimo: textoEvento(fecha, email, txt) };
}

/** Cambia la zona de un artículo */
async function cambiarUbicacion(sheetId, email, id, nuevaZona) {
  const { sheets } = getApis(sheetId);
  if (!sheets) throw new Error("Google APIs no inicializadas");
  const zonaNuevaStr = (nuevaZona || '').toString().trim();
  if (!zonaNuevaStr) throw new Error('Falta la zona de destino.');

  const art = await ubicarArticulo(sheetId, id);
  const fecha = getFormattedDate();

  await escribirFila(sheetId, art.fila, {
    [LETRA(COL.ZONA)]: zonaNuevaStr,
    [LETRA(COL.FECHA)]: fecha,
  });
  await registrarEvento(sheetId, art, email, 'MOVIDO', `🚚 Movido de '${art.zona}' a '${zonaNuevaStr}'`, fecha);
  return true;
}

/** Crea o edita una zona, si el nombre cambia, actualiza todos los artículos */
async function guardarZona(sheetId, id, nombre, desc) {
  const { sheets } = getApis(sheetId);
  if (!sheets) throw new Error("Google APIs no inicializadas");

  const idBuscado = (id || '').toString().trim();
  const nombreLimpio = nombre.trim();
  const nombreLower = nombreLimpio.toLowerCase();

  const resZonas = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'ubicaciones!A:C' });
  const data = resZonas.data.values || [];
  
  // Validar duplicados
  for (let i = 1; i < data.length; i++) {
    const idActual = (data[i][0] || '').toString().trim();
    const nombreActual = (data[i][1] || '').toString().trim().toLowerCase();
    if (nombreActual === nombreLower && idActual !== idBuscado) {
      return { success: false, msg: `Error: Ya existe una zona llamada "${data[i][1]}".` };
    }
  }

  if (idBuscado) {
    // EDICIÓN
    for (let i = 1; i < data.length; i++) {
      if ((data[i][0] || '').toString().trim() === idBuscado) {
        const nombreViejo = (data[i][1] || '').toString().trim();
        
        if (nombreViejo !== nombreLimpio) {
          // Propagar el cambio en Inventario
          const invRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'INVENTARIO!H3:H' });
          const invData = invRes.data.values || [];
          const updateData = [];
          for (let j = 0; j < invData.length; j++) {
            if ((invData[j][0] || '').toString().trim() === nombreViejo) {
              updateData.push({ range: `INVENTARIO!H${j + 3}`, values: [[nombreLimpio]] });
            }
          }
          if (updateData.length > 0) {
            await conReintentos(() => sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: sheetId,
              requestBody: { valueInputOption: 'USER_ENTERED', data: updateData }
            }), 'propagar nombre de zona');
          }
        }
        
        // Actualizar fila maestra
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `ubicaciones!B${i + 1}:C${i + 1}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[nombreLimpio, desc || '']] }
        });
        return { success: true, msg: 'Zona actualizada y nombres propagados.' };
      }
    }
  } else {
    // NUEVA ZONA
    let maxNum = 0;
    for (let i = 1; i < data.length; i++) {
      const currentId = (data[i][0] || '').toString();
      if (currentId.startsWith("Z")) {
        const num = parseInt(currentId.replace(/\D/g, ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
    const nextId = "Z" + ("0" + (maxNum + 1)).slice(-2);
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'ubicaciones!A:C',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[nextId, nombreLimpio, desc || '']] }
    });
    return { success: true, msg: 'Nueva zona creada: ' + nextId };
  }
}

/** Eliminar una zona si no hay artículos */
async function eliminarZona(sheetId, id, nombre) {
  const { sheets } = getApis(sheetId);
  if (!sheets) throw new Error("Google APIs no inicializadas");

  const invRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'INVENTARIO!H3:H' });
  const invData = invRes.data.values || [];
  const nombreLimpio = nombre.trim().toLowerCase();
  
  let cuenta = 0;
  for (let row of invData) {
    if ((row[0] || '').toString().trim().toLowerCase() === nombreLimpio) cuenta++;
  }
  
  if (cuenta > 0) {
    return { success: false, msg: `No se puede eliminar: hay ${cuenta} artículos en '${nombre}'. Muévelos primero.` };
  }

  const ubiRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'ubicaciones!A:C' });
  const ubiData = ubiRes.data.values || [];
  const idNumerico = id.toString().replace(/\D/g, '');

  for (let i = 1; i < ubiData.length; i++) {
    const idHoja = (ubiData[i][0] || '').toString().replace(/\D/g, '');
    if (idHoja === idNumerico && idNumerico !== "") {
      // Necesitamos eliminar la fila. Usamos batchUpdate con un request de DeleteDimension
      const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const ubiSheetInfo = sheetMetadata.data.sheets.find(s => s.properties.title === 'ubicaciones');
      
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: ubiSheetInfo.properties.sheetId,
                dimension: 'ROWS',
                startIndex: i,
                endIndex: i + 1
              }
            }
          }]
        }
      });
      return { success: true, msg: `Zona '${nombre}' eliminada.` };
    }
  }
  
  return { success: false, msg: `No se encontró la zona con ID ${id}` };
}

/** Generador de QRs: Escribe en la pestaña IMPRIMIR_QR usando IMAGE() */
async function ejecutarGeneracionQR(sheetId, baseUrl, listaIds = []) {
  const { sheets } = getApis(sheetId);
  if (!sheets) throw new Error("Google APIs no inicializadas");

  // 1. Obtener ubicaciones y filtrar
  const resUbi = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'ubicaciones!A2:B' });
  let dataMaestra = resUbi.data.values || [];
  
  if (listaIds && listaIds.length > 0) {
    dataMaestra = dataMaestra.filter(row => listaIds.includes((row[0] || '').toString().trim()));
  }
  if (dataMaestra.length === 0) return "No hay zonas para generar QR.";

  // 2. Obtener SheetID de IMPRIMIR_QR o crearla
  let spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  let qrSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'IMPRIMIR_QR');
  
  let qrSheetId;
  if (!qrSheet) {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: 'IMPRIMIR_QR' } } }] }
    });
    qrSheetId = addRes.data.replies[0].addSheet.properties.sheetId;
  } else {
    qrSheetId = qrSheet.properties.sheetId;
    // Limpiar cuadrícula
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: 'IMPRIMIR_QR' });
  }

  const COLS = 2;
  const colores = ["#1a5276", "#117864", "#7d6608", "#6c3483", "#922b21"];
  
  // Preparamos los requests de batchUpdate para aplicar estilos y valores al mismo tiempo
  const requests = [];
  let currentRow = 0; // 0-indexed para la API
  
  // Limpiar estilos existentes (UpdateCells con fields='*') para tener canvas en blanco
  requests.push({
    updateCells: {
      range: { sheetId: qrSheetId },
      fields: '*'
    }
  });

  for (let i = 0; i < dataMaestra.length; i++) {
    const idZona = dataMaestra[i][0];
    const nombreZona = dataMaestra[i][1];
    if (!nombreZona) continue;
    
    const colIndex = i % COLS; // 0 o 1
    if (i % COLS === 0 && i !== 0) currentRow += 3;
    
    const codigo = "Z" + String(idZona).replace(/\D/g, '').padStart(2, "0");
    const colorHex = colores[i % colores.length];
    
    // Parse color to google RGB
    const hexToRgb = hex => ({
      red: parseInt(hex.slice(1,3), 16)/255,
      green: parseInt(hex.slice(3,5), 16)/255,
      blue: parseInt(hex.slice(5,7), 16)/255
    });
    const bgColor = hexToRgb(colorHex);

    // Endpoint VPS
    const linkUrl = `${baseUrl}/lab/${sheetId}?zona=${encodeURIComponent(nombreZona)}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(linkUrl)}`;

    // Filas: 0=Header, 1=Image, 2=Text
    const rStart = currentRow;
    const rEnd = currentRow + 3;
    const cStart = colIndex;
    const cEnd = colIndex + 1;
    
    requests.push({
      updateCells: {
        range: { sheetId: qrSheetId, startRowIndex: rStart, endRowIndex: rStart + 1, startColumnIndex: cStart, endColumnIndex: cEnd },
        rows: [{
          values: [{
            userEnteredValue: { stringValue: codigo },
            userEnteredFormat: {
              backgroundColor: bgColor,
              textFormat: { foregroundColor: {red:1, green:1, blue:1}, bold: true },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              borders: { top: {style: 'SOLID'}, bottom: {style: 'SOLID'}, left: {style: 'SOLID'}, right: {style: 'SOLID'} }
            }
          }]
        }],
        fields: 'userEnteredValue,userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)'
      }
    });

    requests.push({
      updateCells: {
        range: { sheetId: qrSheetId, startRowIndex: rStart + 1, endRowIndex: rStart + 2, startColumnIndex: cStart, endColumnIndex: cEnd },
        rows: [{
          values: [{
            userEnteredValue: { formulaValue: `=IMAGE("${qrUrl}", 4, 120, 120)` },
            userEnteredFormat: {
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              borders: { left: {style: 'SOLID'}, right: {style: 'SOLID'} }
            }
          }]
        }],
        fields: 'userEnteredValue,userEnteredFormat(horizontalAlignment,verticalAlignment,borders)'
      }
    });

    requests.push({
      updateCells: {
        range: { sheetId: qrSheetId, startRowIndex: rStart + 2, endRowIndex: rStart + 3, startColumnIndex: cStart, endColumnIndex: cEnd },
        rows: [{
          values: [{
            userEnteredValue: { stringValue: nombreZona },
            userEnteredFormat: {
              textFormat: { bold: true, fontSize: 12 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              borders: { bottom: {style: 'SOLID'}, left: {style: 'SOLID'}, right: {style: 'SOLID'} }
            }
          }]
        }],
        fields: 'userEnteredValue,userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,borders)'
      }
    });
  }

  // Set column widths
  for (let c = 0; c < COLS; c++) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: qrSheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 },
        properties: { pixelSize: 300 },
        fields: 'pixelSize'
      }
    });
  }
  
  // Set row heights
  for (let r = 0; r <= currentRow; r += 3) {
    requests.push({ updateDimensionProperties: { range: { sheetId: qrSheetId, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } });
    requests.push({ updateDimensionProperties: { range: { sheetId: qrSheetId, dimension: 'ROWS', startIndex: r + 1, endIndex: r + 2 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } });
    requests.push({ updateDimensionProperties: { range: { sheetId: qrSheetId, dimension: 'ROWS', startIndex: r + 2, endIndex: r + 3 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests }
  });

  return `Proceso completado. Se generaron ${dataMaestra.length} etiquetas en IMPRIMIR_QR.`;
}

/** Envuelve una escritura para que, termine bien o mal, invalide la caché del laboratorio */
function conInvalidacion(fn) {
  return async (sheetId, ...args) => {
    try {
      return await fn(sheetId, ...args);
    } finally {
      invalidarLab(sheetId);
    }
  };
}

module.exports = {
  getAppConfig,
  verificarPermisos,
  permisosDeRol,
  getFilasPorZona,
  buscarEnInventario,
  articulosConFoto,
  olvidarCarpetaFotos,
  obtenerZonasAdmin,
  subirFoto: conInvalidacion(subirFoto),
  registrarReporte: conInvalidacion(registrarReporte),
  cambiarUbicacion: conInvalidacion(cambiarUbicacion),
  guardarZona: conInvalidacion(guardarZona),
  eliminarZona: conInvalidacion(eliminarZona),
  ejecutarGeneracionQR,
  invalidarLab,
  // para las pruebas
  _internos: { calcularIdsFaltantes, getFormattedDate, esTransitorio, conReintentos, getApis },
};
