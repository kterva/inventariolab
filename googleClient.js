const { google } = require('googleapis');

// Inicializa el cliente de Google Auth con la Cuenta de Servicio
function getAuthClient() {
  let credentials;
  try {
    const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!jsonStr) {
      console.warn('⚠️ No se proporcionó GOOGLE_SERVICE_ACCOUNT_JSON. Operaciones en Google fallarán.');
      return null;
    }
    credentials = JSON.parse(jsonStr);
  } catch (err) {
    console.error('Error al parsear GOOGLE_SERVICE_ACCOUNT_JSON:', err);
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  return auth;
}

// Devuelve las instancias de las APIs configuradas
function getApis() {
  const auth = getAuthClient();
  if (!auth) return { sheets: null, drive: null };
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });
  return { sheets, drive };
}

// ─── LECTURA ──────────────────────────────────────────

/** Lee los parámetros institucionales y del laboratorio de la hoja 'config' */
async function getAppConfig(sheetId) {
  const { sheets } = getApis();
  if (!sheets) throw new Error("Google APIs no inicializadas");
  
  const config = {
    institucion: "Liceo Sauce 2",
    laboratorio: "Laboratorio de Física",
    accesoPublico: "SI"
  };

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'config!A1:E100',
    });
    
    const data = res.data.values || [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 5) { // Las claves en columna D (3), valores en E (4)
        const clave = (row[3] || '').toString().toLowerCase().trim();
        const valor = (row[4] || '').toString().trim();
        if (clave === 'institucion' || clave === 'liceo' || clave === 'institución') {
          if (valor) config.institucion = valor;
        } else if (clave === 'laboratorio' || clave === 'tipo laboratorio') {
          if (valor) config.laboratorio = valor;
        } else if (clave === 'accesopublico' || clave === 'acceso publico') {
          if (valor) config.accesoPublico = valor.toUpperCase();
        }
      }
    }
  } catch (e) {
    console.error(`[getAppConfig] Error al leer config de ${sheetId}:`, e.message);
  }
  return config;
}

/** Verifica si el email está en la columna A de 'config' y retorna el rol de la columna B */
async function verificarPermisos(sheetId, email) {
  if (!email) return { autorizado: false, esAdmin: false };
  
  // Bypass para entorno de desarrollo local sin credenciales reales
  if (process.env.NODE_ENV === 'development' && email === process.env.MOCK_AUTH_EMAIL) {
    return { autorizado: true, esAdmin: true };
  }

  const { sheets } = getApis();
  if (!sheets) throw new Error("Google APIs no inicializadas");

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'config!A2:B100',
    });
    
    const data = res.data.values || [];
    for (let i = 0; i < data.length; i++) {
      const mailFila = (data[i][0] || '').toString().toLowerCase().trim();
      const rolFila = (data[i][1] || '').toString().toUpperCase().trim();
      if (mailFila === email.toLowerCase().trim()) {
        return { autorizado: true, esAdmin: (rolFila === 'ADMIN') };
      }
    }
  } catch (e) {
    console.error(`[verificarPermisos] Error al leer permisos de ${sheetId}:`, e.message);
  }
  return { autorizado: false, esAdmin: false };
}

/** Devuelve las filas de inventario que pertenezcan a una zona específica */
async function getFilasPorZona(sheetId, zona) {
  const { sheets } = getApis();
  if (!sheets) throw new Error("Google APIs no inicializadas");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'INVENTARIO!A3:N',
  });
  
  const data = res.data.values || [];
  return data.map((r, i) => ({
    fila:      i + 3,
    articulo:  (r[0] || '').toString().trim(),
    bien:      r[2] || 0,
    regular:   r[3] || 0,
    roto:      r[4] || 0,
    total:     r[5] || 0,
    obs:       r[6] || '',
    historial: (r[9] || '').toString(),
    foto:      (r[13] || '').toString(),
    zona:      (r[7] || '').toString().trim()
  }))
  .filter(f => f.zona === zona && f.articulo)
  .sort((a, b) => a.articulo.localeCompare(b.articulo, 'es', { sensitivity: 'base', numeric: true }));
}

