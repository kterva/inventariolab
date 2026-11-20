require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { Writable } = require('stream');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const googleClient = require('./googleClient');
const FileSessionStore = require('./sessionStore');
const crypto = require('crypto');
const driveUsuario = require('./driveUsuario');
const plantilla = require('./plantilla');
const antibots = require('./antibots');
const importar = require('./importar');
const exportar = require('./exportar');
const qrPdf = require('./qrPdf');
const listados = require('./listados');
const avisos = require('./avisos');
const { crearBuscadorFoto, crearLimitador, ErrorBusquedaFoto } = require('./busquedaFoto');
const { crearRegistro } = require('./registroBusquedas');

const app = express();
app.locals.appVersion = require("./package.json").version;
app.set('trust proxy', 1); // Confiar en el proxy de Nginx
const PORT = process.env.PORT || 3000;

// Email de la cuenta de servicio, tomado de la credencial configurada.
// Es el email con el que cada liceo debe compartir su planilla.
const SERVICE_ACCOUNT_EMAIL = (() => {
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}').client_email || 'cuenta-de-servicio@...';
  } catch (err) {
    console.error('Error parseando GOOGLE_SERVICE_ACCOUNT_JSON');
    return 'cuenta-de-servicio@...';
  }
})();

// Configurar EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configuración de Sesiones
// El secreto firma las cookies de sesión: con el valor de ejemplo (público en
// el repo) cualquiera podría fabricar una sesión válida.
const SECRETOS_INSEGUROS = ['', 'inventariolab-secret', 'un_secreto_super_seguro_para_vps'];
const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (SECRETOS_INSEGUROS.includes(SESSION_SECRET) || SESSION_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ SESSION_SECRET falta o es inseguro. Generá uno con: openssl rand -hex 32');
    process.exit(1);
  }
  console.warn('⚠️ SESSION_SECRET inseguro: aceptable solo en desarrollo.');
}

// Las sesiones se guardan en archivos (carpeta sessions/), así un reinicio o
// despliegue no cierra la sesión de todos los usuarios.
app.use(session({
  store: new FileSessionStore({ dir: process.env.SESSIONS_DIR || path.join(__dirname, 'sessions') }),
  secret: SESSION_SECRET || 'solo-desarrollo',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: 'auto', // Secure cuando la petición llega por HTTPS (vía proxy)
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
  }
}));

