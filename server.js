require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const googleClient = require('./googleClient');

const app = express();
app.set('trust proxy', 1); // Confiar en el proxy de Nginx
const PORT = process.env.PORT || 3000;

// Configurar EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configuración de Sesiones
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: true,
  saveUninitialized: true,
  cookie: { 
    secure: false, // Debe ser false porque Nginx no está enviando X-Forwarded-Proto
    maxAge: 24 * 60 * 60 * 1000 
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

// Middleware de inyección de configuración
router.use('/lab/:labId', async (req, res, next) => {
  if (req.path.includes('/api/')) return next();
  try {
    const config = await googleClient.getAppConfig(req.params.labId);
    req.appConfig = config;
    next();
  } catch (err) {
    console.error('Error al obtener config:', err);
    res.status(500).send('Error de servidor al contactar Google Sheets.');
  }
});

// ─── RUTAS DE VISTAS ──────────────────────────────────

router.get('/lab/:labId/login', (req, res) => {
  const { labId } = req.params;
  const redirect = req.query.redirect || `/inventariolab/lab/${labId}`;
  res.render('login', { labId, redirect, config: req.appConfig, mockEmail: process.env.MOCK_AUTH_EMAIL });
});

router.post('/lab/:labId/login/mock', async (req, res) => {
  if (process.env.NODE_ENV !== 'development' && !process.env.MOCK_AUTH_EMAIL) {
    return res.status(403).send('Mock login deshabilitado');
  }
  const { labId } = req.params;
  const email = req.body.email || process.env.MOCK_AUTH_EMAIL;
  
  // Guardamos sesión simple
  req.session.email = email;
  req.session.labId = labId;
  
  const redirect = req.body.redirect || `/inventariolab/lab/${labId}`;
  res.redirect(redirect);
});

router.get('/lab/:labId/logout', (req, res) => {
  req.session.destroy();
  res.redirect(`/inventariolab/lab/${req.params.labId}/login`);
});

router.get('/lab/:labId', async (req, res) => {
  const { labId } = req.params;
  const { zona } = req.query;
  const email = req.session.email;

  // Si tiene zona (Vista de armario)
  if (zona) {
    let autorizado = false;
    let esAdmin = false;

    if (email && req.session.labId === labId) {
      const permisos = await googleClient.verificarPermisos(labId, email);
      autorizado = permisos.autorizado;
      esAdmin = permisos.esAdmin;
    }

    if (req.appConfig.accesoPublico === 'NO' && !autorizado) {
      return res.redirect(`/inventariolab/lab/${labId}/login?redirect=${encodeURIComponent(req.originalUrl)}`);
    }

    try {
      const filas = await googleClient.getFilasPorZona(labId, zona);
      const zonasAdmin = esAdmin ? await googleClient.obtenerZonasAdmin(labId) : [];
      const arrayZonas = zonasAdmin.map(z => (z[1] || '').toString().trim()).filter(String);
      
      const config = { ...req.appConfig, esAdmin, autorizado, email, zonasAdmin: arrayZonas };
      
      return res.render('armario', { zona, filas, config, labId });
    } catch (err) {
      console.error(err);
      return res.status(500).send('Error cargando zona');
    }
  }

  // Vista Dashboard (Buscador Global) - Requiere Login
  if (!email || req.session.labId !== labId) {
    return res.redirect(`/inventariolab/lab/${labId}/login`);
  }

  const permisos = await googleClient.verificarPermisos(labId, email);
  if (!permisos.autorizado) {
    return res.render('access_denied', { email, config: req.appConfig });
  }

  return res.render('dashboard', { 
    config: req.appConfig, 
    esAdmin: permisos.esAdmin,
    email,
    labId 
  });
});

// ─── GOOGLE OAUTH CALLBACK ───────────────────────────

router.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'test') {
    return res.status(500).send('Google OAuth no está configurado (Falta el Client ID). Revisa tu .env');
  }
  const labId = req.query.labId;
  const redirect = req.query.redirect || `/inventariolab/lab/${labId}`;
  
  // Guardamos estado en la sesión y forzamos el guardado antes de redirigir
  req.session.oauthState = { labId, redirect };
  req.session.save((err) => {
    if (err) console.error("Error guardando sesion:", err);
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });
});

router.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/inventariolab?error=oauth_failed' }),
  (req, res) => {
    // ¡Éxito!
    console.log("OAuth Success! Session ID:", req.sessionID);
    console.log("OAuth State:", req.session.oauthState);
    console.log("User Email:", req.user?.email);

    const { labId, redirect } = req.session.oauthState || {};
    req.session.email = req.user.email;
    
    if (labId) req.session.labId = labId;
    delete req.session.oauthState;
    
    const finalRedirect = redirect || `/inventariolab/lab/${labId || 'default'}`;
    console.log("Redirecting to:", finalRedirect);
    res.redirect(finalRedirect);
  }
);


// ─── API ENDPOINTS (Backend Auth) ─────────────────────

// Middleware para APIs protegidas
const apiAuth = async (req, res, next) => {
  const email = req.session.email;
  const labId = req.params.labId;
  if (!email || req.session.labId !== labId) return res.status(401).json({ error: 'No autenticado' });
  
  const permisos = await googleClient.verificarPermisos(labId, email);
  if (!permisos.autorizado) return res.status(403).json({ error: 'No autorizado' });
  
  req.userPermisos = permisos;
  req.userEmail = email;
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.userPermisos.esAdmin) return res.status(403).json({ error: 'Solo administradores' });
  next();
};

router.get('/lab/:labId/api/buscar', apiAuth, async (req, res) => {
  try {
    const resultados = await googleClient.buscarEnInventario(req.params.labId, req.query.q || '');
    res.json(resultados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lab/:labId/api/reportar', apiAuth, async (req, res) => {
  try {
    const { fila, texto } = req.body;
    await googleClient.registrarReporte(req.params.labId, req.userEmail, fila, texto);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lab/:labId/api/foto', apiAuth, requireAdmin, async (req, res) => {
  try {
    const { fila, base64, nombreArchivo } = req.body;
    const url = await googleClient.subirFoto(req.params.labId, req.userEmail, fila, base64, nombreArchivo);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/lab/:labId/api/mover', apiAuth, requireAdmin, async (req, res) => {
  try {
    const { fila, nuevaZona } = req.body;
    await googleClient.cambiarUbicacion(req.params.labId, req.userEmail, fila, nuevaZona);
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
  let saEmail = 'cuenta-de-servicio@...';
  try {
    const credsStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (credsStr) {
      const creds = JSON.parse(credsStr);
      if (creds.client_email) saEmail = creds.client_email;
    }
  } catch (err) {
    console.error('Error parseando JSON en ruta home');
  }
  res.render('home', { serviceAccountEmail: saEmail });
});

// Montar el router en el subpath definido
app.use('/inventariolab', router);

// Redirigir la raíz global al subpath
app.get('/', (req, res) => res.redirect('/inventariolab'));

app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log(`Subruta activa: /inventariolab`);
});