/** Realiza búsqueda global en el inventario por texto parcial */
async function buscarEnInventario(sheetId, query) {
  const { sheets } = getApis();
  if (!sheets) throw new Error("Google APIs no inicializadas");

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'INVENTARIO!A3:N',
    });
    
    const data = res.data.values || [];
    const q = query.toLowerCase().trim();
    
    return data.map((row, i) => { row._fIndex = i + 3; return row; })
      .filter(row => (row[0] || '').toString().toLowerCase().includes(q))
      .map(row => ({
        articulo: row[0],
        bien: row[2] || 0,
        regular: row[3] || 0,
        roto: row[4] || 0,
        ubicacion: row[7],
        foto: row[13],
        fila: row._fIndex
      }));
  } catch (err) {
    if (err.message.includes("unregistered callers") || err.message.includes("auth")) {
      throw new Error("No se pudo conectar a Google Sheets. Verifica que las credenciales de la cuenta de servicio estén correctamente configuradas en el servidor y que la planilla esté compartida con la cuenta de servicio.");
    }
    if (err.message.includes("Requested entity was not found")) {
      throw new Error("No se encontró la planilla. Verifica que el ID de la planilla sea correcto y esté compartida.");
    }
    throw new Error("Error interno al buscar: " + err.message);
  }
}

/** Devuelve la lista de zonas desde la hoja ubicaciones */
async function obtenerZonasAdmin(sheetId) {
  const { sheets } = getApis();
  if (!sheets) throw new Error("Google APIs no inicializadas");

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'ubicaciones!A2:C',
    });
    return res.data.values || [];
  } catch (e) {
    console.error(`[obtenerZonasAdmin] Error:`, e.message);
    return [];
  }
}

// ─── ESCRITURA (CRUD) ─────────────────────────────────

const COL_ZONA = 8; // H
const COL_REP = 11; // K
const COL_FECHA = 9; // I
const COL_LOG = 10; // J
const COL_FOTO = 14; // N

/** Función de utilidad para formatear la fecha como dd/MM/yy HH:mm en la zona local */
function getFormattedDate() {
  const now = new Date();
  const d = now.getDate().toString().padStart(2, '0');
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const y = now.getFullYear().toString().substr(-2);
  const h = now.getHours().toString().padStart(2, '0');
  const min = now.getMinutes().toString().padStart(2, '0');
  return `${d}/${m}/${y} ${h}:${min}`;
}

/** Sube una foto a Drive y actualiza el Inventario */
async function subirFoto(sheetId, email, fila, base64Str, nombreArchivo) {
  const { sheets, drive } = getApis();
  if (!drive || !sheets) throw new Error("Google APIs no inicializadas");

  // 1. Averiguar en qué carpeta está guardada la planilla
  let parentId = null;
  try {
    const sheetFile = await drive.files.get({
      fileId: sheetId,
      fields: 'parents'
    });
    if (sheetFile.data.parents && sheetFile.data.parents.length > 0) {
      parentId = sheetFile.data.parents[0];
    }
  } catch (err) {
    console.log('No se pudo obtener el parentId de la planilla (puede estar en el root o falta permiso sobre la carpeta).', err.message);
  }

  // 2. Buscar o crear la carpeta LAB_FOTOS dentro de esa misma carpeta
  let folderId;
  let q = "name = 'LAB_FOTOS' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  if (parentId) {
    q += ` and '${parentId}' in parents`;
  }

  const folderQuery = await drive.files.list({
    q,
    fields: 'files(id)',
    spaces: 'drive',
  });
  
  if (folderQuery.data.files && folderQuery.data.files.length > 0) {
    folderId = folderQuery.data.files[0].id;
  } else {
    const requestBody = { name: 'LAB_FOTOS', mimeType: 'application/vnd.google-apps.folder' };
    if (parentId) requestBody.parents = [parentId];

    const folderRes = await drive.files.create({
      requestBody,
      fields: 'id',
    });
    folderId = folderRes.data.id;
  }

  // Decodificar Base64
  const parts = base64Str.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const buffer = Buffer.from(parts[1], 'base64');
  
  const stream = require('stream');
  const bufferStream = new stream.PassThrough();
  bufferStream.end(buffer);

  // Subir Archivo
  const fileName = `img_fila${fila}_${Date.now()}.jpg`;
  const fileRes = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: bufferStream },
    fields: 'id',
  });
  
  const fileId = fileRes.data.id;
  
  // Compartir públicamente
  await drive.permissions.create({
    fileId: fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  const url = `https://lh3.googleusercontent.com/d/${fileId}`;
  
  // Actualizar Sheets
  const fecha = getFormattedDate();
  
  // Leer historial y foto previa para armar el log
  const resActual = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: [`INVENTARIO!N${fila}`, `INVENTARIO!J${fila}`]
  });
  
  const fotoActual = resActual.data.valueRanges[0].values?.[0]?.[0];
  const logActual = resActual.data.valueRanges[1].values?.[0]?.[0] || '';
  
  const entrada = `[${fecha}] (${email}) ${fotoActual ? '🔄 Imagen actualizada' : '📸 Imagen agregada'}`;
  const nuevoLog = logActual ? `${entrada}\n${logActual}` : entrada;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `INVENTARIO!N${fila}`, values: [[url]] },
        { range: `INVENTARIO!J${fila}`, values: [[nuevoLog]] },
        { range: `INVENTARIO!I${fila}`, values: [[fecha]] }
      ]
    }
  });

  return url;
}

