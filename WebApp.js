// ─── CONFIG ──────────────────────────────────────────
const APP_VERSION = "2.8.0"; // SemVer: MINOR bump — configuración dinámica e institucional
// El ID queda comentado como referencia. Las funciones usan getSS() (Bound Script).
// const SHEET_ID = "1kp3Rs5WfrePoIkoOCBsEEDX6m1a4b-I110xSs6dI190";
const SHEET_NAME = "INVENTARIO";

/** Retorna la Spreadsheet activa. Más eficiente que openById() en un Bound Script. */
function getSS() { return SpreadsheetApp.getActiveSpreadsheet(); }

/** Lee o inicializa los parámetros institucionales y del tipo de laboratorio de la hoja 'config' */
function getAppConfig() {
  const ss = getSS();
  let hojaConfig = ss.getSheetByName("config");
  const config = {
    institucion: "Liceo Sauce 2",
    laboratorio: "Laboratorio de Física"
  };
  
  if (!hojaConfig) {
    try {
      hojaConfig = ss.insertSheet("config");
      hojaConfig.appendRow(["Email", "Rol"]);
      const ownerEmail = ss.getOwner().getEmail();
      if (ownerEmail) {
        hojaConfig.appendRow([ownerEmail, "ADMIN"]);
      }
    } catch(e) {
      // Ignorar errores si no se puede crear
    }
  }
  
  if (hojaConfig) {
    const maxFilas = hojaConfig.getLastRow();
    let inicializado = false;
    let rango = [];
    if (maxFilas >= 1) {
      rango = hojaConfig.getRange(1, 4, Math.max(maxFilas, 4), 2).getValues();
      for (let i = 0; i < rango.length; i++) {
        const clave = rango[i][0] ? rango[i][0].toString().toLowerCase().trim() : "";
        const valor = rango[i][1] ? rango[i][1].toString().trim() : "";
        if (clave === "institucion" || clave === "liceo" || clave === "institución") {
          if (valor) {
            config.institucion = valor;
            inicializado = true;
          }
        } else if (clave === "laboratorio" || clave === "tipo laboratorio") {
          if (valor) {
            config.laboratorio = valor;
            inicializado = true;
          }
        }
      }
    }
    
    // Si no encontramos los parámetros, los escribimos para que el usuario los modifique
    if (!inicializado) {
      try {
        hojaConfig.getRange("D1:E3").setValues([
          ["Parámetro", "Valor"],
          ["Institucion", config.institucion],
          ["Laboratorio", config.laboratorio]
        ]);
        hojaConfig.getRange("D1:E1").setFontWeight("bold").setBackground("#e6f4ea");
      } catch(e) {
        // Ignorar si hay algún error
      }
    }
  }
  return config;
}

const COL_ZONA   = 8;   // H
const COL_REP    = 11;  // K
const COL_FECHA  = 9;   // I
const COL_LOG    = 10;  // J

// ─── ACCESO ───────────────────────────────────────────
function verificarPermisos(email) {
  if (!email) return { autorizado: false, esAdmin: false };
  const ss = getSS();
  const ownerEmail = ss.getOwner().getEmail().toLowerCase().trim();
  const hojaConfig = ss.getSheetByName("config");
  
  if (email === ownerEmail) return { autorizado: true, esAdmin: true };

  if (hojaConfig) {
    const datos = hojaConfig.getDataRange().getValues();
    for (let i = 1; i < datos.length; i++) {
      if (!datos[i][0]) continue;
      let mailFila = datos[i][0].toString().toLowerCase().trim();
      if (!mailFila) continue;
      let rolFila = datos[i][1] ? datos[i][1].toString().toUpperCase().trim() : "";
      if (mailFila === email) {
        return { autorizado: true, esAdmin: (rolFila === "ADMIN") };
      }
    }
  }
  return { autorizado: false, esAdmin: false };
}

/** Genera la vista HTML premium de acceso denegado con mensaje amigable */
function buildAccessDeniedHtml(email) {
  const config = getAppConfig();
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      background: #f2f4f7;
      color: #1a1a1a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
      box-sizing: border-box;
    }
    .card {
      background: #fff;
      padding: 2.5rem 2rem;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      max-width: 400px;
      width: 100%;
      text-align: center;
      border-top: 5px solid #d35400;
    }
    .icon {
      font-size: 3.5rem;
      margin-bottom: 1rem;
      display: block;
    }
    h2 {
      font-size: 1.3rem;
      font-weight: 600;
      color: #1a5276;
      margin: 0 0 1rem 0;
    }
    p {
      color: #4a5568;
      font-size: 0.95rem;
      line-height: 1.5;
      margin: 0 0 1.5rem 0;
    }
    .footer-info {
      font-size: 0.8rem;
      color: #718096;
      border-top: 1px solid #e2e8f0;
      padding-top: 1rem;
      margin-top: 1.5rem;
      word-break: break-all;
    }
    .badge {
      background: #edf2f7;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: monospace;
      color: #4a5568;
    }
  </style>
