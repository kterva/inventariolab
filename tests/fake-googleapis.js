/**
 * Simulador de 'googleapis' para las pruebas: no hace llamadas reales a Google.
 *
 * Se carga con `node -r ./tests/fake-googleapis.js` (servidor) o con
 * require() antes de googleClient (pruebas en proceso). El estado queda en
 * global.__mock para que las pruebas puedan cambiar datos o simular fallos.
 *
 * Variables de entorno (para levantar el servidor):
 *   MODO_DEMO=SI|NO   activa el modo demo de la planilla simulada
 *   DEMO_ROL=ROL      rol del usuario demo (ADMIN, LECTOR, VISOR...)
 *   LOG_ESCRITURAS    archivo donde se anota una línea por cada escritura
 */
const Module = require('module');
const fs = require('fs');

const st = global.__mock = {
  authCreados: 0, batchGet: 0, get: 0, escrituras: 0,
  fallar: null,      // mensaje de error a lanzar en batchGet
  faltaHoja: null,   // rango que "no existe" en la planilla
  demora: 20,        // ms de latencia simulada
  hojas: {
    'config!A1:E100': [
      ['email', 'rol', '', 'clave', 'valor'],
      ['admin@x.uy', 'ADMIN', '', 'institucion', 'Liceo Test'],
      ['lector@x.uy', 'LECTOR', '', 'modo demo', process.env.MODO_DEMO || 'NO'],
      ['visor@x.uy', ' visor ', '', 'demo rol', process.env.DEMO_ROL || 'LECTOR'],
      ['invitado@demo.com', 'ADMIN'],
    ],
    'INVENTARIO!A3:N': [
      ['Probeta', '', '3', '1', '0', '4', '', 'Z1', '', 'log'],
      ['Balanza', '', '1', '0', '0', '1', '', 'Z1'],
      ['Imán', '', '2', '0', '0', '2', '', 'Z2'],
    ],
    'ubicaciones!A:C': [['ID', 'Nombre', 'Desc'], ['Z01', 'Z1', 'a'], ['Z02', 'Z2', 'b']],
  },
};

const espera = () => new Promise(r => setTimeout(r, st.demora));
const escribir = async () => {
  st.escrituras++;
  if (process.env.LOG_ESCRITURAS) fs.appendFileSync(process.env.LOG_ESCRITURAS, 'escritura\n');
  return { data: {} };
};

const fake = {
  google: {
    auth: { GoogleAuth: class { constructor() { st.authCreados++; } } },
    drive: () => ({}),
    sheets: () => ({
      spreadsheets: {
        values: {
          batchGet: async ({ ranges }) => {
            st.batchGet++; await espera();
            if (st.fallar) throw new Error(st.fallar);
            if (st.faltaHoja && ranges.includes(st.faltaHoja)) throw new Error('Unable to parse range: ' + st.faltaHoja);
            return { data: { valueRanges: ranges.map(r => ({ values: st.hojas[r] || [] })) } };
          },
          get: async ({ range }) => {
            st.get++; await espera();
            if (range === st.faltaHoja) throw new Error('Unable to parse range: ' + range);
            return { data: { values: st.hojas[range] || [] } };
          },
          batchUpdate: escribir,
          update: escribir,
          append: escribir,
        },
      },
    }),
  },
};

const cargarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  return pedido === 'googleapis' ? fake : cargarOriginal.call(this, pedido, ...resto);
};