// Configurar Passport
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CLIENT_ID !== 'test') {
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/inventariolab/auth/google/callback`,
      passReqToCallback: true
    },
    function(req, accessToken, refreshToken, profile, cb) {
      const email = profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null;
      return cb(null, { email });
    }
  ));
}

// Servir archivos estáticos si los hubiera
app.use('/inventariolab/public', express.static(path.join(__dirname, 'public')));

// Router para el subpath
const router = express.Router();

// Rutas explícitas para PWA (evita problemas de Nginx y asegura MIME types correctos)
router.get('/public/app_icon', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app_icon.png'));
});
router.get('/public/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});
router.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Middleware de inyección de configuración y protección
router.use('/lab/:labId', async (req, res, next) => {
  try {
    const config = await googleClient.getAppConfig(req.params.labId);
    req.appConfig = config;
    
    // Auto-login silencioso para el MODO DEMO
    if (config.isDemo === 'SI') {
      req.session.email = 'invitado@demo.com';
      req.session.labId = req.params.labId;
    }
    
    next();
  } catch (err) {
    if (err.message === "ACCESO_DENEGADO") {
      // Remover cualquier id defectuoso o sin permisos del cliente
      return res.render('setup_error', { 
        serviceAccountEmail: SERVICE_ACCOUNT_EMAIL
      });
    }
    if (err.codigo === 'CONEXION_VENCIDA') {
      return res.status(503).send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Laboratorio desconectado</title><body style="font-family:system-ui;max-width:32em;margin:3em auto;padding:0 1em"><h2>Laboratorio desconectado</h2><p>La conexión de este laboratorio con Google venció o fue revocada. Avisa a un administrador del laboratorio para que vuelva a conectarlo.</p></body>');
    }
    console.error('Error al obtener config:', err);
    res.status(500).send('Error de servidor al contactar Google Sheets.');
  }
});

// ─── RUTAS DE VISTAS ──────────────────────────────────

/**
 * Destino al que volver después del login/logout. Solo se aceptan rutas de
 * esta app: cualquier otra cosa (otro dominio, //host, \host) se reemplaza
 * por el inicio del laboratorio, para que nadie pueda armar un enlace de login
 * que termine en otro sitio (open redirect).
 */
function destinoSeguro(destino, labId) {
  const porDefecto = `/inventariolab/lab/${labId || 'default'}`;
  if (typeof destino !== 'string' || destino.length > 2000) return porDefecto;
  if (!destino.startsWith('/inventariolab/') || /[\\\s]/.test(destino) || destino.startsWith('//')) return porDefecto;
  return destino;
}

/** Enlace a la página de login que vuelve a `destino` */
function urlLogin(labId, destino) {
  return `/inventariolab/lab/${labId}/login?redirect=${encodeURIComponent(destinoSeguro(destino, labId))}`;
}

router.get('/lab/:labId/login', (req, res) => {
  const destino = destinoSeguro(req.query.redirect, req.params.labId);
  // Si ya inició sesión en este laboratorio, vuelve directo a donde estaba
  if (req.session.email && req.session.labId === req.params.labId) {
    return res.redirect(destino);
  }

  res.render('login', {
    labId: req.params.labId,
    config: req.appConfig,
    redirect: destino
  });
});

router.get('/lab/:labId/logout', (req, res) => {
  // Con ?redirect= (p. ej. "cambiar de cuenta" desde un armario) se vuelve
  // al login y, tras iniciar sesión, a esa misma página
  const destino = req.query.redirect;
  req.session.destroy(() => {
    res.redirect(destino ? urlLogin(req.params.labId, destino) : `/inventariolab/lab/${req.params.labId}/login`);
  });
});

router.get('/lab/:labId', async (req, res) => {
  const { labId } = req.params;
  const { zona } = req.query;
  const email = req.session.email;

  // Si tiene zona (Vista de armario)
  if (zona) {
    let permisos = { autorizado: false, esAdmin: false, puedeReportar: false };

    if (email && req.session.labId === labId) {
      permisos = req.appConfig.isDemo === 'SI'
        ? googleClient.permisosDeRol(req.appConfig.demoRol)
        : await googleClient.verificarPermisos(labId, email);
    }
    const { autorizado, esAdmin, puedeReportar } = permisos;

    if (req.appConfig.accesoPublico === 'NO' && !autorizado) {
      return res.redirect(urlLogin(labId, req.originalUrl));
    }

    try {
      const filas = await googleClient.getFilasPorZona(labId, zona);
      const zonasAdmin = esAdmin ? await googleClient.obtenerZonasAdmin(labId) : [];
      const arrayZonas = zonasAdmin.map(z => (z[1] || '').toString().trim()).filter(String);
      
      const config = { ...req.appConfig, esAdmin, autorizado, puedeReportar, email, zonasAdmin: arrayZonas };
      
      return res.render('armario', { zona, filas, config, labId,
        urlLogin: urlLogin(labId, req.originalUrl),
        urlCambiarCuenta: `/inventariolab/lab/${labId}/logout?redirect=${encodeURIComponent(req.originalUrl)}` });
    } catch (err) {
      console.error(err);
      return res.status(500).send('Error cargando zona');
    }
  }

  // Vista Dashboard (Buscador Global) - Requiere Login
  if (!email || req.session.labId !== labId) {
    return res.redirect(`/inventariolab/lab/${labId}/login`);
  }

  const permisos = req.appConfig.isDemo === 'SI'
    ? googleClient.permisosDeRol(req.appConfig.demoRol)
    : await googleClient.verificarPermisos(labId, email);

  if (!permisos.autorizado) {
    return res.render('access_denied', { email, config: req.appConfig });
  }

  return res.render('dashboard', { 
    config: req.appConfig, 
    esAdmin: permisos.esAdmin,
    rol: permisos.rol,
    email,
    labId,
    driveAutorizado: driveUsuario.estado(labId).autorizado,
    driveMsg: req.query.creado === '1' ? 'creado' : String(req.query.drive || ''),
    importados: req.query.creado === '1' ? Math.min(parseInt(req.query.importados, 10) || 0, 100000) : 0,
    avisoMedicion: permisos.esAdmin && registroBusquedas.listoParaVerificar() ? { cantidad: registroBusquedas.cantidad() } : null
  });
});

// ─── RUTAS GLOBALES (SIN LABID) ────────────────────────

router.get('/', (req, res) => {
  res.render('home', { serviceAccountEmail: SERVICE_ACCOUNT_EMAIL });
});

router.get('/privacidad', (req, res) => {
  res.render('privacidad');
});

// ─── CREAR MI LABORATORIO ─────────────────────────────
// La persona entra con Google y la app crea la planilla y la carpeta de fotos
// en SU Drive (permiso drive.file); queda como ADMIN y el permiso se guarda
// para que la app lea y escriba esa planilla. No hace falta compartir nada con
// la cuenta de servicio.
const MENSAJES_CREAR = {
  cancelado: 'Cancelaste el permiso en Google, así que no se creó nada. Podés intentarlo de nuevo.',
  fallo: 'No se pudo crear el laboratorio. Probá de nuevo en unos minutos; si se repite, avisá a quien administra el servidor.',
  nombres: 'Completá el nombre del centro y el del laboratorio.',
  formulario: 'El formulario venció o se envió demasiado rápido. Recargá la página y probá de nuevo.',
  verificacion: 'No pudimos comprobar que sos una persona. Probá de nuevo.',
  demasiados: 'Hubo demasiados intentos desde tu conexión. Probá de nuevo más tarde.',
  'limite-total': 'Este servidor no admite más laboratorios por ahora.',
  'limite-dia': 'Hoy se alcanzó el máximo de laboratorios nuevos. Probá de nuevo mañana.',
  'limite-correo': 'Esta cuenta de Google ya alcanzó el máximo de laboratorios que puede crear.',
};
const LIMITES_CREAR = antibots.topes();
const limitarCreacionPorIp = crearLimitador(LIMITES_CREAR.porIpHora, 60 * 60 * 1000);
const SECRETO_FORMULARIO = SESSION_SECRET || 'solo-desarrollo';
const turnstile = { clave: process.env.TURNSTILE_SITE_KEY || '', secreto: process.env.TURNSTILE_SECRET_KEY || '' };

const paginaCrear = modo => (req, res) => {
  const cerrado = antibots.motivoDeLimite(driveUsuario.laboratoriosPropios(), LIMITES_CREAR);
  res.render('crear', {
    modo,
    error: MENSAJES_CREAR[req.query.error] || (cerrado === 'limite-total' || cerrado === 'limite-dia' ? MENSAJES_CREAR[cerrado] : ''),
    configurado: !!process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'test' && !(cerrado === 'limite-total' || cerrado === 'limite-dia'),
    token: antibots.emitirToken(SECRETO_FORMULARIO),
    turnstileClave: turnstile.clave,
  });
};
router.get('/crear', paginaCrear('crear'));
router.get('/importar', paginaCrear('importar'));

router.post(['/crear', '/importar'], async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'test') {
    return res.status(500).send('Google OAuth no está configurado (falta el Client ID).');
  }
  const esImportacion = req.body.modo === 'importar';
  const volver = codigo => res.redirect(`/inventariolab/${esImportacion ? 'importar' : 'crear'}?error=${codigo}`);
  // formulario genuino: token firmado y no demasiado rápido, y el campo trampa vacío
  if (req.body.sitio_web || antibots.validarToken(req.body.token, SECRETO_FORMULARIO, { minMs: LIMITES_CREAR.minMs }) !== 'ok') return volver('formulario');
  if (!limitarCreacionPorIp(req.ip)) return volver('demasiados');
  if (turnstile.secreto && !(await antibots.verificarTurnstile({ secreto: turnstile.secreto, token: req.body['cf-turnstile-response'], ip: req.ip }))) return volver('verificacion');
  const cerrado = antibots.motivoDeLimite(driveUsuario.laboratoriosPropios(), LIMITES_CREAR);
  if (cerrado) return volver(cerrado);

  const institucion = plantilla.limpiarNombre(req.body.institucion);
  const laboratorio = plantilla.limpiarNombre(req.body.laboratorio);
  if (!institucion || !laboratorio) return volver('nombres');

  const state = crypto.randomBytes(24).toString('hex');
  req.session.crearLab = { state, institucion, laboratorio, importar: esImportacion };
  req.session.save(err => {
    if (err) return res.status(500).send('No se pudo iniciar la creación.');
    res.redirect(driveUsuario.urlAutorizacion(state, undefined, { conIdentidad: true }));
  });
});

async function finalizarCreacion(req, res, pedido) {
  delete req.session.crearLab;
  const pagina = pedido.importar ? 'importar' : 'crear';
  if (req.query.error || !req.query.code) return res.redirect(`/inventariolab/${pagina}?error=cancelado`);
  try {
    const cuenta = await driveUsuario.identificarYConectar(req.query.code);
    // el tope por correo solo se puede comprobar ahora, que Google ya dijo quién es
    const cerrado = antibots.motivoDeLimite(driveUsuario.laboratoriosPropios(), LIMITES_CREAR, { email: cuenta.email });
    if (cerrado) {
      console.warn(`[crear] rechazado (${cerrado}): ${cuenta.email}`);
      return res.redirect(`/inventariolab/${pagina}?error=${cerrado}`);
    }
    // importar: antes de crear nada hay que elegir la planilla con el selector de Google
    if (pedido.importar) {
      req.session.importacion = guardarImportacion({ cuenta, institucion: pedido.institucion, laboratorio: pedido.laboratorio });
      return req.session.save(err => {
        if (err) throw err;
        res.redirect('/inventariolab/importar/elegir');
      });
    }
    const { sheetId } = await plantilla.crearLaboratorio({
      sheets: cuenta.sheets, drive: cuenta.drive,
      institucion: pedido.institucion, laboratorio: pedido.laboratorio, adminEmail: cuenta.email,
    });
    driveUsuario.guardarToken(sheetId, cuenta.refreshToken, cuenta.email, { modo: 'usuario' });
    console.log(`[crear] laboratorio ${sheetId} creado por ${cuenta.email}`);
    avisos.avisarCreacion({ email: cuenta.email, institucion: pedido.institucion, laboratorio: pedido.laboratorio, labId: sheetId, total: driveUsuario.laboratoriosPropios().length });
    // ya hizo login con Google: entra directo a su laboratorio
    req.session.email = cuenta.email;
    req.session.labId = sheetId;
    req.session.save(err => {
      if (err) console.error('[crear] sesión:', err.message);
      res.redirect(`/inventariolab/lab/${encodeURIComponent(sheetId)}?creado=1`);
    });
  } catch (err) {
    console.error('[crear]', err.message);
    res.redirect(`/inventariolab/${pagina}?error=fallo`);
  }
}

// ─── IMPORTAR UNA PLANILLA EXISTENTE ──────────────────
// Mismo ingreso que "Crear mi laboratorio" (Google + topes + anti-bots). Después:
// 1) selector de archivos de Google (la persona elige SU planilla; la app solo
//    ve esa), 2) elegir hoja y qué columna es cada cosa, 3) la app crea una
// planilla nueva con la plantilla y copia los datos. La original no se toca.
// Mientras se elige, las credenciales viven en memoria (no en disco ni en la sesión).
const importaciones = new Map();
const VIDA_IMPORTACION_MS = 30 * 60 * 1000;
const MAX_IMPORTACIONES = 100;

function guardarImportacion(datos) {
  const ahora = Date.now();
  for (const [id, i] of importaciones) if (ahora - i.creada > VIDA_IMPORTACION_MS) importaciones.delete(id);
  while (importaciones.size >= MAX_IMPORTACIONES) importaciones.delete(importaciones.keys().next().value);
  const id = crypto.randomBytes(24).toString('hex');
  importaciones.set(id, { ...datos, creada: ahora, origen: null });
  return id;
}
function importacionDe(req) {
  const i = importaciones.get(req.session.importacion);
  if (!i || Date.now() - i.creada > VIDA_IMPORTACION_MS) { importaciones.delete(req.session.importacion); return null; }
  return i;
}
const sinImportacion = res => res.redirect('/inventariolab/importar?error=vencido');
MENSAJES_CREAR.vencido = 'Pasó demasiado tiempo y la importación venció. Empezá de nuevo.';
MENSAJES_CREAR.planilla = 'No se pudo leer esa planilla. Elegila de nuevo.';

router.get('/importar/elegir', (req, res) => {
  const i = importacionDe(req);
  if (!i) return sinImportacion(res);
  res.setHeader('Cache-Control', 'no-store');
  res.render('importar-elegir', {
    accessToken: i.cuenta.accessToken || '',
    appId: (process.env.GOOGLE_CLIENT_ID || '').split('-')[0],
    error: MENSAJES_CREAR[req.query.error] || '',
  });
});

router.post('/importar/origen', async (req, res) => {
  const i = importacionDe(req);
  if (!i) return sinImportacion(res);
  try {
    i.origen = await importar.leerOrigen(i.cuenta.sheets, String(req.body.fileId || ''));
    res.redirect('/inventariolab/importar/mapear');
  } catch (err) {
    console.warn('[importar] origen:', err.message);
    res.redirect('/inventariolab/importar/elegir?error=planilla');
  }
});

router.get('/importar/mapear', (req, res) => {
  const i = importacionDe(req);
  if (!i) return sinImportacion(res);
  if (!i.origen) return res.redirect('/inventariolab/importar/elegir');
  const hojas = i.origen.hojas;
  const hoja = Math.min(Math.max(parseInt(req.query.hoja, 10) || 0, 0), hojas.length - 1);
  const filas = hojas[hoja].filas;
  const filaEnc = Math.min(Math.max(parseInt(req.query.enc, 10) || importar.adivinarFilaEncabezados(filas), 1), Math.max(filas.length, 1));
  const encabezados = filas[filaEnc - 1] || [];
  const columnas = Math.max(encabezados.length, ...filas.slice(filaEnc, filaEnc + importar.VISTA_PREVIA).map(f => f.length), 1);
  res.setHeader('Cache-Control', 'no-store');
  res.render('importar-mapear', {
    titulo: i.origen.titulo, hojas, hoja, filaEnc, columnas, encabezados,
    vista: filas.slice(filaEnc, filaEnc + importar.VISTA_PREVIA),
    totalFilas: Math.max(filas.length - filaEnc, 0),
    mapeo: importar.adivinarColumnas(encabezados),
    letra: importar.letraDe, maxFilas: importar.MAX_FILAS,
    error: req.query.error === 'articulo' ? 'Elegí qué columna tiene el nombre del artículo.' : req.query.error === 'vacia' ? 'No se encontró ningún artículo con esa elección. Revisá la fila de encabezados y la columna del artículo.' : '',
  });
});

router.post('/importar/crear', async (req, res) => {
  const i = importacionDe(req);
  if (!i || !i.origen) return sinImportacion(res);
  const hoja = i.origen.hojas[parseInt(req.body.hoja, 10)];
  const filaEnc = parseInt(req.body.enc, 10);
  const volver = codigo => res.redirect(`/inventariolab/importar/mapear?hoja=${parseInt(req.body.hoja, 10) || 0}&enc=${filaEnc || 1}&error=${codigo}`);
  if (!hoja || !(filaEnc >= 1)) return volver('articulo');
  const mapeo = {};
  for (const campo of ['articulo', 'cod', 'bien', 'regular', 'roto', 'obs', 'ubicacion']) {
    const v = String(req.body[campo] == null ? '' : req.body[campo]);
    mapeo[campo] = /^\d{1,2}$/.test(v) ? Number(v) : '';
  }
  let convertido;
  try { convertido = importar.convertir({ filas: hoja.filas, filaEncabezados: filaEnc, mapeo }); }
  catch (err) { return volver('articulo'); }
  if (!convertido.importadas) return volver('vacia');

  importaciones.delete(req.session.importacion); // un solo intento: no se crean dos laboratorios con la misma elección
  delete req.session.importacion;
  try {
    const { cuenta } = i;
    const { sheetId, hojaInventarioId } = await plantilla.crearLaboratorio({
      sheets: cuenta.sheets, drive: cuenta.drive, institucion: i.institucion, laboratorio: i.laboratorio, adminEmail: cuenta.email,
    });
    driveUsuario.guardarToken(sheetId, cuenta.refreshToken, cuenta.email, { modo: 'usuario' });
    await importar.copiarDatos({ sheets: cuenta.sheets, sheetId, idHojaInventario: hojaInventarioId, convertido });
    console.log(`[importar] laboratorio ${sheetId} creado por ${cuenta.email} con ${convertido.importadas} artículos`);
    avisos.avisarCreacion({ email: cuenta.email, institucion: i.institucion, laboratorio: i.laboratorio, labId: sheetId, total: driveUsuario.laboratoriosPropios().length });
    req.session.email = cuenta.email;
    req.session.labId = sheetId;
    req.session.save(err => {
      if (err) console.error('[importar] sesión:', err.message);
      res.redirect(`/inventariolab/lab/${encodeURIComponent(sheetId)}?creado=1&importados=${convertido.importadas}`);
    });
  } catch (err) {
    console.error('[importar]', err.message);
    res.redirect('/inventariolab/importar?error=fallo');
  }
});

// ─── AUTORIZAR DRIVE (para guardar fotos) ───────────
// La cuenta de servicio no puede ser dueña de archivos en Drive (no tiene
// cuota), así que las fotos las sube un admin con su propio permiso.
router.get('/lab/:labId/auth/drive', async (req, res) => {
  const { labId } = req.params;
  const email = req.session.email;
  if (!email || req.session.labId !== labId) return res.redirect(`/inventariolab/lab/${labId}/login`);
  if (req.appConfig.isDemo === 'SI') return res.status(400).send('No disponible en modo demo.');
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'test') {
    return res.status(500).send('Google OAuth no está configurado (falta el Client ID).');
  }
  const permisos = await googleClient.verificarPermisos(labId, email);
  if (!permisos.esAdmin) return res.status(403).send('Solo administradores');

  const state = crypto.randomBytes(24).toString('hex');
  req.session.driveOAuth = { state, labId };
  req.session.save(err => {
    if (err) return res.status(500).send('No se pudo iniciar la autorización.');
    res.redirect(driveUsuario.urlAutorizacion(state, email));
  });
});

router.get('/auth/drive/callback', async (req, res) => {
  const creando = req.session.crearLab;
  if (creando && req.query.state && req.query.state === creando.state) return finalizarCreacion(req, res, creando);
  const pendiente = req.session.driveOAuth;
  const email = req.session.email;
  if (!pendiente || !email || !req.query.state || req.query.state !== pendiente.state) {
    return res.status(400).send('Solicitud de autorización inválida o vencida. Volvé al panel y probá de nuevo.');
  }
  const { labId } = pendiente;
  delete req.session.driveOAuth;
  const volver = resultado => res.redirect(`/inventariolab/lab/${encodeURIComponent(labId)}?drive=${resultado}`);

  if (req.query.error || !req.query.code) return volver('cancelado');
  try {
    // se vuelve a comprobar que sigue siendo admin: el permiso queda guardado para toda la app
    const permisos = await googleClient.verificarPermisos(labId, email);
    if (!permisos.esAdmin) return res.status(403).send('Solo administradores');
    await driveUsuario.guardarDesdeCodigo(labId, req.query.code, email);
    googleClient.olvidarCarpetaFotos(labId);
    volver('ok');
  } catch (err) {
    console.error('[auth/drive]', err.message);
    volver('error');
  }
});

router.get('/ayuda', (req, res) => {
  res.render('ayuda');
});

// ─── GOOGLE OAUTH CALLBACK ───────────────────────────

router.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'test') {
    return res.status(500).send('Google OAuth no está configurado (Falta el Client ID). Revisa tu .env');
  }
  const labId = req.query.labId;
  const redirect = destinoSeguro(req.query.redirect, labId);
  
  // Guardamos estado en un Base64 (A prueba de fallos de sesión)
  const stateStr = Buffer.from(JSON.stringify({ labId, redirect })).toString('base64');
  
  passport.authenticate('google', { scope: ['profile', 'email'], state: stateStr })(req, res, next);
});

router.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/inventariolab?error=oauth_failed' }),
  (req, res) => {
    // Recuperar estado desde la URL
    let stateObj = {};
    if (req.query.state) {
      try {
        stateObj = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf8'));
      } catch(e) { console.error("Error parsing state", e); }
    }
    
    const { labId, redirect } = stateObj;
    console.log("OAuth Success! Email:", req.user?.email, "LabID:", labId);

    // Setear credenciales en la sesión
    req.session.email = req.user.email;
    if (labId) req.session.labId = labId;
    
    // Forzar guardado de la cookie ANTES de redirigir
    req.session.save((err) => {
      if (err) console.error("Error guardando sesion final:", err);
      res.redirect(destinoSeguro(redirect, labId));
    });
  }
);


// ─── API ENDPOINTS (Backend Auth) ─────────────────────

// Middleware para APIs protegidas
const apiAuth = async (req, res, next) => {
  const email = req.session.email;
  const labId = req.params.labId;
  if (!email || req.session.labId !== labId) return res.status(401).json({ error: 'No autenticado' });
  
  const permisos = req.appConfig.isDemo === 'SI'
    ? googleClient.permisosDeRol(req.appConfig.demoRol)
    : await googleClient.verificarPermisos(labId, email);

  if (!permisos.autorizado) return res.status(403).json({ error: 'No autorizado' });
  
  req.userPermisos = permisos;
  req.userEmail = email;
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.userPermisos.esAdmin) return res.status(403).json({ error: 'Solo administradores' });
  next();
};

// El rol VISOR es de solo lectura: no puede reportar incidencias
const requireReportar = (req, res, next) => {
  if (!req.userPermisos.puedeReportar) return res.status(403).json({ error: 'Tu rol es de solo lectura' });
  next();
};

// ─── EXPORTAR (solo admins) ───────────────────────────
// El laboratorio es del docente: puede llevarse la planilla (.ods) y las fotos
// (ZIP) cuando quiera. Se limita a un ZIP por laboratorio a la vez y a 2 en todo
// el servidor, porque bajar cientos de fotos ocupa red y memoria del VPS.
const exportandoFotos = new Set();
const MAX_EXPORTACIONES_SIMULTANEAS = 2;

/** Content-Disposition con un nombre legible (con tildes) y uno ASCII de respaldo */
function adjunto(nombre, extension, disposicion = 'attachment') {
  const base = exportar.nombreSeguro(nombre, 80);
  const ascii = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ._()-]/g, '_');
  return `${disposicion}; filename="${ascii}.${extension}"; filename*=UTF-8''${encodeURIComponent(base + '.' + extension)}`;
}

// PDF A4 con las etiquetas QR de las zonas elegidas (ninguna lista = todas). Se arma en memoria y se envía entero.
router.post('/lab/:labId/api/qrs.pdf', apiAuth, requireAdmin, async (req, res) => {
  try {
    const ids = req.body && req.body.listaIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 1000)) {
      return res.status(400).json({ error: 'Lista de zonas inválida.' });
    }
    const zonas = qrPdf.elegirZonas(await googleClient.obtenerZonasAdmin(req.params.labId), ids);
    if (zonas.length === 0) return res.status(404).json({ error: 'No hay zonas para generar el PDF.' });
    let baseUrl = process.env.APP_BASE_URL || `http://${req.headers.host}`;
    if (!baseUrl.endsWith('/inventariolab')) baseUrl += '/inventariolab';
    const trozos = [];
    const salida = new Writable({ write(c, _, cb) { trozos.push(c); cb(); } });
    await qrPdf.generarPdfQr({ zonas, baseUrl, labId: req.params.labId, salida, titulo: `QR - ${req.appConfig.laboratorio}` });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', adjunto(`QR - ${req.appConfig.laboratorio}`, 'pdf', 'inline'));
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.concat(trozos));
  } catch (err) {
    console.error('[qrs.pdf]', err.message);
    res.status(500).json({ error: 'No se pudo generar el PDF. Probá de nuevo.' });
  }
});

