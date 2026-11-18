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

function urlAutorizacion(state, loginHint) {
  return clienteOAuth().generateAuthUrl({
    access_type: 'offline',   // para recibir un refresh token
    prompt: 'consent',        // Google solo lo entrega si se vuelve a pedir el consentimiento
    scope: [ALCANCE],
    state,
    ...(loginHint && { login_hint: loginHint }),
  });
}

/** Cambia el código de Google por el refresh token y lo guarda */
async function guardarDesdeCodigo(labId, code, email) {
  const { tokens } = await clienteOAuth().getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google no entregó el permiso permanente. Quitá el acceso de InventarioLab en https://myaccount.google.com/permissions y probá de nuevo.');
  }
  fs.mkdirSync(carpeta(), { recursive: true, mode: 0o700 });
  const destino = archivo(labId);
  const tmp = destino + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ refresh_token: tokens.refresh_token, email, autorizadoEn: new Date().toISOString() }), { mode: 0o600 });
  fs.renameSync(tmp, destino);
  _clientes.delete(labId);
}

const _clientes = new Map();

/** Cliente de Drive que actúa como el admin que autorizó, o null si nadie autorizó */
function clienteDrive(labId) {
  if (_clientes.has(labId)) return _clientes.get(labId);
  const t = leer(labId);
  if (!t) return null;
  const auth = clienteOAuth();
  auth.setCredentials({ refresh_token: t.refresh_token });
  const drive = google.drive({ version: 'v3', auth });
  _clientes.set(labId, drive);
  return drive;
}

module.exports = { estado, urlAutorizacion, guardarDesdeCodigo, clienteDrive, ALCANCE, urlRetorno };