/** Registra un reporte de incidencia */
async function registrarReporte(sheetId, email, fila, texto) {
  const { sheets } = getApis();
  if (!sheets) throw new Error("Google APIs no inicializadas");

  const fecha = getFormattedDate();
  
  // Leer log previo
  const logRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `INVENTARIO!J${fila}`
  });
  const prevLog = logRes.data.values?.[0]?.[0] || '';
  const entrada = `[${fecha}] (${email}) ${texto}`;
  const nuevoLog = prevLog ? `${entrada}\n${prevLog}` : entrada;
  const textoTicket = `(${email}) ${texto}`;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `INVENTARIO!J${fila}`, values: [[nuevoLog]] },
        { range: `INVENTARIO!I${fila}`, values: [[fecha]] },
        { range: `INVENTARIO!K${fila}`, values: [[textoTicket]] } // ticket para el panel
      ]
    }
  });
  
  return true;
}

/** Cambia la zona de un artículo */
async function cambiarUbicacion(sheetId, email, fila, nuevaZona) {
  const { sheets } = getApis();
  if (!sheets) throw new Error("Google APIs no inicializadas");

  const zonaNuevaStr = nuevaZona.trim();
  const fecha = getFormattedDate();

  // Leer zona y log actual
  const currentRes = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: [`INVENTARIO!H${fila}`, `INVENTARIO!J${fila}`]
  });
  
  const zonaActual = currentRes.data.valueRanges[0].values?.[0]?.[0] || '';
  const prevLog = currentRes.data.valueRanges[1].values?.[0]?.[0] || '';
  
  const entrada = `[${fecha}] (${email}) 🚚 Movido de '${zonaActual}' a '${zonaNuevaStr}'`;
  const nuevoLog = prevLog ? `${entrada}\n${prevLog}` : entrada;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `INVENTARIO!H${fila}`, values: [[zonaNuevaStr]] },
        { range: `INVENTARIO!J${fila}`, values: [[nuevoLog]] },
        { range: `INVENTARIO!I${fila}`, values: [[fecha]] }
      ]
    }
  });

  return true;
}