router.get('/lab/:labId/exportar/planilla.ods', apiAuth, requireAdmin, async (req, res) => {
  try {
    const stream = await googleClient.abrirExportacionOds(req.params.labId);
    res.setHeader('Content-Type', exportar.MIME_ODS);
    res.setHeader('Content-Disposition', adjunto(`${req.appConfig.laboratorio} - ${req.appConfig.institucion}`, 'ods'));
    res.setHeader('Cache-Control', 'no-store');
    stream.on('error', err => { console.error('[exportar ods]', err.message); res.destroy(err); });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    console.error('[exportar ods]', err.message);
    const status = err.codigo === 'CONEXION_VENCIDA' ? 503 : err.codigo === 'PLANILLA_GRANDE' ? 413 : 502;
    res.status(status).json({ error: err.codigo ? err.message : 'No se pudo exportar la planilla. Probá de nuevo en unos minutos.' });
  }
});

// Enlaces viejos de la planilla en .xlsx: ahora se exporta en formato abierto (.ods)
router.get('/lab/:labId/exportar/planilla.xlsx', (req, res) => {
  res.redirect(301, `/inventariolab/lab/${encodeURIComponent(req.params.labId)}/exportar/planilla.ods`);
});

// «Materiales sin foto» en formatos abiertos (ods, csv, pdf), de todos los armarios o de uno (?zona=)
const FORMATOS_LISTADO = { ods: listados.MIME_ODS, csv: listados.MIME_CSV, pdf: 'application/pdf' };
router.get('/lab/:labId/exportar/sin-foto.:formato', apiAuth, requireAdmin, async (req, res) => {
  try {
    const formato = req.params.formato;
    if (!Object.hasOwn(FORMATOS_LISTADO, formato)) return res.status(404).json({ error: 'Formato no disponible. Usá ods, csv o pdf.' });
    const zona = typeof req.query.zona === 'string' ? req.query.zona : undefined;
    const todos = await googleClient.buscarEnInventario(req.params.labId, '');
    const faltan = listados.sinFoto(todos, zona);
    const filas = listados.filasSinFoto(faltan);
    const nombreZona = zona === listados.SIN_UBICACION ? 'Sin ubicación' : (zona || '').trim();
    const titulo = nombreZona ? `Materiales sin foto - ${nombreZona}` : 'Materiales sin foto';

    let cuerpo;
    if (formato === 'csv') {
      cuerpo = Buffer.from(listados.generarCsv(listados.ENCABEZADOS_SIN_FOTO, filas), 'utf8');
    } else {
      const trozos = [];
      const salida = new Writable({ write(c, _, cb) { trozos.push(c); cb(); } });
      if (formato === 'ods') {
        await listados.generarOds({ nombreHoja: 'Sin foto', encabezados: listados.ENCABEZADOS_SIN_FOTO, filas, salida });
      } else {
        await listados.generarPdfListado({
          titulo, encabezados: listados.ENCABEZADOS_SIN_FOTO, filas, anchos: [0.55, 0.30, 0.15], salida,
          subtitulo: `${req.appConfig.laboratorio} - ${req.appConfig.institucion}  ·  ${filas.length} ${filas.length === 1 ? 'material' : 'materiales'}`,
        });
      }
      cuerpo = Buffer.concat(trozos);
    }
    res.setHeader('Content-Type', FORMATOS_LISTADO[formato]);
    res.setHeader('Content-Disposition', adjunto(`${titulo} - ${req.appConfig.laboratorio}`, formato));
    res.setHeader('Cache-Control', 'no-store');
    res.send(cuerpo);
  } catch (err) {
    console.error('[exportar sin-foto]', err.message);
    res.status(500).json({ error: 'No se pudo armar el listado. Probá de nuevo.' });
  }
});

