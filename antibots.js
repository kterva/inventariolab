// Defensas contra bots para "Crear mi laboratorio".
//
// Crear un laboratorio exige una cuenta de Google real y su consentimiento, lo
// que ya frena a casi todos los bots. Esto agrega capas baratas que no
// necesitan guardar estado en el servidor:
//  - un token firmado en el formulario (fecha + HMAC): un formulario inventado
//    o vencido no sirve, y uno enviado en menos de MIN_MS se rechaza;
//  - un campo trampa que una persona no ve y un bot suele completar;
//  - topes de laboratorios por correo, por día y en total (se cuentan desde los
//    archivos de permiso ya guardados);
//  - opcionalmente, Cloudflare Turnstile.
const crypto = require('crypto');

const MAX_EDAD_FORM_MS = 2 * 60 * 60 * 1000;

const firma = (ts, secreto) => crypto.createHmac('sha256', secreto).update('crear:' + ts).digest('hex');

function emitirToken(secreto, ahora = Date.now()) {
  return `${ahora}.${firma(ahora, secreto)}`;
}

/** 'ok' | 'invalido' | 'rapido' | 'vencido' */
function validarToken(token, secreto, { minMs = 3000, ahora = Date.now() } = {}) {
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(String(token || ''));
  if (!m) return 'invalido';
  const esperado = Buffer.from(firma(m[1], secreto)), recibido = Buffer.from(m[2]);
  if (!crypto.timingSafeEqual(esperado, recibido)) return 'invalido';
  const edad = ahora - Number(m[1]);
  if (edad < minMs) return 'rapido';
  if (edad > MAX_EDAD_FORM_MS) return 'vencido';
  return 'ok';
}

/** Cloudflare Turnstile: true si Cloudflare confirma que quien envía es una persona */
async function verificarTurnstile({ secreto, token, ip, fetchFn = fetch }) {
  if (!token) return false;
  try {
    const cuerpo = new URLSearchParams({ secret: secreto, response: String(token) });
    if (ip) cuerpo.set('remoteip', ip);
    const r = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: cuerpo, signal: AbortSignal.timeout(5000) });
    return !!(await r.json()).success;
  } catch (err) {
    console.error('[turnstile]', err.message);
    return false;
  }
}

const num = (valor, porDefecto) => (valor !== undefined && valor !== '' && Number.isFinite(Number(valor)) ? Number(valor) : porDefecto);

function topes(env = process.env) {
  return {
    total: num(env.CREAR_MAX_TOTAL, 200),
    porDia: num(env.CREAR_MAX_POR_DIA, 10),
    porCorreo: num(env.CREAR_MAX_POR_CORREO, 3),
    porIpHora: num(env.CREAR_MAX_POR_IP_HORA, 5),
    minMs: num(env.CREAR_MIN_MS, 3000),
  };
}

/**
 * ¿Se puede crear otro laboratorio? `propios` es la lista de driveUsuario.laboratoriosPropios().
 * Devuelve null si sí, o el motivo: 'limite-total' | 'limite-dia' | 'limite-correo'.
 */
function motivoDeLimite(propios, limites, { email, ahora = Date.now() } = {}) {
  if (propios.length >= limites.total) return 'limite-total';
  if (propios.filter(l => ahora - Date.parse(l.autorizadoEn) < 24 * 3600 * 1000).length >= limites.porDia) return 'limite-dia';
  if (email && propios.filter(l => l.email === email.toLowerCase()).length >= limites.porCorreo) return 'limite-correo';
  return null;
}

module.exports = { emitirToken, validarToken, verificarTurnstile, topes, motivoDeLimite };