/** Crea o edita una zona, si el nombre cambia, actualiza todos los artículos */
async function guardarZona(sheetId, id, nombre, desc) {
  const { sheets } = getApis();
  if (!sheets) throw new Error("Google APIs no inicializadas");

  const idBuscado = (id || '').toString().trim();
  const nombreLimpio = nombre.trim();
  const nombreLower = nombreLimpio.toLowerCase();

  const resZonas = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'ubicaciones!A:C' });
  const data = resZonas.data.values || [];
  
  // Validar duplicados
  for (let i = 1; i < data.length; i++) {
    const idActual = (data[i][0] || '').toString().trim();
    const nombreActual = (data[i][1] || '').toString().trim().toLowerCase();
    if (nombreActual === nombreLower && idActual !== idBuscado) {
      return { success: false, msg: `Error: Ya existe una zona llamada "${data[i][1]}".` };
    }
  }

  if (idBuscado) {
    // EDICIÓN
    for (let i = 1; i < data.length; i++) {
      if ((data[i][0] || '').toString().trim() === idBuscado) {
        const nombreViejo = (data[i][1] || '').toString().trim();
        
        if (nombreViejo !== nombreLimpio) {
          // Propagar el cambio en Inventario
          const invRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'INVENTARIO!H3:H' });
          const invData = invRes.data.values || [];
          const updateData = [];
          for (let j = 0; j < invData.length; j++) {
            if ((invData[j][0] || '').toString().trim() === nombreViejo) {
              updateData.push({ range: `INVENTARIO!H${j + 3}`, values: [[nombreLimpio]] });
            }
          }
          if (updateData.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: sheetId,
              requestBody: { valueInputOption: 'USER_ENTERED', data: updateData }
            });
          }
        }
        
        // Actualizar fila maestra
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `ubicaciones!B${i + 1}:C${i + 1}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[nombreLimpio, desc || '']] }
        });
        return { success: true, msg: 'Zona actualizada y nombres propagados.' };
      }
    }
  } else {
    // NUEVA ZONA
    let maxNum = 0;
    for (let i = 1; i < data.length; i++) {
      const currentId = (data[i][0] || '').toString();
      if (currentId.startsWith("Z")) {
        const num = parseInt(currentId.replace(/\D/g, ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
    const nextId = "Z" + ("0" + (maxNum + 1)).slice(-2);
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'ubicaciones!A:C',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[nextId, nombreLimpio, desc || '']] }
    });
    return { success: true, msg: 'Nueva zona creada: ' + nextId };
  }
}

/** Eliminar una zona si no hay artículos */
async function eliminarZona(sheetId, id, nombre) {
  const { sheets } = getApis();
  if (!sheets) throw new Error("Google APIs no inicializadas");

  const invRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'INVENTARIO!H3:H' });
  const invData = invRes.data.values || [];
  const nombreLimpio = nombre.trim().toLowerCase();
  
  let cuenta = 0;
  for (let row of invData) {
    if ((row[0] || '').toString().trim().toLowerCase() === nombreLimpio) cuenta++;
  }
  
  if (cuenta > 0) {
    return { success: false, msg: `No se puede eliminar: hay ${cuenta} artículos en '${nombre}'. Muévelos primero.` };
  }

  const ubiRes = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'ubicaciones!A:C' });
  const ubiData = ubiRes.data.values || [];
  const idNumerico = id.toString().replace(/\D/g, '');

  for (let i = 1; i < ubiData.length; i++) {
    const idHoja = (ubiData[i][0] || '').toString().replace(/\D/g, '');
    if (idHoja === idNumerico && idNumerico !== "") {
      // Necesitamos eliminar la fila. Usamos batchUpdate con un request de DeleteDimension
      const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
      const ubiSheetInfo = sheetMetadata.data.sheets.find(s => s.properties.title === 'ubicaciones');
      
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: ubiSheetInfo.properties.sheetId,
                dimension: 'ROWS',
                startIndex: i,
                endIndex: i + 1
              }
            }
          }]
        }
      });
      return { success: true, msg: `Zona '${nombre}' eliminada.` };
    }
  }
  
  return { success: false, msg: `No se encontró la zona con ID ${id}` };
}

/** Generador de QRs: Escribe en la pestaña IMPRIMIR_QR usando IMAGE() */
async function ejecutarGeneracionQR(sheetId, baseUrl, listaIds = []) {
  const { sheets } = getApis();
  if (!sheets) throw new Error("Google APIs no inicializadas");

  // 1. Obtener ubicaciones y filtrar
  const resUbi = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'ubicaciones!A2:B' });
  let dataMaestra = resUbi.data.values || [];
  
  if (listaIds && listaIds.length > 0) {
    dataMaestra = dataMaestra.filter(row => listaIds.includes((row[0] || '').toString().trim()));
  }
  if (dataMaestra.length === 0) return "No hay zonas para generar QR.";

  // 2. Obtener SheetID de IMPRIMIR_QR o crearla
  let spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  let qrSheet = spreadsheet.data.sheets.find(s => s.properties.title === 'IMPRIMIR_QR');
  
  let qrSheetId;
  if (!qrSheet) {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: 'IMPRIMIR_QR' } } }] }
    });
    qrSheetId = addRes.data.replies[0].addSheet.properties.sheetId;
  } else {
    qrSheetId = qrSheet.properties.sheetId;
    // Limpiar cuadrícula
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: 'IMPRIMIR_QR' });
  }

  const COLS = 2;
  const colores = ["#1a5276", "#117864", "#7d6608", "#6c3483", "#922b21"];
  
  // Preparamos los requests de batchUpdate para aplicar estilos y valores al mismo tiempo
  const requests = [];
  let currentRow = 0; // 0-indexed para la API
  
  // Limpiar estilos existentes (UpdateCells con fields='*') para tener canvas en blanco
  requests.push({
    updateCells: {
      range: { sheetId: qrSheetId },
      fields: '*'
    }
  });

  for (let i = 0; i < dataMaestra.length; i++) {
    const idZona = dataMaestra[i][0];
    const nombreZona = dataMaestra[i][1];
    if (!nombreZona) continue;
    
    const colIndex = i % COLS; // 0 o 1
    if (i % COLS === 0 && i !== 0) currentRow += 3;
    
    const codigo = "Z" + String(idZona).replace(/\D/g, '').padStart(2, "0");
    const colorHex = colores[i % colores.length];
    
    // Parse color to google RGB
    const hexToRgb = hex => ({
      red: parseInt(hex.slice(1,3), 16)/255,
      green: parseInt(hex.slice(3,5), 16)/255,
      blue: parseInt(hex.slice(5,7), 16)/255
    });
    const bgColor = hexToRgb(colorHex);

    // Endpoint VPS
    const linkUrl = `${baseUrl}/lab/${sheetId}?zona=${encodeURIComponent(nombreZona)}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(linkUrl)}`;

    // Filas: 0=Header, 1=Image, 2=Text
    const rStart = currentRow;
    const rEnd = currentRow + 3;
    const cStart = colIndex;
    const cEnd = colIndex + 1;
    
    requests.push({
      updateCells: {
        range: { sheetId: qrSheetId, startRowIndex: rStart, endRowIndex: rStart + 1, startColumnIndex: cStart, endColumnIndex: cEnd },
        rows: [{
          values: [{
            userEnteredValue: { stringValue: codigo },
            userEnteredFormat: {
              backgroundColor: bgColor,
              textFormat: { foregroundColor: {red:1, green:1, blue:1}, bold: true },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              borders: { top: {style: 'SOLID'}, bottom: {style: 'SOLID'}, left: {style: 'SOLID'}, right: {style: 'SOLID'} }
            }
          }]
        }],
        fields: 'userEnteredValue,userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,borders)'
      }
    });

    requests.push({
      updateCells: {
        range: { sheetId: qrSheetId, startRowIndex: rStart + 1, endRowIndex: rStart + 2, startColumnIndex: cStart, endColumnIndex: cEnd },
        rows: [{
          values: [{
            userEnteredValue: { formulaValue: `=IMAGE("${qrUrl}", 4, 120, 120)` },
            userEnteredFormat: {
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              borders: { left: {style: 'SOLID'}, right: {style: 'SOLID'} }
            }
          }]
        }],
        fields: 'userEnteredValue,userEnteredFormat(horizontalAlignment,verticalAlignment,borders)'
      }
    });

    requests.push({
      updateCells: {
        range: { sheetId: qrSheetId, startRowIndex: rStart + 2, endRowIndex: rStart + 3, startColumnIndex: cStart, endColumnIndex: cEnd },
        rows: [{
          values: [{
            userEnteredValue: { stringValue: nombreZona },
            userEnteredFormat: {
              textFormat: { bold: true, fontSize: 12 },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
              borders: { bottom: {style: 'SOLID'}, left: {style: 'SOLID'}, right: {style: 'SOLID'} }
            }
          }]
        }],
        fields: 'userEnteredValue,userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,borders)'
      }
    });
  }

  // Set column widths
  for (let c = 0; c < COLS; c++) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: qrSheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 },
        properties: { pixelSize: 300 },
        fields: 'pixelSize'
      }
    });
  }
  
  // Set row heights
  for (let r = 0; r <= currentRow; r += 3) {
    requests.push({ updateDimensionProperties: { range: { sheetId: qrSheetId, dimension: 'ROWS', startIndex: r, endIndex: r + 1 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } });
    requests.push({ updateDimensionProperties: { range: { sheetId: qrSheetId, dimension: 'ROWS', startIndex: r + 1, endIndex: r + 2 }, properties: { pixelSize: 130 }, fields: 'pixelSize' } });
    requests.push({ updateDimensionProperties: { range: { sheetId: qrSheetId, dimension: 'ROWS', startIndex: r + 2, endIndex: r + 3 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests }
  });

  return `Proceso completado. Se generaron ${dataMaestra.length} etiquetas en IMPRIMIR_QR.`;
}

module.exports = {
  getAppConfig,
  verificarPermisos,
  getFilasPorZona,
  buscarEnInventario,
  obtenerZonasAdmin,
  subirFoto,
  registrarReporte,
  cambiarUbicacion,
  guardarZona,
  eliminarZona,
  ejecutarGeneracionQR
};
