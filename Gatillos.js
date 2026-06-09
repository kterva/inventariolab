function onEdit(e) {
  const sheet = e.range.getSheet();
  const nombreHoja = sheet.getName();

  // Caso A: Se editó el INVENTARIO (Registrar historial)
  if (nombreHoja === "INVENTARIO") {
    manejarHistorialInventario(e, sheet);
  }

  // Caso B: Se editó el Panel (Ejecutar IR o RESOLVER)
  if (nombreHoja === "INCIDENCIAS_ACTIVAS") {
    if (typeof procesarAccionesPanel === 'function') {
      procesarAccionesPanel(e, sheet);
    }
  }
}

/**
 * Lógica que ya tenías para el Historial
 */
function manejarHistorialInventario(e, sheet) {
  const range = e.range;
  const col = range.getColumn();
  const fila = range.getRow();
  
  if (fila < 3) return; // Saltamos encabezados

  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0]
                  .map(h => h.toString().toLowerCase().trim());
  
  const colHistorial = headers.indexOf("historial") + 1;
  const colUbicacion = headers.indexOf("ubicación dentro del laboratorio") + 1;
  const colObs = headers.indexOf("observaciones") + 1;
  const colBien = headers.indexOf("bien") + 1;
  const colRegular = headers.indexOf("regular") + 1;
  const colRoto = headers.indexOf("roto") + 1;

  if (colHistorial === 0) return;

  const fecha = Utilities.formatDate(new Date(), "America/Montevideo", "dd/MM/yyyy HH:mm"); // Riesgo #4 fix: zona unificada
  const usuario = Session.getActiveUser().getEmail().split("@")[0];
  let mensaje = "";

  const valorNuevo = e.value || "0";
  const valorViejo = e.oldValue || "0";

  if (col === colBien || col === colRegular || col === colRoto) {
    let estado = headers[col-1].toUpperCase();
    mensaje = `[${fecha} - ESTADO]: ${estado} cambió de ${valorViejo} a ${valorNuevo} (${usuario})`;
  } 
  else if (col === colUbicacion) {
    mensaje = `[${fecha} - TRASLADO]: ${valorViejo} → ${valorNuevo} (${usuario})`;
  } 
  else if (col === colObs && e.value) {
    mensaje = `[${fecha} - NOTA]: ${e.value} (${usuario})`;
  }

  if (mensaje) {
    const celdaHist = sheet.getRange(fila, colHistorial);
    const anterior = celdaHist.getValue();
    celdaHist.setValue((anterior ? anterior + "\n" : "") + mensaje);
  }
}