// Registro de las búsquedas por foto, para medir con uso real si el umbral y el
// modelo andan bien. Una línea JSON por evento en BUSQUEDAS_LOG_DIR/busquedas.jsonl.
//
// Privacidad: NO guarda la imagen ni el email ni ningún dato de quién busca.
// Solo: cuándo, laboratorio, los 3 candidatos (id y puntaje) y qué hizo la persona.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACCIONES = ['abrio', 'ninguno'];
const MAX_BYTES = 5 * 1024 * 1024; // al pasar de 5 MB, el archivo se rota (queda uno anterior)
// Cuántas búsquedas con elección hacen falta para que valga la pena verificar el umbral
// (con ~70 % de aciertos, 50 casos dan un margen de ±13 puntos: alcanza para decidir si 0,6 es razonable)
const MINIMO_PARA_VERIFICAR = Number(process.env.AVISO_BUSQUEDAS_MINIMO) || 50;

function crearRegistro({ dir = path.join(__dirname, 'logs-busquedas'), log = console } = {}) {
  const archivo = path.join(dir, 'busquedas.jsonl');
  const marcaAviso = path.join(dir, 'aviso-descartado');

  // Búsquedas distintas en las que la persona hizo una elección (las únicas verificables).
  // Se reconstruye del archivo al arrancar, así el conteo sobrevive a los reinicios.
  const conEleccion = new Set();
  for (const f of [archivo + '.anterior', archivo]) {
    try {
      for (const linea of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!linea) continue;
        try { const e = JSON.parse(linea); if (e.tipo === 'eleccion') conEleccion.add(e.id); } catch (e) { /* línea rota */ }
      }
    } catch (e) { /* no existe todavía */ }
  }

  function escribir(evento) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        if (fs.statSync(archivo).size > MAX_BYTES) fs.renameSync(archivo, archivo + '.anterior');
      } catch (e) { /* todavía no existe */ }
      fs.appendFileSync(archivo, JSON.stringify(evento) + '\n', { mode: 0o600 });
    } catch (err) {
      // el registro nunca debe romper la búsqueda
      log.error('[registro-busquedas]', err.message);
    }
  }

  /** Anota una búsqueda hecha y devuelve su id, para que el cliente informe qué eligió */
  function busqueda(labId, { resultados, coincide, indexados }, ms) {
    const id = crypto.randomBytes(8).toString('hex');
    escribir({
      t: new Date().toISOString(), tipo: 'busqueda', id, lab: String(labId),
      top: resultados.map(r => ({ id: r.id, p: r.puntaje })),
      coincide: !!coincide, indexados, ms,
    });
    return id;
  }

  /** Anota qué hizo la persona después: abrió un candidato (posición 1–3) o "ninguno" */
  function eleccion(labId, { busquedaId, accion, articuloId }) {
    if (!/^[0-9a-f]{16}$/.test(String(busquedaId))) return false;
    if (!ACCIONES.includes(accion)) return false;
    const evento = { t: new Date().toISOString(), tipo: 'eleccion', id: busquedaId, lab: String(labId), accion };
    if (accion === 'abrio') {
      if (!/^[\w.-]{1,30}$/.test(String(articuloId || ''))) return false;
      evento.articulo = articuloId;
    }
    escribir(evento);
    conEleccion.add(busquedaId);
    return true;
  }

  const cantidad = () => conEleccion.size;
  const avisoDescartado = () => fs.existsSync(marcaAviso);
  /** true cuando ya hay casos suficientes y nadie descartó el aviso */
  const listoParaVerificar = () => cantidad() >= MINIMO_PARA_VERIFICAR && !avisoDescartado();
  function descartarAviso() {
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.writeFileSync(marcaAviso, new Date().toISOString(), { mode: 0o600 }); }
    catch (err) { log.error('[registro-busquedas]', err.message); }
  }

  return { busqueda, eleccion, archivo, cantidad, listoParaVerificar, descartarAviso, minimo: MINIMO_PARA_VERIFICAR };
}

module.exports = { crearRegistro };
