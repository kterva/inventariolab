/**
 * Simulador de 'googleapis' para las pruebas: no hace llamadas reales a Google.
 *
 * Se carga con `node -r ./tests/fake-googleapis.js` (servidor) o con
 * require() antes de googleClient (pruebas en proceso). El estado queda en
 * global.__mock para que las pruebas puedan cambiar datos o simular fallos.
 *
 * Cada laboratorio (spreadsheetId) es un libro con hojas guardadas como
 * grillas desde A1. Las lecturas recortan filas/columnas vacías al final y
 * los rangos que exceden la grilla, igual que Google; las escrituras fuera
 * de la grilla fallan con "exceeds grid limits", como en la API real.
 *
 * Variables de entorno (para levantar el servidor):
 *   MODO_DEMO=SI|NO   activa el modo demo de la planilla simulada
 *   DEMO_ROL=ROL      rol del usuario demo (ADMIN, LECTOR, VISOR...)
 *   LOG_ESCRITURAS    archivo donde se anota una línea por cada escritura
 */
const Module = require('module');
const fs = require('fs');

/** Libro de ejemplo: INVENTARIO con 14 columnas (A..N), sin columna ID ni HISTORIAL */
function libroInicial() {
  return {
    config: { filas: [
      ['email', 'rol', '', 'clave', 'valor'],
      ['admin@x.uy', 'ADMIN', '', 'institucion', 'Liceo Test'],
      ['lector@x.uy', 'LECTOR', '', 'modo demo', process.env.MODO_DEMO || 'NO'],
      ['visor@x.uy', ' visor ', '', 'demo rol', process.env.DEMO_ROL || 'LECTOR'],
      ['invitado@demo.com', 'ADMIN'],
    ], columnas: 26 },
    INVENTARIO: { filas: [
      ['INVENTARIO DE PRUEBA'],
      ['Artículo', 'COD', 'Bien', 'Regular', 'Roto', 'Total', 'Observaciones', 'Ubicación', 'Última modificación', 'Historial', 'Reporte', 'Link', 'ID Zona', 'Foto'],
      ['Probeta', '', '3', '1', '0', '4', '', 'Z1', '', 'log'],
      ['Balanza', '', '1', '0', '0', '1', '', 'Z1'],
      ['Imán', '', '2', '0', '0', '2', '', 'Z2'],
    ], columnas: 14 },
    ubicaciones: { filas: [['ID', 'Nombre', 'Desc'], ['Z01', 'Z1', 'a'], ['Z02', 'Z2', 'b']], columnas: 25 },
  };
}

const st = global.__mock = {
  authCreados: 0, batchGet: 0, get: 0, escrituras: 0, llamadas: [],
  revocados: new Set(), // refresh tokens que Google ya no acepta (invalid_grant)
  fallar: null,        // mensaje de error a lanzar en batchGet
  faltaHoja: null,     // rango que "no existe" en la planilla (en lecturas)
  fallarEscrituras: 0, // cuántas escrituras POST siguientes fallan con 503
  soloLectura: false,  // la cuenta de servicio no puede escribir
  demora: 20,          // ms de latencia simulada
  libros: {},
  libroInicial,
  libro(id) { return this.libros[id] || (this.libros[id] = libroInicial()); },
  /** Valores de una hoja como los devolvería Google (sin vacíos al final) */
  valores(id, hoja) { return recortar(this.libro(id)[hoja].filas); },
};

const espera = () => new Promise(r => setTimeout(r, st.demora));
const err = (msg, code) => Object.assign(new Error(msg), { code, status: code });

