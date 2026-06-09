/**
 * Esta función es llamada desde el onEdit principal en Gatillos.gs
 */
function procesarAccionesPanel(e, sheet) {
  const row = e.range.getRow();
  const col = e.range.getColumn();
  const val = e.value;

  if (row <= 2 || !val) return;

  // Mapeo dinámico: busca dónde está exactamente la columna "Acciones"
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colAcciones = headers.findIndex(h => h.toString().toLowerCase().trim() === "acciones") + 1;

  // Si la celda editada no es la de Acciones, abortar
  if (col !== colAcciones) return;

  const filaOriginal = sheet.getRange(row, 1).getValue();
  const accion = val.toString().toUpperCase().trim();

  if (accion === "IR") {
    irAFila(filaOriginal);
    e.range.clearContent();
  } 
  else if (accion === "RESOLVER") {
    resolverDesdePanel(filaOriginal);
    generarPanelIncidencias(); // Recarga el panel
  }
}

function generarPanelIncidencias() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const origen = ss.getSheetByName("INVENTARIO");
  if (!origen) return;

  let panel = ss.getSheetByName("INCIDENCIAS_ACTIVAS") || ss.insertSheet("INCIDENCIAS_ACTIVAS");
  
  // Limpieza termonuclear: Borra TODA la cuadrícula, eliminando menús fantasma
  panel.getRange(1, 1, panel.getMaxRows(), panel.getMaxColumns()).clearDataValidations();
  panel.clear();
  if (panel.getFilter()) panel.getFilter().remove();

  // Establecer estructura limpia
  const headersPanel = ["Fila", "Zona", "Artículo", "Estado", "Prioridad", "Último reporte", "Fecha", "Acciones"];
  panel.getRange(2, 1, 1, headersPanel.length).setValues([headersPanel])
       .setBackground("#1a5276").setFontColor("white").setFontWeight("bold");

  const lastRow = origen.getLastRow();
  if (lastRow < 3) return;

  // Mapeo dinámico de INVENTARIO
  const headersInv = origen.getRange(2, 1, 1, origen.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
  const findCol = (name) => headersInv.findIndex(h => h.includes(name));
  
  const colRegular = findCol("regular");
  const colRoto    = findCol("roto");
  const colZona    = findCol("ubicación");
  const colFecha   = findCol("modificación");
  const colReporte = headersInv.findIndex(h => h.includes("reporte") || h.includes("incidencia"));

  const data = origen.getRange(3, 1, lastRow - 2, origen.getLastColumn()).getValues();
  let salida = [];

  data.forEach((row, i) => {
    const articulo = row[0]; // La columna A siempre es el Artículo
    const regular  = colRegular > -1 ? Number(row[colRegular]) || 0 : 0;
    const roto     = colRoto > -1 ? Number(row[colRoto]) || 0 : 0;
    const zona     = colZona > -1 ? (row[colZona] || "").toString().trim() : "";
    const fecha    = colFecha > -1 ? row[colFecha] : "";
    const reporte  = colReporte > -1 ? (row[colReporte] || "").toString().trim() : "";

    if (!articulo) return;

    let estado = "🟢 Bien", prioridad = 3;
    if (roto > 0) { estado = "🔴 Roto"; prioridad = 1; }
    else if (reporte.length > 0) { estado = "🟡 Reporte"; prioridad = 2; }
    else if (regular > 0) { estado = "🟡 Regular"; prioridad = 2; }

    if (roto > 0 || reporte.length > 0) {
      salida.push([
        i + 3, 
        zona, 
        articulo, 
        estado, 
        prioridad, 
        reporte.split("\n")[0], 
        fecha ? fecha.toString() : "", 
        "" 
      ]);
    }
  });

  // Volcado de datos y blindaje de las acciones
  if (salida.length > 0) {
    salida.sort((a, b) => a[4] - b[4]); // Ordenar por prioridad
    
    panel.getRange(3, 1, salida.length, headersPanel.length).setValues(salida);
    
    const regla = SpreadsheetApp.newDataValidation()
      .requireValueInList(["IR", "RESOLVER"])
      .setAllowInvalid(false) 
      .build();
      
    panel.getRange(3, headersPanel.length, salida.length, 1).setDataValidation(regla);
  }
}

function irAFila(fila) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("INVENTARIO");
  sheet.activate();
  sheet.setActiveRange(sheet.getRange(fila, 1));
}