router.get('/lab/:labId/exportar/fotos.zip', apiAuth, requireAdmin, async (req, res) => {
  const { labId } = req.params;
  if (exportandoFotos.has(labId)) return res.status(429).json({ error: 'Ya hay una exportación de fotos en curso para este laboratorio. Esperá a que termine.' });
  if (exportandoFotos.size >= MAX_EXPORTACIONES_SIMULTANEAS) return res.status(429).json({ error: 'El servidor está exportando fotos de otros laboratorios. Probá de nuevo en unos minutos.' });
  exportandoFotos.add(labId);
  const cancelador = new AbortController();
  res.on('close', () => { if (!res.writableFinished) cancelador.abort(); exportandoFotos.delete(labId); });
  try {
    const articulos = await googleClient.articulosConFoto(labId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', adjunto(`Fotos - ${req.appConfig.laboratorio} - ${req.appConfig.institucion}`, 'zip'));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no'); // que Nginx no junte todo antes de enviar
    const r = await exportar.armarZip({ articulos, salida: res, señal: cancelador.signal });
    console.log(`[exportar fotos] ${labId}: ${r.fotos} fotos, ${r.fallidas} fallidas, ${r.bytes} bytes`);
  } catch (err) {
    console.error('[exportar fotos]', err.message);
    if (!res.headersSent) {
      res.status(err.codigo === 'DEMASIADAS_FOTOS' ? 413 : err.codigo === 'CONEXION_VENCIDA' ? 503 : 500)
        .json({ error: err.codigo ? err.message : 'No se pudo armar el ZIP de fotos.' });
    } else res.destroy(err); // el ZIP ya empezó: se corta para que el navegador no lo dé por completo
  }
});