function colANum(letras) { let n = 0; for (const c of letras.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }

/** 'Hoja!A3:N' -> { hoja, f0, c0, f1, c1 } (índices 0, extremos incluidos; Infinity = abierto) */
function parsear(rango) {
  const [hoja, ref] = rango.includes('!') ? rango.split('!') : [rango, ''];
  if (!ref) return { hoja, f0: 0, c0: 0, f1: Infinity, c1: Infinity };
  const punto = p => { const m = /^([A-Z]*)(\d*)$/i.exec(p); return { c: m[1] ? colANum(m[1]) : null, f: m[2] ? Number(m[2]) - 1 : null }; };
  const [a, b = a] = ref.split(':');
  const pa = punto(a), pb = punto(b);
  return { hoja, f0: pa.f ?? 0, c0: pa.c ?? 0, f1: pb.f ?? Infinity, c1: pb.c ?? Infinity };
}

function hojaDe(id, rango) {
  const r = parsear(rango);
  const h = st.libro(id)[r.hoja];
  if (!h || rango === st.faltaHoja) throw err('Unable to parse range: ' + rango, 400);
  return { r, h };
}

function recortar(filas) {
  const out = filas.map(f => { const x = (f || []).map(v => (v == null ? '' : String(v))); while (x.length && x[x.length - 1] === '') x.pop(); return x; });
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
}

function leer(id, rango) {
  const { r, h } = hojaDe(id, rango);
  if (Number.isFinite(r.c0) && r.c0 >= h.columnas) throw err(`Range (${rango}) exceeds grid limits. Max columns: ${h.columnas}`, 400);
  const c1 = Math.min(r.c1, h.columnas - 1);
  const filas = [];
  for (let f = r.f0; f <= Math.min(r.f1, h.filas.length - 1); f++) filas.push((h.filas[f] || []).slice(r.c0, c1 + 1));
  return recortar(filas);
}

function escribirRango(id, rango, valores) {
  const { r, h } = hojaDe(id, rango);
  valores.forEach((fila, i) => fila.forEach((v, j) => {
    const f = r.f0 + i, c = r.c0 + j;
    if (c >= h.columnas) throw err(`Range (${rango}) exceeds grid limits. Max columns: ${h.columnas}`, 400);
    while (h.filas.length <= f) h.filas.push([]);
    while (h.filas[f].length <= c) h.filas[f].push('');
    h.filas[f][c] = v;
  }));
}

/** Toda escritura pasa por acá: cuenta, anota y puede fallar a pedido */
async function escritura(nombre, fn, { post = true } = {}) {
  await espera();
  if (st.soloLectura) throw err('The caller does not have permission', 403);
  if (post && st.fallarEscrituras > 0) { st.fallarEscrituras--; throw err('The service is currently unavailable.', 503); }
  st.escrituras++;
  st.llamadas.push(nombre);
  if (process.env.LOG_ESCRITURAS) fs.appendFileSync(process.env.LOG_ESCRITURAS, nombre + '\n');
  return { data: fn() || {} };
}

let proximoSheetId = 100;

const fake = {
  google: {
    auth: {
      GoogleAuth: class { constructor() { st.authCreados++; } },
      // Cliente OAuth simulado: el código 'sin-refresh' no trae refresh token y 'malo' falla
      OAuth2: class {
        constructor(id, secreto, retorno) { this.retorno = retorno; }
        generateAuthUrl(o) { return 'https://accounts.example/auth?' + new URLSearchParams({ state: o.state, scope: o.scope.join(' '), access_type: o.access_type, prompt: o.prompt, redirect_uri: this.retorno, login_hint: o.login_hint || '' }); }
        async getToken(code) {
          if (code === 'malo') throw new Error('invalid_grant');
          // id_token simulado: el correo es <código>@x.uy (solo lo usa "Crear mi laboratorio")
          const id_token = Buffer.from(JSON.stringify({ email: code + '@x.uy', email_verified: code !== 'sin-verificar' })).toString('base64');
          return { tokens: code === 'sin-refresh' ? { access_token: 'a' } : { access_token: 'a', refresh_token: 'rt-' + code, id_token } };
        }
        async verifyIdToken({ idToken }) { return { getPayload: () => JSON.parse(Buffer.from(idToken, 'base64').toString('utf8')) }; }
        setCredentials(c) { this.credenciales = c; }
      },
    },
    drive: ({ auth } = {}) => ({
      __auth: auth,
      files: {
        get: async () => ({ data: { parents: ['carpeta-lab'] } }),
        list: async () => { st.llamadas.push('drive.list'); return { data: { files: [{ id: 'LAB_FOTOS' }] } }; },
        create: ({ requestBody }) => escritura('drive.create', () => ({ id: 'archivo-' + requestBody.name })),
      },
      permissions: { create: () => escritura('drive.permiso', () => ({})) },
    }),
    sheets: ({ auth } = {}) => ({
      __auth: auth, // para que las pruebas vean con qué credenciales se creó el cliente
      spreadsheets: {
        create: ({ requestBody }) => escritura('spreadsheets.create', () => {
          const id = 'PLANILLA-NUEVA-' + (st.creadas = (st.creadas || 0) + 1);
          const libro = st.libros[id] = {};
          const hojas = requestBody.sheets.map(h => {
            const g = h.properties.gridProperties;
            libro[h.properties.title] = { filas: [], columnas: g.columnCount, sheetId: proximoSheetId++, titulo: requestBody.properties.title };
            return { properties: { title: h.properties.title, sheetId: libro[h.properties.title].sheetId } };
          });
          st.propietarios = st.propietarios || {};
          st.propietarios[id] = auth && auth.credenciales && auth.credenciales.refresh_token;
          return { spreadsheetId: id, sheets: hojas };
        }),
        get: async ({ spreadsheetId }) => {
          await espera();
          const libro = st.libro(spreadsheetId);
          return { data: { sheets: Object.entries(libro).map(([title, h]) => {
            if (h.sheetId == null) h.sheetId = proximoSheetId++;
            return { properties: { title, sheetId: h.sheetId, gridProperties: { columnCount: h.columnas } }, protectedRanges: h.protegidos || [] };
          }) } };
        },
        batchUpdate: ({ spreadsheetId, requestBody }) => escritura('spreadsheets.batchUpdate', () => {
          const libro = st.libro(spreadsheetId);
          for (const p of requestBody.requests) {
            if (p.addSheet) {
              const t = p.addSheet.properties.title;
              if (libro[t]) throw err(`A sheet with the name "${t}" already exists.`, 400);
              libro[t] = { filas: [], columnas: 26, sheetId: proximoSheetId++ };
            } else if (p.addProtectedRange) {
              const pr = p.addProtectedRange.protectedRange;
              const h = Object.values(libro).find(x => x.sheetId === pr.range.sheetId);
              (h.protegidos = h.protegidos || []).push(pr);
            } else if (p.appendDimension && p.appendDimension.dimension === 'COLUMNS') {
              const h = Object.values(libro).find(x => x.sheetId === p.appendDimension.sheetId);
              h.columnas += p.appendDimension.length;
            }
          }
          return { replies: [] };
        }),
        values: {
          batchGet: async ({ spreadsheetId, ranges }) => {
            st.batchGet++; await espera();
            if (st.fallar) throw new Error(st.fallar);
            if (auth && auth.credenciales && st.revocados.has(auth.credenciales.refresh_token)) throw err('invalid_grant', 400);
            return { data: { valueRanges: ranges.map(r => ({ range: r, values: leer(spreadsheetId, r) })) } };
          },
          get: async ({ spreadsheetId, range }) => {
            st.get++; await espera();
            return { data: { values: leer(spreadsheetId, range) } };
          },
          batchUpdate: ({ spreadsheetId, requestBody }) => escritura('values.batchUpdate', () => {
            for (const d of requestBody.data) hojaDe(spreadsheetId, d.range); // valida antes de escribir
            if (st.protegidas && requestBody.data.some(d => st.protegidas.includes(parsear(d.range).c0)))
              throw err('You are trying to edit a protected cell or object. Please contact the spreadsheet owner to remove protection if you need to edit.', 400);
            for (const d of requestBody.data) escribirRango(spreadsheetId, d.range, d.values);
          }),
          update: ({ spreadsheetId, range, requestBody }) =>
            escritura('values.update', () => escribirRango(spreadsheetId, range, requestBody.values), { post: false }),
          append: ({ spreadsheetId, range, requestBody }) => escritura('values.append', () => {
            const { r, h } = hojaDe(spreadsheetId, range);
            const desde = recortar(h.filas).length;
            requestBody.values.forEach((fila, i) => { h.filas[desde + i] = []; fila.forEach((v, j) => { h.filas[desde + i][r.c0 + j] = v; }); });
          }),
          clear: () => escritura('values.clear', () => ({})),
        },
      },
    }),
  },
};

// nodemailer simulado: anota cada correo en LOG_CORREOS (una línea JSON); CORREO_FALLA=SI hace que falle el envío
const fakeCorreo = {
  createTransport: () => ({
    sendMail: async msg => {
      if (process.env.CORREO_FALLA === 'SI') throw new Error('SMTP caído');
      if (process.env.LOG_CORREOS) fs.appendFileSync(process.env.LOG_CORREOS, JSON.stringify(msg) + '\n');
      return {};
    },
  }),
};

const cargarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === 'nodemailer') return fakeCorreo;
  return pedido === 'googleapis' ? fake : cargarOriginal.call(this, pedido, ...resto);
};
