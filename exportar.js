// Exportar los datos de un laboratorio: la planilla (.xlsx) y un ZIP con las fotos.
//
// La planilla sola no alcanza para llevarse todo, porque las fotos son enlaces
// de Drive. El ZIP se arma en streaming (sin guardar nada en disco ni tener
// todas las fotos en memoria): se baja una foto, se agrega, se pasa a la
// siguiente. Las fotos se bajan por su enlace público, el mismo que muestra la app.
const archiver = require('archiver');

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HOST_FOTO = 'lh3.googleusercontent.com';
const MAX_FOTO_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_BYTES = 3 * 1024 * 1024 * 1024; // por debajo de los 4 GB que admite un ZIP sin ZIP64
const MAX_FOTOS = 5000;
const MAX_PENDIENTE_BYTES = 512 * 1024; // cuánto puede haber sin que el destino lo haya recibido antes de seguir bajando fotos

/** Nombre apto para un archivo en cualquier sistema: sin separadores ni caracteres reservados, de largo acotado */
function nombreSeguro(texto, max = 60) {
  const limpio = String(texto == null ? '' : texto)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, max)
    .trim();
  return limpio || 'sin nombre';
}

/** Id del archivo de Drive de una foto de la app (https://lh3.googleusercontent.com/d/<id>), o null si es de otro origen */
function idDeFoto(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== HOST_FOTO) return null;
    const m = /^\/d\/([A-Za-z0-9_-]+)\/?$/.exec(u.pathname);
    return m ? m[1] : null;
  } catch { return null; }
}

/** Extensión según los primeros bytes de la imagen (no se confía en lo que diga el servidor) */
function extensionDe(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 8 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 4 && buf.toString('latin1', 0, 3) === 'GIF') return 'gif';
  return 'img';
}

/** Descarga la foto original (sin el sufijo de tamaño) desde su enlace público */
async function descargarOriginal(url, { señal } = {}) {
  const id = idDeFoto(url);
  if (!id) throw new Error('origen no admitido');
  const res = await fetch(`https://${HOST_FOTO}/d/${id}`, { signal: señal ? AbortSignal.any([señal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  if (Number(res.headers.get('content-length')) > MAX_FOTO_BYTES) throw new Error('foto demasiado grande');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FOTO_BYTES) throw new Error('foto demasiado grande');
  return buf;
}

/** Celda de CSV; un valor que parezca fórmula se antecede con ' para que Excel no lo ejecute */
function celdaCsv(valor) {
  let t = String(valor == null ? '' : valor);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const LEEME = [
  'Fotos de tu laboratorio (exportadas de Inventario Laboratorio).',
  '',
  '- fotos/    una imagen por artículo, con el nombre "ID_artículo.ext".',
  '- indice.csv  qué artículo es cada archivo, dónde está guardado y si alguna foto no se pudo bajar.',
  '',
  'Los datos (artículos, cantidades, historial) están en la planilla de Google Sheets;',
  'se descarga aparte como .xlsx desde el mismo panel.',
].join('\r\n') + '\r\n';

/**
 * Arma el ZIP y lo escribe en `salida`. `articulos` es [{ id, articulo, ubicacion, foto }].
 * `descargar(url)` devuelve un Buffer (se inyecta en las pruebas). Una foto que
 * no se puede bajar no frena el resto: queda anotada en indice.csv.
 * Devuelve { fotos, fallidas, bytes }.
 */
async function armarZip({ articulos, salida, descargar = descargarOriginal, señal }) {
  if (articulos.length > MAX_FOTOS) throw Object.assign(new Error(`Hay más de ${MAX_FOTOS} fotos: exportalas en tandas.`), { codigo: 'DEMASIADAS_FOTOS' });

  const zip = archiver('zip', { store: true }); // las fotos ya vienen comprimidas
  zip.pipe(salida);
  const errorZip = new Promise((_, rechazar) => zip.on('error', rechazar));
  errorZip.catch(() => {});
  const agregado = () => new Promise(resolver => zip.once('entry', resolver));
  const cancelado = () => señal && señal.aborted;
  // archiver avisa "entry" cuando acomodó la foto en su memoria, no cuando el destino la recibió:
  // sin esta espera, un navegador lento haría acumular todas las fotos en memoria.
  const esperarDestino = async () => {
    while (zip.readableLength + (salida.writableLength || 0) > MAX_PENDIENTE_BYTES && !cancelado() && !salida.destroyed) {
      await new Promise(r => setTimeout(r, 10));
    }
  };

  const filas = [['ID', 'Artículo', 'Ubicación', 'Archivo', 'Estado']];
  const usados = new Set();
  let fotos = 0, fallidas = 0, bytes = 0;

  const bajar = a => descargar(a.foto, { señal }).then(buf => ({ buf }), error => ({ error }));
  let siguiente = articulos.length ? bajar(articulos[0]) : null;

  try {
    for (let i = 0; i < articulos.length; i++) {
      if (cancelado()) { zip.abort(); return { fotos, fallidas, bytes, cancelado: true }; }
      const a = articulos[i];
      const { buf, error } = await siguiente;
      siguiente = i + 1 < articulos.length ? bajar(articulos[i + 1]) : null; // mientras se agrega esta, ya se baja la siguiente

      if (error || bytes + (buf ? buf.length : 0) > MAX_ZIP_BYTES) {
        fallidas++;
        filas.push([a.id, a.articulo, a.ubicacion, '', error ? `no se pudo bajar (${error.message})` : 'se superó el tamaño máximo del ZIP']);
        continue;
      }
      let nombre = `${nombreSeguro(a.id, 30)}_${nombreSeguro(a.articulo, 50)}`;
      const ext = extensionDe(buf);
      let candidato = `${nombre}.${ext}`;
      for (let n = 2; usados.has(candidato.toLowerCase()); n++) candidato = `${nombre} (${n}).${ext}`;
      usados.add(candidato.toLowerCase());

      const hecho = agregado();
      zip.append(buf, { name: `fotos/${candidato}` });
      await Promise.race([hecho, errorZip]);
      await esperarDestino();
      bytes += buf.length; fotos++;
      filas.push([a.id, a.articulo, a.ubicacion, `fotos/${candidato}`, 'ok']);
    }

    zip.append('﻿' + filas.map(f => f.map(celdaCsv).join(',')).join('\r\n') + '\r\n', { name: 'indice.csv' });
    zip.append(LEEME, { name: 'LEEME.txt' });
    await Promise.race([zip.finalize(), errorZip]);
    return { fotos, fallidas, bytes };
  } catch (err) {
    zip.abort();
    throw err;
  }
}

module.exports = { MIME_XLSX, nombreSeguro, idDeFoto, extensionDe, celdaCsv, descargarOriginal, armarZip, MAX_FOTOS };
