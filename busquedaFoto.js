// Búsqueda por foto: compara una foto tomada con las fotos guardadas de los
// artículos (columna FOTO) usando embeddings de imagen calculados en el propio
// servidor (DINOv2-small cuantizado, sin servicios externos).
//
// - Los embeddings de cada laboratorio se guardan en EMBEDDINGS_DIR/<labId>.json
//   y se recalculan solos cuando cambia la URL de la foto de un artículo.
// - Todo pasa por una cola de a uno, para no saturar la CPU del VPS.
const fs = require('fs');
const path = require('path');

const MODELO = 'Xenova/dinov2-small';
const VERSION_INDICE = 1; // subir si cambia el modelo o la forma de calcular
const UMBRAL_COINCIDENCIA = 0.6; // medido: aciertos 0,50–0,66; artículos sin foto 0,35–0,55
const HOSTS_FOTO = ['lh3.googleusercontent.com', 'drive.google.com'];

class ErrorBusquedaFoto extends Error {
  constructor(mensaje, codigo) { super(mensaje); this.codigo = codigo; }
}

/** Embedding real: DINOv2-small, token CLS normalizado. Carga el modelo la primera vez. */
function crearEmbedder() {
  let listo;
  return async function embeber(buffer) {
    if (!listo) {
      listo = (async () => {
        const { pipeline, RawImage } = await import('@huggingface/transformers');
        const ext = await pipeline('image-feature-extraction', MODELO, {
          dtype: 'q8',
          session_options: { intraOpNumThreads: 2 }, // el VPS es chico
        });
        return { ext, RawImage };
      })();
      listo.catch(() => { listo = null; }); // si falla la carga, se reintenta en la próxima
    }
    const { ext, RawImage } = await listo;
    const img = await RawImage.fromBlob(new Blob([buffer]));
    const salida = await ext(img);
    const dim = salida.dims[salida.dims.length - 1];
    return normalizar(Array.from(salida.data).slice(0, dim));
  };
}

function normalizar(v) {
  const n = Math.hypot(...v) || 1;
  return v.map(x => x / n);
}

/** Descarga la miniatura de la foto, solo desde los hosts de Google permitidos */
async function descargarFoto(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !HOSTS_FOTO.includes(u.hostname)) {
    throw new Error('URL de foto no permitida');
  }
  const destino = u.hostname === 'lh3.googleusercontent.com' && !u.search && !/=[a-z0-9-]+$/i.test(url) ? url + '=w512' : url;
  const res = await fetch(destino, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

function producto(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Los n más parecidos, de mayor a menor. `indice` es un Map id -> { vec } */
function ordenarPorParecido(consulta, indice, n = 3) {
  const pares = [];
  for (const [id, it] of indice) pares.push({ id, puntaje: producto(consulta, it.vec) });
  return pares.sort((a, b) => b.puntaje - a.puntaje).slice(0, n);
}

function crearBuscadorFoto({
  embeber = crearEmbedder(),
  descargar = descargarFoto,
  dir = path.join(__dirname, 'embeddings'),
  maxCola = 3,
  log = console,
} = {}) {
  const indices = new Map(); // labId -> Map(id -> { url, vec })
  let cola = Promise.resolve();
  let pendientes = 0;

  const archivo = labId => path.join(dir, String(labId).replace(/[^A-Za-z0-9_-]/g, '_') + '.json');

  function cargar(labId) {
    let ix = indices.get(labId);
    if (ix) return ix;
    ix = new Map();
    try {
      const j = JSON.parse(fs.readFileSync(archivo(labId), 'utf8'));
      if (j.version === VERSION_INDICE && j.modelo === MODELO) {
        for (const [id, it] of Object.entries(j.items)) ix.set(id, it);
      }
    } catch { /* sin índice previo: se arma de cero */ }
    indices.set(labId, ix);
    return ix;
  }

  function guardar(labId, ix) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = archivo(labId) + '.tmp';
      const items = {};
      for (const [id, it] of ix) items[id] = { url: it.url, vec: it.vec.map(x => Math.round(x * 1e5) / 1e5) };
      fs.writeFileSync(tmp, JSON.stringify({ version: VERSION_INDICE, modelo: MODELO, items }));
      fs.renameSync(tmp, archivo(labId));
    } catch (err) {
      log.error('[busquedaFoto] no se pudo guardar el índice:', err.message);
    }
  }

  /** Pone el índice al día con las fotos actuales. Solo calcula lo nuevo o cambiado. */
  async function sincronizar(labId, articulos) {
    const ix = cargar(labId);
    const vigentes = new Map(articulos.filter(a => a.id && a.foto).map(a => [a.id, a.foto]));
    let cambios = false;
    for (const id of [...ix.keys()]) {
      if (!vigentes.has(id)) { ix.delete(id); cambios = true; }
    }
    for (const [id, url] of vigentes) {
      const previo = ix.get(id);
      if (previo && previo.url === url) continue;
      try {
        const vec = await embeber(await descargar(url));
        ix.set(id, { url, vec });
        cambios = true;
      } catch (err) {
        // una foto rota no tumba la búsqueda: se salta y se reintenta la próxima vez
        log.error(`[busquedaFoto] ${id}: ${err.message}`);
      }
    }
    if (cambios) guardar(labId, ix);
    return ix;
  }

  /** Mete la tarea en la cola de a uno; si ya hay demasiadas esperando, rechaza */
  function encolar(tarea) {
    if (pendientes >= maxCola) throw new ErrorBusquedaFoto('Hay muchas búsquedas en curso, probá de nuevo en unos segundos.', 'OCUPADO');
    pendientes++;
    const p = cola.then(tarea);
    cola = p.catch(() => {}).then(() => { pendientes--; });
    return p;
  }

  /**
   * Busca los `n` artículos con foto más parecidos a la imagen.
   * `articulos`: [{ id, articulo, ubicacion, foto }] con las fotos vigentes.
   */
  function buscar(labId, articulos, imagen, n = 3) {
    return encolar(async () => {
      const ix = await sincronizar(labId, articulos);
      if (!ix.size) return { resultados: [], coincide: false, indexados: 0 };
      const consulta = await embeber(imagen);
      const porId = new Map(articulos.map(a => [a.id, a]));
      const resultados = ordenarPorParecido(consulta, ix, n).map(r => ({ ...porId.get(r.id), puntaje: Math.round(r.puntaje * 100) / 100 }));
      return { resultados, coincide: resultados.length > 0 && resultados[0].puntaje >= UMBRAL_COINCIDENCIA, indexados: ix.size };
    });
  }

  return { buscar, sincronizar: (labId, articulos) => encolar(() => sincronizar(labId, articulos)) };
}

/** Límite por usuario: `max` búsquedas cada `ventanaMs` */
function crearLimitador(max = 10, ventanaMs = 60000) {
  const registro = new Map();
  return function permitir(clave, ahora = Date.now()) {
    const marcas = (registro.get(clave) || []).filter(t => ahora - t < ventanaMs);
    if (marcas.length >= max) { registro.set(clave, marcas); return false; }
    marcas.push(ahora);
    registro.set(clave, marcas);
    if (registro.size > 1000) { for (const [k, v] of registro) if (!v.some(t => ahora - t < ventanaMs)) registro.delete(k); }
    return true;
  };
}

module.exports = { crearBuscadorFoto, crearLimitador, ErrorBusquedaFoto, ordenarPorParecido, descargarFoto, UMBRAL_COINCIDENCIA, MODELO };
