// Aviso por correo al administrador del servicio cuando alguien crea un laboratorio.
//
// Se configura con variables de entorno (ver .env.example). Sin configurar no
// hace nada. Un fallo al enviar nunca interrumpe la creación del laboratorio.
const nodemailer = require('nodemailer');

function configuracion(env = process.env) {
  if (!env.AVISO_CREACION_EMAIL || !env.SMTP_HOST) return null;
  return {
    para: env.AVISO_CREACION_EMAIL,
    de: env.SMTP_FROM || `Inventario Laboratorio <${env.SMTP_USER || env.AVISO_CREACION_EMAIL}>`,
    transporte: {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT) || 587,
      secure: String(env.SMTP_SECURE || '').toUpperCase() === 'SI',
      ...(env.SMTP_USER && { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } }),
    },
  };
}

let _transporte = null;

/** Texto plano (sin HTML) con lo que el administrador del servicio necesita saber */
function redactar({ email, institucion, laboratorio, labId, total, baseUrl, ahora = new Date() }) {
  return {
    subject: `Inventario Laboratorio: nuevo laboratorio de ${email}`,
    text: [
      'Se creó un laboratorio nuevo.',
      '',
      `Correo:       ${email}`,
      `Centro:       ${institucion}`,
      `Laboratorio:  ${laboratorio}`,
      `Id:           ${labId}`,
      `Enlace:       ${baseUrl}/inventariolab/lab/${labId}`,
      `Fecha (UTC):  ${ahora.toISOString()}`,
      `Laboratorios propios en este servidor: ${total}`,
    ].join('\n'),
  };
}

/** Envía el aviso; devuelve true si se envió. No lanza nunca. */
async function avisarCreacion(datos, env = process.env) {
  const cfg = configuracion(env);
  if (!cfg) { console.warn('[aviso] AVISO_CREACION_EMAIL o SMTP_HOST sin configurar: no se envía el correo de aviso.'); return false; }
  try {
    _transporte = _transporte || nodemailer.createTransport(cfg.transporte);
    await _transporte.sendMail({ from: cfg.de, to: cfg.para, ...redactar({ baseUrl: env.APP_BASE_URL || 'http://localhost:3000', ...datos }) });
    return true;
  } catch (err) {
    console.error('[aviso] no se pudo enviar el correo:', err.message);
    return false;
  }
}

module.exports = { avisarCreacion, configuracion, redactar };
