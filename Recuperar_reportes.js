function recuperarReportesPerdidos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName("INVENTARIO");
  
  if (!hoja) return;

  const ultimaFila = hoja.getLastRow();
  if (ultimaFila < 3) return;

  // Leer datos desde la fila 3 hasta la columna K (11)
  const rangoDatos = hoja.getRange(3, 1, ultimaFila - 2, 11);
  const datos = rangoDatos.getValues();
  let actualizados = 0;

  // Palabras clave que identifican eventos automáticos del sistema (que NO son reportes)
  const exclusiones = [
    "- ESTADO]:", 
    "- TRASLADO]:", 
    "- NOTA]:", 
    "✅ RESUELTO", 
    "Imagen actualizada", 
    "Imagen agregada", 
    "Movido de"
  ];

  datos.forEach((fila, i) => {
    const historial = fila[9] ? fila[9].toString().trim() : ""; // Columna J (índice 9)
    const reporteActual = fila[10] ? fila[10].toString().trim() : ""; // Columna K (índice 10)

    // Solo procesar si la celda de reporte está vacía y hay un historial
    if (reporteActual === "" && historial !== "") {
      const lineasLog = historial.split("\n");
      const ultimoRegistro = lineasLog[0].trim();

      // Verificar si el último registro contiene alguna de las cadenas de exclusión
      const esAutomatico = exclusiones.some(ex => ultimoRegistro.includes(ex));

      // Si no es un evento automático y cumple con la estructura base "[fecha]...", es un reporte huérfano
      if (!esAutomatico && ultimoRegistro.startsWith("[")) {
        hoja.getRange(i + 3, 11).setValue(ultimoRegistro);
        actualizados++;
      }
    }
  });

  SpreadsheetApp.getUi().alert(`Recuperación finalizada. Se restauraron ${actualizados} reportes.`);
}

function corregirZonasHuerfanas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaInv = ss.getSheetByName("INVENTARIO");
  const hojaUbi = ss.getSheetByName("ubicaciones");
  
  // 1. Obtener los nombres actuales de la maestra
  const zonasValidas = hojaUbi.getRange(2, 2, hojaUbi.getLastRow() - 1, 1)
                       .getValues().map(r => r[0].toString().trim()).filter(String);
  
  // 2. Obtener todas las ubicaciones usadas en el Inventario (Columna H)
  const rangoInv = hojaInv.getRange(3, 8, hojaInv.getLastRow() - 2, 1);
  const dataInv = rangoInv.getValues();
  
  // 3. Identificar cuál no coincide
  let nombreViejo = "";
  for (let i = 0; i < dataInv.length; i++) {
    let ubi = dataInv[i][0].toString().trim();
    if (ubi && !zonasValidas.includes(ubi)) {
      nombreViejo = ubi;
      break; 
    }
  }

  if (!nombreViejo) {
    return SpreadsheetApp.getUi().alert("No se encontraron zonas desincronizadas.");
  }

  // 4. Preguntar por el nuevo nombre
  const respuesta = SpreadsheetApp.getUi().prompt(
    "Zona Detectada", 
    `Se encontró la zona antigua '${nombreViejo}' en el inventario.\n¿A qué nombre actual debo cambiarla?`, 
    SpreadsheetApp.getUi().ButtonSet.OK_CANCEL
  );

  if (respuesta.getSelectedButton() == SpreadsheetApp.getUi().Button.OK) {
    const nombreNuevo = respuesta.getResponseText().trim();
    
    if (!zonasValidas.includes(nombreNuevo)) {
      return SpreadsheetApp.getUi().alert(
        `Error: '${nombreNuevo}' no es válido.\n\nDebe coincidir exactamente con uno de estos nombres:\n- ` + zonasValidas.join("\n- ")
      );
    }

    let contador = 0;
    
    // 5. Escritura quirúrgica: solo tocamos las celdas afectadas
    for (let i = 0; i < dataInv.length; i++) {
      if (dataInv[i][0].toString().trim() === nombreViejo) {
        hojaInv.getRange(i + 3, 8).setValue(nombreNuevo);
        contador++;
      }
    }

    SpreadsheetApp.getUi().alert(`Se actualizaron ${contador} artículos de '${nombreViejo}' a '${nombreNuevo}'.`);
  }
}