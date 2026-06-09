function generarQRsDesdeUbicaciones(listaIdsFiltrar = []) {
  const SHEET_UBICACIONES = "ubicaciones";
  // Riesgo #3 fix: URL dinámica para que los QRs sobrevivan a nuevos deployments.
  const WEBAPP_URL = ScriptApp.getService().getUrl();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetMaestra = ss.getSheetByName(SHEET_UBICACIONES);

  if (!sheetMaestra) {
    SpreadsheetApp.getUi().alert("No se encontró la hoja 'ubicaciones'");
    return;
  }

  const lastRowMaestra = sheetMaestra.getLastRow();
  if (lastRowMaestra < 2) return;
  let dataMaestra = sheetMaestra.getRange(2, 1, lastRowMaestra - 1, 2).getValues();

  // FILTRO: Solo procesar las zonas que coincidan con los IDs seleccionados
  if (listaIdsFiltrar && listaIdsFiltrar.length > 0) {
    dataMaestra = dataMaestra.filter(fila => listaIdsFiltrar.includes(fila[0].toString().trim()));
  }

  if (dataMaestra.length === 0) return;

  let sheetQR = ss.getSheetByName("IMPRIMIR_QR");
  if (!sheetQR) sheetQR = ss.insertSheet("IMPRIMIR_QR");
  else sheetQR.clear();

  const COLS = 2;
  const QR_SIZE = 120;
  const COL_WIDTH = 300;
  const ROW_HEADER = 30;
  const ROW_QR = 130;
  const ROW_TEXT = 40;
  const colores = ["#1a5276", "#117864", "#7d6608", "#6c3483", "#922b21"];

  let currentRow = 1;

  dataMaestra.forEach((fila, i) => {
    const idZona = fila[0];     
    const nombreZona = fila[1]; 

    if (!nombreZona) return; 

    const col = (i % COLS) + 1;
    if (i % COLS === 0 && i !== 0) {
      currentRow += 3; 
    }

    const codigo = "Z" + String(idZona).replace(/\D/g, '').padStart(2, "0");
    const color  = colores[i % colores.length];

    const url = WEBAPP_URL + "?zona=" + encodeURIComponent(nombreZona) + "&v=1";
    const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + encodeURIComponent(url);

    sheetQR.getRange(currentRow, col)
      .setValue(codigo)
      .setBackground(color)
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setBorder(true, true, false, true, false, false);

    sheetQR.getRange(currentRow + 1, col)
      .setFormula(`=IMAGE("${qrUrl}", 4, ${QR_SIZE}, ${QR_SIZE})`)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setBorder(false, true, false, true, false, false);

    sheetQR.getRange(currentRow + 2, col)
      .setValue(nombreZona)
      .setFontWeight("bold")
      .setFontSize(12)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setBorder(false, true, true, true, false, false);
  });

  for (let c = 1; c <= COLS; c++) {
    sheetQR.setColumnWidth(c, COL_WIDTH);
  }

  for (let r = 1; r <= sheetQR.getLastRow(); r += 3) {
    sheetQR.setRowHeight(r, ROW_HEADER);
    sheetQR.setRowHeight(r + 1, ROW_QR);
    sheetQR.setRowHeight(r + 2, ROW_TEXT);
  }

  sheetQR.setHiddenGridlines(true);
}