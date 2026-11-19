// Estructura de una planilla de InventarioLab, en un solo lugar.
//
// La usa "Crear mi laboratorio" (la app crea la planilla y la carpeta de fotos
// en el Drive del docente) y googleClient.js (nombres de hojas, encabezados y
// la protección de la columna ID). Todo se escribe como texto literal (RAW):
// un nombre que empiece con "=" no se interpreta como fórmula.

const NOMBRE_CARPETA_FOTOS = 'LAB_FOTOS (InventarioLab)';
const DESC_PROTECCION_ID = 'InventarioLab: IDs de artículos (no editar)';

const ENCABEZADOS_INVENTARIO = ['Artículo', 'COD', 'Bien', 'Regular', 'Roto', 'Total', 'Observaciones', 'Ubicación',
  'Última modificación', 'Historial', 'Reporte', 'Link', 'ID Zona', 'Foto', 'ID'];
const ENCABEZADOS_HISTORIAL = ['Fecha', 'ID', 'Artículo', 'Usuario', 'Acción', 'Detalle'];
const ENCABEZADOS_UBICACIONES = ['ID', 'Nombre', 'Desc'];
const ENCABEZADOS_CONFIG = ['email', 'rol', '', 'clave', 'valor'];

const MAX_NOMBRE = 80;

/** Texto de una sola línea, sin caracteres de control y con largo acotado; '' si no queda nada */
function limpiarNombre(valor) {
  return String(valor == null ? '' : valor).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOMBRE);
}

/** Cuerpo de spreadsheets.create: las 4 hojas con sus dimensiones y la primera fila fija */
function cuerpoPlanilla({ institucion, laboratorio }) {
  const hoja = (title, columnCount, frozenRowCount) => ({
    properties: { title, gridProperties: { rowCount: 1000, columnCount, frozenRowCount } },
  });
  return {
    properties: { title: `Inventario Laboratorio - ${institucion}` },
    sheets: [
      hoja('INVENTARIO', ENCABEZADOS_INVENTARIO.length, 2),
      hoja('HISTORIAL', ENCABEZADOS_HISTORIAL.length, 1),
      hoja('ubicaciones', ENCABEZADOS_UBICACIONES.length, 1),
      hoja('config', 26, 1),
    ],
  };
}

/** Valores iniciales de cada hoja (rangos para values.batchUpdate) */
function valoresIniciales({ institucion, laboratorio, adminEmail }) {
  return [
    { range: 'INVENTARIO!A1', values: [[`INVENTARIO - ${laboratorio}`]] },
    { range: 'INVENTARIO!A2', values: [ENCABEZADOS_INVENTARIO] },
    { range: 'HISTORIAL!A1', values: [ENCABEZADOS_HISTORIAL] },
    { range: 'ubicaciones!A1', values: [ENCABEZADOS_UBICACIONES] },
    { range: 'config!A1', values: [
      ENCABEZADOS_CONFIG,
      [adminEmail, 'ADMIN', '', 'institucion', institucion],
      ['', '', '', 'laboratorio', laboratorio],
      ['', '', '', 'acceso publico', 'SI'],
    ] },
  ];
}

/**
 * Crea la planilla y la carpeta de fotos con las credenciales que se pasan
 * (el Drive de quien la crea) y deja a `adminEmail` como ADMIN.
 * Devuelve { sheetId, carpetaId, hojaInventarioId, url }.
 */
async function crearLaboratorio({ sheets, drive, institucion, laboratorio, adminEmail }) {
  institucion = limpiarNombre(institucion);
  laboratorio = limpiarNombre(laboratorio);
  if (!institucion || !laboratorio) throw new Error('Faltan el nombre del centro o del laboratorio.');
  if (!adminEmail) throw new Error('Falta el correo de quien administra el laboratorio.');

  const creada = await sheets.spreadsheets.create({ requestBody: cuerpoPlanilla({ institucion, laboratorio }) });
  const sheetId = creada.data.spreadsheetId;
  const idHoja = titulo => {
    const h = (creada.data.sheets || []).find(s => s.properties.title === titulo);
    return h && h.properties.sheetId;
  };

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: 'RAW', data: valoresIniciales({ institucion, laboratorio, adminEmail }) },
  });

  // La columna ID se protege con "solo advertencia", igual que hace la app con las planillas que prepara
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{ addProtectedRange: { protectedRange: {
      description: DESC_PROTECCION_ID,
      warningOnly: true,
      range: { sheetId: idHoja('INVENTARIO'), startRowIndex: 1, startColumnIndex: ENCABEZADOS_INVENTARIO.length - 1, endColumnIndex: ENCABEZADOS_INVENTARIO.length },
    } } }] },
  });

  const carpeta = await drive.files.create({
    requestBody: { name: NOMBRE_CARPETA_FOTOS, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });

  return { sheetId, carpetaId: carpeta.data.id, hojaInventarioId: idHoja('INVENTARIO'), url: `https://docs.google.com/spreadsheets/d/${sheetId}` };
}

module.exports = {
  NOMBRE_CARPETA_FOTOS, DESC_PROTECCION_ID, ENCABEZADOS_INVENTARIO, ENCABEZADOS_HISTORIAL,
  limpiarNombre, cuerpoPlanilla, valoresIniciales, crearLaboratorio,
};
