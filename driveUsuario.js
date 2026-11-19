// Autorización de Drive con la cuenta de un administrador del laboratorio.
//
// Las cuentas de servicio no tienen cuota de almacenamiento en Drive, así que
// no pueden ser dueñas de las fotos. Las fotos se suben con el permiso de un
// admin (OAuth), con el alcance mínimo `drive.file`: la app solo ve y toca los
// archivos que ella misma crea. Quedan en el Drive de ese admin.
//
// El refresh token se guarda en DRIVE_TOKENS_DIR/<labId>.json (modo 600, en una
// carpeta 700), nunca en el repo.
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const ALCANCE = 'https://www.googleapis.com/auth/drive.file';

const carpeta = () => process.env.DRIVE_TOKENS_DIR || path.join(__dirname, 'drive-tokens');
const archivo = labId => path.join(carpeta(), String(labId).replace(/[^A-Za-z0-9_-]/g, '_') + '.json');
const urlRetorno = () => `${process.env.APP_BASE_URL || 'http://localhost:3000'}/inventariolab/auth/drive/callback`;

function clienteOAuth() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, urlRetorno());
}

function leer(labId) {
  try {
    const t = JSON.parse(fs.readFileSync(archivo(labId), 'utf8'));
    return t && t.refresh_token ? t : null;
  } catch { return null; }
}

/** { autorizado, email } — quién autorizó (su Drive guarda las fotos) */
function estado(labId) {
  const t = leer(labId);
  return { autorizado: !!t, email: t ? t.email : null };
}

/** `conIdentidad`: además de Drive pide el correo de quien autoriza (para "Crear mi laboratorio", donde no hay sesión previa) */
function urlAutorizacion(state, loginHint, { conIdentidad } = {}) {
  return clienteOAuth().generateAuthUrl({
    access_type: 'offline',   // para recibir un refresh token
    prompt: 'consent',        // Google solo lo entrega si se vuelve a pedir el consentimiento
    scope: conIdentidad ? [ALCANCE, 'openid', 'email'] : [ALCANCE],
    state,
    ...(loginHint && { login_hint: loginHint }),
  });
}

/** Cambia el código de Google por el refresh token (sin guardarlo) */
async function canjearCodigo(code) {
  const auth = clienteOAuth();
  const { tokens } = await auth.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google no entregó el permiso permanente. Quitá el acceso de Inventario Laboratorio en https://myaccount.google.com/permissions y probá de nuevo.');
  }
  auth.setCredentials(tokens);
  return { tokens, auth };
}

/** Guarda el refresh token de un laboratorio (modo 600, escritura atómica) */
function guardarToken(labId, refreshToken, email, { modo } = {}) {
  fs.mkdirSync(carpeta(), { recursive: true, mode: 0o700 });
  const destino = archivo(labId);
  const tmp = destino + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ refresh_token: refreshToken, email, ...(modo && { modo }), autorizadoEn: new Date().toISOString() }), { mode: 0o600 });
  fs.renameSync(tmp, destino);
  _clientes.delete(labId);
}

/** Cambia el código de Google por el refresh token y lo guarda */
async function guardarDesdeCodigo(labId, code, email, { modo } = {}) {
  const { tokens } = await canjearCodigo(code);
  guardarToken(labId, tokens.refresh_token, email, { modo });
}

/**
 * Para "Crear mi laboratorio": canjea el código y devuelve quién es (correo
 * verificado por Google) y clientes de Sheets y Drive que actúan como esa
 * persona. Todavía no se guarda nada: el laboratorio no tiene id hasta que se crea.
 */
async function identificarYConectar(code) {
  const { tokens, auth } = await canjearCodigo(code);
  if (!tokens.id_token) throw new Error('Google no entregó la identidad de la cuenta.');
  const ticket = await auth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
  const datos = ticket.getPayload();
  if (!datos.email || datos.email_verified === false) throw new Error('La cuenta de Google no tiene un correo verificado.');
  return {
    email: datos.email.toLowerCase(),
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token, // solo para el selector de archivos de Google, que corre en el navegador
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth }),
  };
}

// labId -> { auth, drive, sheets }; los clientes se arman una vez y se reutilizan
const _clientes = new Map();

function clientes(labId) {
  if (_clientes.has(labId)) return _clientes.get(labId);
  const t = leer(labId);
  if (!t) return null;
  const auth = clienteOAuth();
  auth.setCredentials({ refresh_token: t.refresh_token });
  const c = { auth, drive: google.drive({ version: 'v3', auth }), sheets: null };
  _clientes.set(labId, c);
  return c;
}

/** Cliente de Drive que actúa como el admin que autorizó, o null si nadie autorizó */
function clienteDrive(labId) {
  const c = clientes(labId);
  return c ? c.drive : null;
}

/** ¿La planilla de este laboratorio se maneja con el permiso de su dueño (y no con la cuenta de servicio)? */
function esModoUsuario(labId) {
  const t = leer(labId);
  return !!t && t.modo === 'usuario';
}

/** Cliente de Sheets con el permiso del dueño, solo para laboratorios en modo usuario; si no, null */
function clienteSheets(labId) {
  if (!esModoUsuario(labId)) return null;
  const c = clientes(labId);
  if (!c.sheets) c.sheets = google.sheets({ version: 'v4', auth: c.auth });
  return c.sheets;
}

/** Laboratorios en modo usuario de este servidor: [{ labId, email, autorizadoEn }] */
function laboratoriosPropios() {
  let nombres = [];
  try { nombres = fs.readdirSync(carpeta()).filter(n => n.endsWith('.json')); } catch { return []; }
  const lista = [];
  for (const n of nombres) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(carpeta(), n), 'utf8'));
      if (t && t.modo === 'usuario') lista.push({ labId: n.slice(0, -5), email: String(t.email || '').toLowerCase(), autorizadoEn: t.autorizadoEn });
    } catch { /* archivo ilegible: no cuenta */ }
  }
  return lista;
}

module.exports = { laboratoriosPropios, estado, urlAutorizacion, guardarDesdeCodigo, guardarToken, identificarYConectar, clienteDrive, clienteSheets, esModoUsuario, ALCANCE, urlRetorno };
