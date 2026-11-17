const fs = require('fs');
const path = require('path');
const session = require('express-session');

/**
 * Almacén de sesiones en archivos: una sesión por archivo JSON.
 * Sobrevive a los reinicios de PM2 sin agregar dependencias ni servicios.
 *
 *  - Escritura atómica (archivo temporal + rename): un corte a mitad de
 *    escritura nunca deja una sesión corrupta.
 *  - Archivos con permisos 600 dentro de un directorio 700.
 *  - Limpieza periódica de sesiones vencidas o ilegibles.
 */
const SID_VALIDO = /^[A-Za-z0-9_-]{1,128}$/;
const TOUCH_MIN_MS = 60 * 1000; // no reescribir el archivo en cada request

class FileSessionStore extends session.Store {
  constructor({ dir, limpiezaMs = 60 * 60 * 1000 } = {}) {
    super();
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this._ultimoTouch = new Map();
    this._timer = setInterval(() => this.limpiar(), limpiezaMs);
    this._timer.unref();
    this.limpiar();
  }

  _ruta(sid) {
    // El sid viene firmado en la cookie, pero se valida igual para que nunca
    // pueda salir del directorio de sesiones.
    if (!SID_VALIDO.test(sid)) throw new Error('ID de sesión inválido');
    return path.join(this.dir, sid + '.json');
  }

  static _vencida(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires;
    return exp ? new Date(exp).getTime() <= Date.now() : false;
  }

  get(sid, cb) {
    let ruta;
    try { ruta = this._ruta(sid); } catch (e) { return cb(null, null); }
    fs.readFile(ruta, 'utf8', (err, txt) => {
      if (err) return cb(err.code === 'ENOENT' ? null : err, null);
      let sess;
      try { sess = JSON.parse(txt); } catch (e) { return this.destroy(sid, () => cb(null, null)); }
      if (FileSessionStore._vencida(sess)) return this.destroy(sid, () => cb(null, null));
      cb(null, sess);
    });
  }

  set(sid, sess, cb = () => {}) {
    let ruta;
    try { ruta = this._ruta(sid); } catch (e) { return cb(e); }
    const tmp = `${ruta}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFile(tmp, JSON.stringify(sess), { mode: 0o600 }, err => {
      if (err) return cb(err);
      fs.rename(tmp, ruta, err2 => {
        if (err2) fs.unlink(tmp, () => cb(err2));
        else { this._ultimoTouch.set(sid, Date.now()); cb(null); }
      });
    });
  }

  touch(sid, sess, cb = () => {}) {
    // Renueva el vencimiento, pero como mucho una vez por minuto por sesión
    const ultimo = this._ultimoTouch.get(sid) || 0;
    if (Date.now() - ultimo < TOUCH_MIN_MS) return cb(null);
    this.set(sid, sess, cb);
  }

  destroy(sid, cb = () => {}) {
    this._ultimoTouch.delete(sid);
    let ruta;
    try { ruta = this._ruta(sid); } catch (e) { return cb(null); }
    fs.unlink(ruta, err => cb(err && err.code !== 'ENOENT' ? err : null));
  }

  /** Borra sesiones vencidas, ilegibles y temporales huérfanos */
  limpiar() {
    fs.readdir(this.dir, (err, archivos) => {
      if (err) return;
      for (const nombre of archivos) {
        const ruta = path.join(this.dir, nombre);
        if (nombre.endsWith('.tmp')) {
          fs.stat(ruta, (e, st) => { if (!e && Date.now() - st.mtimeMs > 60 * 1000) fs.unlink(ruta, () => {}); });
          continue;
        }
        if (!nombre.endsWith('.json')) continue;
        fs.readFile(ruta, 'utf8', (e, txt) => {
          if (e) return;
          let sess = null;
          try { sess = JSON.parse(txt); } catch (_) { /* ilegible: se borra */ }
          if (!sess || FileSessionStore._vencida(sess)) {
            this._ultimoTouch.delete(nombre.slice(0, -5));
            fs.unlink(ruta, () => {});
          }
        });
      }
    });
  }
}

module.exports = FileSessionStore;