function resolverDesdePanel(fila) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("INVENTARIO");

  // Mapeo dinámico también para la resolución
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().toLowerCase().trim());
  const colRep = headers.findIndex(h => h.includes("reporte") || h.includes("incidencia")) + 1;
  const colLog = headers.findIndex(h => h.includes("historial")) + 1;
  const colFecha = headers.findIndex(h => h.includes("modificación")) + 1;

  if (!colRep || !colLog) return; 

  const celdaRep = sheet.getRange(fila, colRep); 
  const celdaLog = sheet.getRange(fila, colLog); 
  const celdaFecha = colFecha ? sheet.getRange(fila, colFecha) : null; 

  const contenido = celdaRep.getValue();
  if (!contenido) return;

  const fecha = Utilities.formatDate(new Date(), "GMT-03:00", "dd/MM/yy HH:mm");
  const entrada = `[${fecha}] ✅ RESUELTO\n${contenido}`;

  celdaLog.setValue((celdaLog.getValue() ? entrada + "\n" + celdaLog.getValue() : entrada));
  celdaRep.clearContent();
  if (celdaFecha) celdaFecha.setValue(fecha);
}

/**
 * Envía una notificación por email a todos los administradores cuando se registra un reporte.
 * Es llamada desde registrarReporte() en WebApp.js.
 * @param {number} fila    - Número de fila en INVENTARIO
 * @param {string} texto   - Descripción del problema reportado
 * @param {string} emailDocente - Email del docente que reporta
 */
function notificarNuevoReporteAdmin(fila, texto, emailDocente) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = getAppConfig();

  // 1. Obtener destinatarios desde la hoja config (solo rol ADMIN)
  const hojaConfig = ss.getSheetByName("config");
  if (!hojaConfig) return;

  const configData = hojaConfig.getDataRange().getValues();
  const admins = [];
  for (let i = 1; i < configData.length; i++) {
    const mail = configData[i][0].toString().trim();
    const rol  = configData[i][1].toString().toUpperCase().trim();
    if (mail && rol === "ADMIN") admins.push(mail);
  }
  if (admins.length === 0) return;

  // 2. Obtener datos del artículo afectado para enriquecer el email
  const hojaInv = ss.getSheetByName("INVENTARIO");
  let nombreArticulo = "Desconocido", zona = "Sin zona";
  if (hojaInv && fila >= 3) {
    const rowData = hojaInv.getRange(fila, 1, 1, 8).getValues()[0];
    nombreArticulo = rowData[0] ? rowData[0].toString() : "Desconocido";
    zona           = rowData[7] ? rowData[7].toString() : "Sin zona";
  }

  const fecha = Utilities.formatDate(new Date(), "America/Montevideo", "dd/MM/yyyy HH:mm");

  // 3. Componer y enviar el email HTML
  const asunto = `⚠️ Nuevo reporte de incidencia — ${nombreArticulo}`;
  const cuerpo = `
    <div style="font-family:sans-serif; max-width:500px; margin:auto; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden;">
      <div style="background:#1a5276; color:white; padding:16px 20px;">
        <h2 style="margin:0; font-size:1.1rem;">⚠️ Nueva Incidencia Reportada</h2>
        <p style="margin:4px 0 0; font-size:0.85rem; opacity:0.8;">${config.laboratorio} - ${config.institucion}</p>
      </div>
      <div style="padding:20px;">
        <table style="width:100%; border-collapse:collapse; font-size:0.95rem;">
          <tr><td style="padding:6px 0; color:#555; width:130px;">📦 Artículo</td><td><strong>${nombreArticulo}</strong></td></tr>
          <tr><td style="padding:6px 0; color:#555;">📍 Zona</td><td>${zona}</td></tr>
          <tr><td style="padding:6px 0; color:#555;">👤 Docente</td><td>${emailDocente}</td></tr>
          <tr><td style="padding:6px 0; color:#555;">🕒 Fecha</td><td>${fecha}</td></tr>
        </table>
        <div style="background:#fff3cd; border:1px solid #ffc107; border-radius:6px; padding:12px; margin-top:16px;">
          <strong style="color:#856404;">Descripción del problema:</strong>
          <p style="margin:6px 0 0; color:#333;">${texto}</p>
        </div>
        <p style="margin-top:16px; font-size:0.8rem; color:#888;">Este reporte fue registrado automáticamente. Revisá el Panel de Incidencias para gestionarlo.</p>
      </div>
    </div>`;

  admins.forEach(adminEmail => {
    try {
      MailApp.sendEmail({ to: adminEmail, subject: asunto, htmlBody: cuerpo });
    } catch (err) {
      console.error("Error al enviar email a " + adminEmail + ": " + err.message);
    }
  });
}