router.get('/lab/:labId/api/buscar', apiAuth, async (req, res) => {
  try {
    const resultados = await googleClient.buscarEnInventario(req.params.labId, req.query.q || '');
    res.json(resultados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Búsqueda por foto: compara con las fotos guardadas y devuelve los 3 más parecidos
const buscadorFoto = crearBuscadorFoto();
const permitirBusquedaFoto = crearLimitador(10, 60000);
const registroBusquedas = crearRegistro({ dir: process.env.BUSQUEDAS_LOG_DIR || undefined });

router.post('/lab/:labId/api/buscar-foto', apiAuth, async (req, res) => {
  try {
    if (!permitirBusquedaFoto(req.userEmail)) {
      return res.status(429).json({ error: 'Demasiadas búsquedas por foto seguidas. Esperá un minuto.' });
    }
    const partes = String((req.body && req.body.base64) || '').split(',');
    const imagen = Buffer.from(partes[partes.length - 1], 'base64');
    if (!imagen.length) return res.status(400).json({ error: 'La imagen llegó vacía.' });
    if (imagen.length > 4 * 1024 * 1024) return res.status(413).json({ error: 'La imagen es demasiado grande.' });

    const articulos = await googleClient.articulosConFoto(req.params.labId);
    const inicio = Date.now();
    const { resultados, coincide, indexados } = await buscadorFoto.buscar(req.params.labId, articulos, imagen, 3);
    const busquedaId = registroBusquedas.busqueda(req.params.labId, { resultados, coincide, indexados }, Date.now() - inicio);
    res.json({ resultados, coincide, indexados, busquedaId });
  } catch (err) {
    if (err instanceof ErrorBusquedaFoto && err.codigo === 'OCUPADO') return res.status(429).json({ error: err.message });
    console.error('[buscar-foto]', err);
    res.status(500).json({ error: 'No se pudo analizar la foto.' });
  }
});

// Qué hizo la persona con el resultado (abrió un candidato o "Ninguno de estos"), para medir aciertos
router.post('/lab/:labId/api/buscar-foto/eleccion', apiAuth, (req, res) => {
  const { busquedaId, accion, articuloId } = req.body || {};
  registroBusquedas.eleccion(req.params.labId, { busquedaId, accion, articuloId });
  res.json({ ok: true });
});

router.post('/lab/:labId/api/buscar-foto/aviso-descartar', apiAuth, requireAdmin, (req, res) => {
  registroBusquedas.descartarAviso();
  res.json({ ok: true });
});

router.post('/lab/:labId/api/reportar', apiAuth, requireReportar, async (req, res) => {
  try {
    const { id, texto } = req.body;
    const { ultimo } = await googleClient.registrarReporte(req.params.labId, req.userEmail, id, texto);
    res.json({ success: true, ultimo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lab/:labId/api/foto', apiAuth, requireAdmin, async (req, res) => {
  try {
    const { id, base64, nombreArchivo } = req.body;
    const { url, ultimo } = await googleClient.subirFoto(req.params.labId, req.userEmail, id, base64, nombreArchivo);
    res.json({ url, ultimo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lab/:labId/api/mover', apiAuth, requireAdmin, async (req, res) => {
  try {
    const { id, nuevaZona } = req.body;
    await googleClient.cambiarUbicacion(req.params.labId, req.userEmail, id, nuevaZona);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lab/:labId/api/guardar-zona', apiAuth, requireAdmin, async (req, res) => {
  try {
    const { id, nombre, desc } = req.body;
    const result = await googleClient.guardarZona(req.params.labId, id, nombre, desc);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lab/:labId/api/eliminar-zona', apiAuth, requireAdmin, async (req, res) => {
  try {
    const { id, nombre } = req.body;
    const result = await googleClient.eliminarZona(req.params.labId, id, nombre);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/lab/:labId/api/zonas', apiAuth, requireAdmin, async (req, res) => {
  try {
    const zonas = await googleClient.obtenerZonasAdmin(req.params.labId);
    res.json(zonas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lab/:labId/api/generar-qrs', apiAuth, requireAdmin, async (req, res) => {
  try {
    const { listaIds } = req.body;
    let baseUrl = process.env.APP_BASE_URL || `http://${req.headers.host}`;
    if (!baseUrl.endsWith('/inventariolab')) baseUrl += '/inventariolab';
    const result = await googleClient.ejecutarGeneracionQR(req.params.labId, baseUrl, listaIds);
    res.json({ msg: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ruta principal de bienvenida / onboarding
router.get('/', (req, res) => {
  res.render('home', { serviceAccountEmail: SERVICE_ACCOUNT_EMAIL });
});

// Montar el router en el subpath definido
app.use('/inventariolab', router);

// Redirigir la raíz global al subpath
app.get('/', (req, res) => res.redirect('/inventariolab'));

app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log(`Subruta activa: /inventariolab`);
});