</head>
<body>
  <div class="card">
    <span class="icon">🔒</span>
    <h2>Acceso no autorizado</h2>
    <p>No autorizado. Pide acceso a la aplicación para ver el contenido del armario, estantería o cajón.</p>
    <div class="footer-info">
      ${email ? `Sesión activa: <span class="badge">${email}</span><br><br>Pide al administrador que registre esta dirección en la hoja de configuración.` : 'Asegúrate de haber iniciado sesión con tu cuenta de Google.'}
    </div>
  </div>
</body>
</html>`;
}

// ─── WEB APP: GET ─────────────────────────────────────
function doGet(e) {
  var email = Session.getActiveUser().getEmail().toLowerCase().trim();
  var permisos = verificarPermisos(email);
  var zona = (e.parameter.zona || "").trim();

  // CASO 1: Acceso a un armario por QR -> Visualización Libre
  if (zona) {
    var filas = getFilasPorZona(zona);
    var html = buildHtml(zona, filas, permisos, email);
    
    return HtmlService.createHtmlOutput(html)
      .setTitle("Inventario — " + zona)
      .addMetaTag("viewport", "width=device-width, initial-scale=1")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // CASO 2: Acceso a la URL principal -> Requiere estar registrado
  if (!email || !permisos.autorizado) {
    return HtmlService.createHtmlOutput(buildAccessDeniedHtml(email))
      .setTitle("Acceso denegado")
      .addMetaTag("viewport", "width=device-width, initial-scale=1")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Si está registrado, evaluamos el rol para Index.html
  var template = HtmlService.createTemplateFromFile('Index');
  template.config = getAppConfig();
  template.esAdmin = permisos.esAdmin; // Pasamos el rol a la plantilla
  
  return template.evaluate()
    .setTitle(permisos.esAdmin ? 'Laboratorio - Dashboard' : 'Laboratorio - Buscador')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── FUNCIONES DE BACKEND (CRUD) ──────────────────────
function subirFoto(fila, base64, nombreArchivo) {
  var email = Session.getActiveUser().getEmail().toLowerCase().trim();
  var permisos = verificarPermisos(email);
  if (!permisos.esAdmin) throw new Error("Solo admins pueden subir fotos");

  const FOLDER = "LAB_FOTOS";
  const ss    = getSS();
  const sheet = ss.getSheetByName(SHEET_NAME);

  let folder;
  const it = DriveApp.getFoldersByName(FOLDER);
  folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);

  const parts = base64.split(",");
  const data  = parts[1];
  const bytes = Utilities.base64Decode(data);
  const blob  = Utilities.newBlob(bytes, "image/jpeg", "img_fila" + fila + "_" + Date.now() + ".jpg");
  const file = folder.createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = "https://lh3.googleusercontent.com/d/" + file.getId();

  var ahora  = new Date();
  var fecha  = Utilities.formatDate(ahora, "GMT-03:00", "dd/MM/yy HH:mm");
  var urlActual = sheet.getRange(fila, 14).getValue();
  var entrada = "[" + fecha + "] (" + email + ") " + (urlActual ? "🔄 Imagen actualizada" : "📸 Imagen agregada");

  sheet.getRange(fila, 14).setValue(url);
  var celdaLog   = sheet.getRange(fila, COL_LOG);
  var celdaFecha = sheet.getRange(fila, COL_FECHA);
  var prevLog    = celdaLog.getValue();

  celdaLog.setValue(prevLog ? entrada + "\n" + prevLog : entrada);
  celdaFecha.setValue(fecha);
  return url;
}

function registrarReporte(fila, texto) {
  if (!fila || fila < 3)          throw new Error("Fila inválida");
  if (!texto || texto.length < 5) throw new Error("Reporte demasiado corto");

  var email = Session.getActiveUser().getEmail().toLowerCase().trim();
  var permisos = verificarPermisos(email);
  if (!permisos.autorizado && !permisos.esAdmin) throw new Error("No autorizado");

  var ss    = getSS();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var ahora  = new Date();
  var fecha  = Utilities.formatDate(ahora, "GMT-03:00", "dd/MM/yy HH:mm");
  
  var entrada = "[" + fecha + "] (" + email + ") " + texto;
  var celdaLog = sheet.getRange(fila, COL_LOG);
  var prevLog  = celdaLog.getValue();
  
  // 1. Registramos en el historial (columna J) el inicio del reporte
  celdaLog.setValue(prevLog ? entrada + "\n" + prevLog : entrada);
  
  // 2. Actualizamos la fecha de modificación (columna I)
  sheet.getRange(fila, COL_FECHA).setValue(fecha);
  
  // 3. CORRECCIÓN: Inyectamos el texto en COL_REP (columna K) en lugar de limpiarla.
  // Esto "abre el ticket" para que el Panel de Incidencias lo capture.
  sheet.getRange(fila, COL_REP).setValue("(" + email + ") " + texto);

  // 4. Notificar a admins por email
  if (typeof notificarNuevoReporteAdmin === 'function') {
    notificarNuevoReporteAdmin(fila, texto, email);
  }

  return true;
}

function cambiarUbicacion(fila, nuevaZona) {
  var email = Session.getActiveUser().getEmail().toLowerCase().trim();
  var permisos = verificarPermisos(email);
  if (!permisos.esAdmin) throw new Error("Acceso denegado: Solo administradores.");

  var ss = getSS();
  var sheet = ss.getSheetByName(SHEET_NAME);
  
  var zonaActual = sheet.getRange(fila, COL_ZONA).getValue();
  nuevaZona = nuevaZona.trim();
  sheet.getRange(fila, COL_ZONA).setValue(nuevaZona);

  var fecha = Utilities.formatDate(new Date(), "GMT-03:00", "dd/MM/yy HH:mm");
  var entrada = "[" + fecha + "] (" + email + ") 🚚 Movido de '" + zonaActual + "' a '" + nuevaZona + "'";
  
  var celdaLog = sheet.getRange(fila, COL_LOG);
  celdaLog.setValue(entrada + "\n" + celdaLog.getValue());
  sheet.getRange(fila, COL_FECHA).setValue(fecha);

  return true;
}

function getFilasPorZona(zona) {
  var ss    = getSS();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var data = sheet.getRange(3, 1, sheet.getLastRow() - 2, sheet.getLastColumn()).getValues();

  return data.map(function(r, i) {
    return {
      fila:      i + 3,
      articulo:  (r[0] || "").toString().trim(),
      bien:      r[2]  || 0,
      regular:   r[3]  || 0,
      roto:      r[4]  || 0,
      total:     r[5]  || 0,
      obs:       r[6]  || "",
      historial: (r[9] || "").toString(),
      foto:      (r[13]|| "").toString(),
      zona:      (r[7] || "").toString().trim()
    };
  })
  .filter(function(f) { return f.zona === zona && f.articulo; })
  .sort(function(a, b) {
    return a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base", numeric: true });
  });
}

function buscarEnInventario(query) {
  const ss = getSS();
  const hoja = ss.getSheetByName(SHEET_NAME);
  const data = hoja.getRange(3, 1, hoja.getLastRow() - 2, hoja.getLastColumn()).getValues();
  query = query.toLowerCase().trim();
  
  return data.map((row, i) => { row._fIndex = i + 3; return row; })
    .filter(row => row[0].toString().toLowerCase().includes(query))
    .map(row => ({
      articulo: row[0], bien: row[2], regular: row[3], roto: row[4],
      ubicacion: row[7], foto: row[13], fila: row._fIndex
    }));
}

function obtenerZonasAdmin() {
  const ss = getSS();
  const hoja = ss.getSheetByName("ubicaciones");
  if (!hoja) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 3).getValues();
}

function guardarZona(id, nombre, desc) {
  const ss = getSS();
  let hojaUbi = ss.getSheetByName("ubicaciones");
  const data = hojaUbi.getDataRange().getValues();
  
  const idBuscado = id ? id.toString().trim() : "";
  const nombreLimpio = nombre.trim();
  const nombreLower = nombreLimpio.toLowerCase();

  // --- NUEVO: CONTROL DE DUPLICADOS ---
  for (let i = 1; i < data.length; i++) {
    let idActual = data[i][0].toString().trim();
    let nombreActual = data[i][1].toString().trim().toLowerCase();
    
    // Si el nombre existe y NO pertenece al ID que estoy editando actualmente
    if (nombreActual === nombreLower && idActual !== idBuscado) {
      return { success: false, msg: `Error: Ya existe una zona llamada "${data[i][1]}".` };
    }
  }
  // ------------------------------------

  // ESCENARIO: EDICIÓN DE ZONA EXISTENTE
  if (idBuscado) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString().trim() === idBuscado) { 
        const nombreViejo = data[i][1].toString().trim();

        // Si el nombre cambió, propagamos al INVENTARIO con escritura quirúrgica
        if (nombreViejo !== nombreLimpio) {
          const hojaInv = ss.getSheetByName(SHEET_NAME);
          const ultimaFilaInv = hojaInv.getLastRow();
          
          if (ultimaFilaInv >= 3) {
            const dataInv = hojaInv.getRange(3, COL_ZONA, ultimaFilaInv - 2, 1).getValues();
            for (let j = 0; j < dataInv.length; j++) {
              if (dataInv[j][0].toString().trim() === nombreViejo) {
                hojaInv.getRange(j + 3, COL_ZONA).setValue(nombreLimpio);
              }
            }
          }
        }

        // Actualizamos la hoja maestra de ubicaciones
        hojaUbi.getRange(i + 1, 2, 1, 2).setValues([[nombreLimpio, desc]]);
        return { success: true, msg: 'Zona actualizada y nombres propagados en inventario.' };
      }
    }
  }
  
  // ESCENARIO: NUEVA ZONA
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    let currentId = data[i][0].toString();
    if (currentId.startsWith("Z")) {
      let num = parseInt(currentId.replace(/\D/g, ''), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  
  let nextId = "Z" + ("0" + (maxNum + 1)).slice(-2);
  hojaUbi.appendRow([nextId, nombreLimpio, desc]);
  return { success: true, msg: 'Nueva zona creada: ' + nextId };
}

function ejecutarGeneracionQR(listaIds = []) {
  if (typeof generarQRsDesdeUbicaciones === 'function') {
    generarQRsDesdeUbicaciones(listaIds);
    return listaIds.length > 0 
      ? "Proceso completado. Se generaron " + listaIds.length + " etiquetas en IMPRIMIR_QR." 
      : "Proceso de generación total completado en la hoja IMPRIMIR_QR.";
  }
  return "Error: No se encontró el módulo GenerarQR_PRO.";
}

function getScriptUrl() { return ScriptApp.getService().getUrl(); }

function eliminarZona(id, nombre) {
  const ss = getSS();
  const hojaInventario = ss.getSheetByName(SHEET_NAME);
  const hojaUbicaciones = ss.getSheetByName("ubicaciones");
  
  // 1. Verificación de seguridad: ¿Hay artículos asignados?
  const lastRowInv = hojaInventario.getLastRow();
  let articulosEncontrados = 0;
  
  if (lastRowInv >= 3) {
    // Leemos la columna H (Ubicación)
    const dataInv = hojaInventario.getRange(3, 8, lastRowInv - 2, 1).getValues();
    const nombreZonaLimpio = nombre.trim().toLowerCase();
    
    articulosEncontrados = dataInv.filter(function(fila) {
      return fila[0].toString().trim().toLowerCase() === nombreZonaLimpio;
    }).length;
  }

  if (articulosEncontrados > 0) {
    return { 
      success: false, 
      msg: "No se puede eliminar: hay " + articulosEncontrados + " artículos en '" + nombre + "'. Muévelos primero." 
    };
  }

  // 2. Localización y eliminación con comparación flexible
  const dataZonas = hojaUbicaciones.getDataRange().getValues();
  // Extraemos solo los números del ID que viene del Dashboard (ej: "Z05" -> "5")
  const idNumericoBuscado = id.toString().replace(/\D/g,'');

  for (let i = 1; i < dataZonas.length; i++) {
    // Extraemos solo los números del ID en la hoja (ej: "Z05" -> "5")
    let idNumericoHoja = dataZonas[i][0].toString().replace(/\D/g,'');
    
    if (idNumericoHoja === idNumericoBuscado && idNumericoBuscado !== "") {
      hojaUbicaciones.deleteRow(i + 1);
      return { success: true, msg: "Zona '" + nombre + "' eliminada." };
    }
  }
  
  return { success: false, msg: "Error: No se encontró la fila para el ID " + id };
}

// ─── BUILD HTML (VISTA MÓVIL) ─────────────────────────
function buildHtml(zona, filas, permisos, email) {
  const config = getAppConfig();
  // Extraemos solo los nombres de las zonas para inyectarlos en el JS del cliente
  const arrayZonas = obtenerZonasAdmin().map(function(z){ return z[1].toString().trim(); }).filter(String);
  const scriptUrl  = ScriptApp.getService().getUrl(); // URL base sin parámetros = Dashboard
  const admin = permisos.esAdmin;
  const autorizado = permisos.autorizado;

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">

<style>
*{box-sizing:border-box}
body {
  font-family: system-ui; margin: 0; background: #f2f4f7; color: #1a1a1a; overscroll-behavior-y: none;
}
header{background:#1a5276;color:#fff;padding:1rem}
header h3{margin:0 0 2px;font-size:1.1rem;font-weight:500}
header .sub{font-size:.8rem;opacity:.75}
.btn-dash{
  display:inline-block; margin-top:.6rem; padding:.35rem .8rem;
  background:rgba(255,255,255,.15); color:#fff; text-decoration:none;
  border-radius:20px; font-size:.78rem; border:1px solid rgba(255,255,255,.3);
  transition:background .2s;
}
.btn-dash:hover{background:rgba(255,255,255,.28)}

.item{
  background:#fff; margin:.8rem; padding:1rem; border-radius:12px; border:1px solid #e0e0e0; transition: opacity 0.3s ease;
}
.art{font-weight:500;margin-bottom:.5rem;line-height:1.4}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin:.4rem 0}
.badge{padding:3px 8px; border-radius:20px; font-size:.75rem; font-weight:500}
.bien{background:#d4edda;color:#155724}
.reg{background:#fff3cd;color:#856404}
.roto{background:#f8d7da;color:#721c24}
.total{background:#e2e8f0;color:#334155}

.obs{font-size:.8rem; color:#555; border-left:3px solid #aaa; padding:.3rem .6rem; margin:.4rem 0; background:#fafafa; border-radius:0 4px 4px 0}
.last{font-size:.75rem;color:#888;margin:.3rem 0}

.thumb{
  width:90px; height:90px; min-width: 90px; min-height: 90px; object-fit:cover; border-radius:8px; margin:.5rem 0; cursor:pointer; display:block
}
.upload-wrap{display:flex; align-items:center; gap:8px; margin:.5rem 0}

.rep-wrap {
  display: flex;
  gap: 6px;
  margin-top: 0.5rem;
  align-items: center;
  flex-wrap: wrap; /* Permite que los botones bajen de línea */
}
.rep-input {
  flex: 1;
  min-width: 150px; /* Base mínima para que no desaparezca */
  padding: .5rem;
  border: 1px solid #ccc;
  border-radius: 8px;
  font-size: .9rem;
}
.btn-group {
  display: flex;
  gap: 6px;
}

.rep-input:focus{outline:none; border-color:#1a5276}
.rep-btn{background:#1a5276; color:#fff; border:none; border-radius:8px; padding:.5rem .9rem; cursor:pointer; font-size:.9rem; white-space:nowrap}
.rep-btn:disabled{opacity:.6}

.msg{font-size:.8rem;margin-top:.3rem;min-height:1rem}
.ok{color:#155724} .err{color:#721c24}

.modal{
  display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,.85); justify-content:center; align-items:center; z-index:99;
}
.modal img{max-width:90%; max-height:90%; border-radius:8px;}

.paginacion {
  display: flex; justify-content: space-between; align-items: center; margin: 1rem; padding: 0.5rem; background: #fff; border-radius: 8px; border: 1px solid #e0e0e0;
}
.btn-pag {background: #1a5276; color: #fff; border: none; border-radius: 6px; padding: 0.6rem 1rem; font-size: 0.9rem; cursor: pointer;}
.btn-pag:disabled {background: #ccc; color: #666; cursor: not-allowed;}
#span-pag {font-weight: 500; color: #333; font-size: 0.9rem;}

/* Estilos para el modal Mover */
.modal-mover-content { background:white; padding:20px; width:85%; max-width:400px; border-radius:8px; display:flex; flex-direction:column; gap:15px; }
.modal-mover-content h3 { margin:0; color:#1a5276; font-size:1.2rem; }
.modal-mover-content select { padding:12px; border-radius:6px; border:1px solid #ccc; font-size:1rem; width:100%; background:#f9f9f9; }
.footer-info { text-align:center; padding:1.2rem 1rem 2rem; color:#aaa; font-size:.7rem; border-top:1px solid #e8e8e8; margin-top:.5rem; }
</style>
<meta name="theme-color" content="#1a5276">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${config.laboratorio}">
<script>
(function(){
  var icon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="80" fill="#1a5276"/><rect x="140" y="165" width="232" height="268" rx="20" fill="white" opacity=".95"/><rect x="196" y="130" width="120" height="55" rx="14" fill="#154360"/><rect x="216" y="142" width="80" height="30" rx="10" fill="#2980b9" opacity=".4"/><rect x="175" y="230" width="140" height="14" rx="7" fill="#1a5276" opacity=".18"/><rect x="175" y="262" width="110" height="14" rx="7" fill="#1a5276" opacity=".18"/><rect x="175" y="294" width="125" height="14" rx="7" fill="#1a5276" opacity=".18"/><rect x="175" y="326" width="85" height="14" rx="7" fill="#1a5276" opacity=".18"/><circle cx="155" cy="237" r="12" fill="#27ae60"/><circle cx="155" cy="269" r="12" fill="#27ae60"/><circle cx="155" cy="301" r="12" fill="#e74c3c"/><circle cx="155" cy="333" r="12" fill="#f39c12"/></svg>';
  var m={name:'Inventario ' + ${JSON.stringify(config.laboratorio)},short_name:${JSON.stringify(config.laboratorio)},description:'Sistema de Gestión de Inventario para ' + ${JSON.stringify(config.laboratorio)},start_url:'${scriptUrl}',display:'standalone',orientation:'portrait',background_color:'#f2f4f7',theme_color:'#1a5276',icons:[{src:'data:image/svg+xml,'+encodeURIComponent(icon),sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]};
  var b=new Blob([JSON.stringify(m)],{type:'application/manifest+json'});
  var l=document.createElement('link');l.rel='manifest';l.href=URL.createObjectURL(b);
  document.head.appendChild(l);
})();
</script>
</head>
<body>

<header>
  <h3>${config.laboratorio} - ${config.institucion}</h3>
  <div>${zona}</div>
  <div class="sub">${email ? email : "Invitado"}${admin ? " · admin" : autorizado ? " · docente" : ""}</div>
  ${autorizado ? `<a class="btn-dash" href="${scriptUrl}">← ${admin ? "Dashboard" : "Buscar Artículo"}</a>` : ""}
</header>

<div id="contenedor"></div>

<div class="paginacion" id="barra-paginacion" style="display:none;">
  <button id="btn-ant" class="btn-pag" onclick="cambiarPagina(-1)">◀ Anterior</button>
  <span id="span-pag"></span>
  <button id="btn-sig" class="btn-pag" onclick="cambiarPagina(1)">Siguiente ▶</button>
</div>

<div class="modal" id="modal" onclick="cerrarModal()">
  <img id="imgModal">
</div>

<div class="modal" id="modalMover" onclick="if(event.target===this) cerrarModalMover()">
  <div class="modal-mover-content">
    <h3 id="modalMoverTitle"></h3>
    <div style="font-size:0.9rem; color:#555;">Ubicación actual: <strong id="zonaActualTexto"></strong></div>
    <select id="selectNuevaZona"></select>
    <div style="display:flex; gap:10px; margin-top:5px;">
      <button onclick="confirmarMovimiento(this)" style="flex:1; background:#d35400; color:white; border:none; padding:12px; border-radius:6px; font-weight:bold; cursor:pointer;">Mover</button>
      <button onclick="cerrarModalMover()" style="flex:1; background:#7f8c8d; color:white; border:none; padding:12px; border-radius:6px; font-weight:bold; cursor:pointer;">Cancelar</button>
    </div>
  </div>
</div>

<script>
let paginaActual = 0;
const LIMIT = 20;
const DATA = ${JSON.stringify(filas)};
const ZONAS = ${JSON.stringify(arrayZonas)};
const ADMIN = ${admin};
const AUTORIZADO = ${autorizado};

function cambiarPagina(direccion) {
  var cont = document.getElementById("contenedor");
  var barraPag = document.getElementById("barra-paginacion");
  
  if (DATA.length === 0) {
    cont.innerHTML = "<p style='text-align:center; padding:2rem;'>No hay artículos.</p>";
    return;
  }

  paginaActual += direccion;
  let maxPagina = Math.ceil(DATA.length / LIMIT) - 1;
  if (paginaActual < 0) paginaActual = 0;
  if (paginaActual > maxPagina) paginaActual = maxPagina;

  let inicio = paginaActual * LIMIT;
  let fin = inicio + LIMIT;

  if (cont.children.length < fin && cont.children.length < DATA.length) {
    let fragmento = document.createDocumentFragment();
    for (let i = cont.children.length; i < Math.min(fin + LIMIT, DATA.length); i++) {
      let temp = document.createElement('div');
      temp.innerHTML = render(DATA[i]);
      fragmento.appendChild(temp.firstChild);
    }
    cont.appendChild(fragmento);
  }

  Array.from(cont.children).forEach(function(item, i) {
    var img = item.querySelector("img[data-src]");
    if (i >= inicio && i < fin) {
      item.style.display = "block";
      if (img) img.src = img.dataset.src + "=w300";
    } else {
      item.style.display = "none";
      if (img) img.src = ""; 
    }
  });

  barraPag.style.display = "flex";
  document.getElementById("btn-ant").disabled = (paginaActual === 0);
  document.getElementById("btn-sig").disabled = (paginaActual >= maxPagina);
  document.getElementById("span-pag").innerText = "Pág " + (paginaActual + 1) + " de " + (maxPagina + 1);

  setTimeout(function() {
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event('resize')); 
  }, 10);
}

document.addEventListener("click", function(e) {
  if (e.target.classList.contains("thumb")) {
    var modal = document.getElementById("modal");
    var imgModal = document.getElementById("imgModal");
    imgModal.src = e.target.dataset.src + "=w800";
    modal.style.display = "flex";
    setTimeout(function() {
      if (modal.style.display === "flex") history.pushState({ modalAbierto: true }, "");
    }, 150);
  }
});

function cerrarModal() {
  var modal = document.getElementById("modal");
  var imgModal = document.getElementById("imgModal");
  if (modal.style.display === "flex") {
    imgModal.src = ""; 
    setTimeout(function() {
      modal.style.display = "none";
      requestAnimationFrame(function() {
        window.dispatchEvent(new Event('resize'));
        if (history.state && history.state.modalAbierto) history.back();
      });
    }, 50);
  }
}

window.addEventListener("popstate", function() {
  var modal = document.getElementById("modal");
  if (modal.style.display === "flex") {
    document.getElementById("imgModal").src = "";
    setTimeout(function() {
      modal.style.display = "none";
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }
  
  var modalMover = document.getElementById("modalMover");
  if (modalMover.style.display === "flex") cerrarModalMover();
});

function render(f) {
  if (!f.articulo) return "";
  
  // 1. Recuperamos los emojis y etiquetas completas de las badges
  var badges = (f.roto > 0 ? "<span class='badge roto'>🔴 Roto: " + f.roto + "</span>" : "") +
               (f.regular > 0 ? "<span class='badge reg'>🟡 Regular: " + f.regular + "</span>" : "") +
               (f.bien > 0 ? "<span class='badge bien'>🟢 Bien: " + f.bien + "</span>" : "") +
               "<span class='badge total'>📦 Total: " + f.total + "</span>";
  
  var ultimo = f.historial ? f.historial.split("\\n")[0] : "";
  
  // 2. Bloque de Foto (solo para ADMIN)
  var btnFoto = "";
  if (ADMIN) {
    btnFoto = "<div class='upload-wrap'><input type='file' id='finput" + f.fila + "' accept='image/*' capture='environment' style='display:none' onchange='procesarArchivo(this," + f.fila + ")'><button class='rep-btn' id='btn-foto-" + f.fila + "' onclick='abrirSelector(" + f.fila + ")'>📸 Foto</button><span id='msg-foto-" + f.fila + "' class='msg'></span></div>";
  }

  // 3. Botón Mover (solo para ADMIN)
  var btnMover = "";
  if (ADMIN) {
    btnMover = "<button class='rep-btn' style='background:#d35400;' onclick='abrirModalMover(" + f.fila + ", &#39;" + f.zona + "&#39;)'>🚚 Mover</button>";
  }

  // 4. Construcción final con el fix para el celular (flex-wrap y sub-contenedor de botones)
  var html = "<div class='item' id='item-" + f.fila + "'>";
  html += "<div class='art'>" + f.articulo + "</div>";
  html += "<div class='badges'>" + badges + "</div>";
  if (f.obs) html += "<div class='obs'>📝 " + f.obs + "</div>";
  if (ultimo) html += "<div class='last'>🕒 " + ultimo + "</div>";
  if (f.foto) html += "<img class='thumb' data-src='" + f.foto + "' loading='lazy'>";
  html += btnFoto;
  html += "<div class='rep-wrap'>";
  if (AUTORIZADO) {
    html += "<input class='rep-input' data-fila='" + f.fila + "' placeholder='Describí el problema...'>";
    html += "<div style='display:flex; gap:6px;'>" + "<button class='rep-btn' onclick='enviar(this)'>Reportar</button>" + btnMover + "</div>";
  } else {
    html += "<input class='rep-input' placeholder='Inicia sesión para reportar...' disabled>";
    html += "<div style='display:flex; gap:6px;'>" + "<button class='rep-btn' style='background:#95a5a6; cursor:not-allowed;' disabled>Reportar</button>" + btnMover + "</div>";
  }
  html += "</div></div>";
  
  return html;
}

// LÓGICA MODAL MOVER
let filaSeleccionadaMover = null;

function abrirModalMover(fila, zonaActual) {
  filaSeleccionadaMover = fila;
  var el = document.getElementById("item-" + fila);
  var nombreArt = el ? el.querySelector('.art').innerText : "Articulo";
  document.getElementById('modalMoverTitle').innerText = "Mover: " + nombreArt;
  document.getElementById('zonaActualTexto').innerText = zonaActual;
  var select = document.getElementById('selectNuevaZona');
  select.innerHTML = '<option value="">-- Destino --</option>';
  ZONAS.forEach(function(z) {
    if (z !== zonaActual) select.innerHTML += '<option value="' + z + '">' + z + '</option>';
  });
  document.getElementById('modalMover').style.display = 'flex';
}

function cerrarModalMover() {
  document.getElementById('modalMover').style.display = 'none';
  if (history.state && history.state.modalMoverAbierto) history.back();
}

function confirmarMovimiento(btn) {
  let select = document.getElementById('selectNuevaZona');
  let nuevaZona = select.value;
  if (!nuevaZona) return alert("Por favor, seleccione una zona de destino.");
  
  btn.innerText = "Moviendo...";
  btn.disabled = true;
  
  google.script.run
    .withSuccessHandler(function() {
      alert("Movido exitosamente a: " + nuevaZona);
      cerrarModalMover();
      let el = document.getElementById("item-" + filaSeleccionadaMover);
      if (el) el.style.opacity = "0.3";
      btn.innerText = "Mover";
      btn.disabled = false;
    })
    .withFailureHandler(function(err) {
      btn.innerText = "Mover"; btn.disabled = false;
      alert("Error al mover artículo: " + err.message);
    })
    .cambiarUbicacion(filaSeleccionadaMover, nuevaZona);
}

function procesarArchivo(input, fila) {
  var file = input.files[0];
  if (!file || file.size > 8 * 1024 * 1024) return;
  var btnFoto = document.getElementById("btn-foto-" + fila);
  btnFoto.disabled = true; btnFoto.innerText = "Procesando...";
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      setTimeout(function() {
        var canvas = document.createElement("canvas");
        var scale = Math.min(1, 800 / img.width);
        canvas.width = img.width * scale; canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        google.script.run
          .withSuccessHandler(function(url) {
            btnFoto.innerText = "✅ Subida"; btnFoto.disabled = false;
            var item = document.getElementById("finput" + fila).closest(".item");
            var thumb = item.querySelector(".thumb");
            if (thumb) { thumb.src = url + "=w300"; thumb.dataset.src = url; }
            else {
              var newImg = document.createElement("img"); newImg.className = "thumb";
              newImg.src = url + "=w300"; newImg.dataset.src = url;
              item.insertBefore(newImg, item.querySelector(".upload-wrap"));
            }
          })
          .withFailureHandler(function(err) {
            btnFoto.innerText = "❌ Error"; btnFoto.disabled = false;
            document.getElementById("msg-foto-" + fila).innerText = "Error: " + err.message;
          })
          .subirFoto(fila, canvas.toDataURL("image/jpeg", 0.7), file.name);
      }, 50);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function enviar(btn) {
  var inp = btn.previousElementSibling;
  var txt = inp.value.trim();
  if (txt.length < 5) return;
  btn.disabled = true; btn.innerText = "Enviando...";
  google.script.run
    .withSuccessHandler(function() {
      inp.value = ""; btn.innerText = "✔ Enviado";
      setTimeout(function() { btn.disabled = false; btn.innerText = "Reportar"; }, 2000);
    })
    .withFailureHandler(function(err) {
      btn.disabled = false; btn.innerText = "Reportar";
      alert("Error al enviar reporte: " + err.message);
    })
    .registrarReporte(parseInt(inp.dataset.fila), txt);
}

function abrirSelector(fila) { document.getElementById("finput" + fila).click(); }

// --- ARRANQUE CON FOCO DE BÚSQUEDA ---
google.script.url.getLocation(function(loc) {
  let hash = loc.hash || ""; 
  
  if (hash.includes("item-")) {
    let focoId = parseInt(hash.replace("item-", ""));
    let itemIndex = DATA.findIndex(d => d.fila === focoId);
    
    if (itemIndex !== -1) {
      paginaActual = Math.floor(itemIndex / LIMIT);
    }
  }

  cambiarPagina(0);

  if (hash.includes("item-")) {
    setTimeout(function() {
      let el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = "background 0.5s ease";
        el.style.border = "2px solid #e74c3c";
        el.style.backgroundColor = "#fdf2f1";
      }
    }, 600); 
  }
});
</script>

<footer class="footer-info">
  🄯 ${new Date().getFullYear()} &nbsp;·&nbsp; ${config.laboratorio} &nbsp;·&nbsp; <strong>v${APP_VERSION}</strong> &nbsp;·&nbsp; <a href="mailto:trujillo.leonardo@gmail.com?subject=Comentario%20-%20Sistema%20de%20Inventario%20${encodeURIComponent(config.laboratorio)}" style="color:#bbb;">Comentarios</a>
</footer>

</body>
</html>`;
}