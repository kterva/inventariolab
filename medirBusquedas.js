// Resume el registro de búsquedas por foto: aciertos, y qué umbral conviene.
// Uso: npm run medir-busquedas [ruta/al/busquedas.jsonl]
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || path.join(process.env.BUSQUEDAS_LOG_DIR || path.join(__dirname, 'logs-busquedas'), 'busquedas.jsonl');
const eventos = [];
for (const f of [base + '.anterior', base]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) { try { if (l) eventos.push(JSON.parse(l)); } catch (e) { /* línea rota */ } }
}

const busquedas = new Map(eventos.filter(e => e.tipo === 'busqueda').map(e => [e.id, { ...e, elecciones: [] }]));
for (const e of eventos.filter(e => e.tipo === 'eleccion')) if (busquedas.has(e.id)) busquedas.get(e.id).elecciones.push(e);

// Un caso = búsqueda con elección. Resultado: posición del candidato abierto (1–3), o 0 si dijo "ninguno"
const casos = [];
for (const b of busquedas.values()) {
  if (!b.elecciones.length || !b.top.length) continue;
  const abrio = b.elecciones.find(e => e.accion === 'abrio');
  const pos = abrio ? b.top.findIndex(t => t.id === abrio.articulo) + 1 : 0; // 0 = ninguno (o abrió algo fuera del top)
  casos.push({ p1: b.top[0].p, afirmo: b.coincide, pos });
}

const pct = (a, b) => b ? Math.round(100 * a / b) + ' %' : '—';
console.log(`Búsquedas registradas: ${busquedas.size}; con elección (casos): ${casos.length}`);
if (!casos.length) { console.log('Todavía no hay casos.'); process.exit(0); }

console.log(`\nAcertó el 1.º:   ${casos.filter(c => c.pos === 1).length} (${pct(casos.filter(c => c.pos === 1).length, casos.length)})`);
console.log(`Estaba en top-3: ${casos.filter(c => c.pos >= 1).length} (${pct(casos.filter(c => c.pos >= 1).length, casos.length)})`);
console.log(`"Ninguno":       ${casos.filter(c => c.pos === 0).length} (${pct(casos.filter(c => c.pos === 0).length, casos.length)})`);

const afirmo = casos.filter(c => c.afirmo);
console.log(`\nCuando dijo "Parece ser…" (${afirmo.length} casos): el 1.º era el bueno en ${pct(afirmo.filter(c => c.pos === 1).length, afirmo.length)}`);

console.log('\nPor puntaje del 1.º   casos   abrió el 1.º');
for (const [a, b] of [[0, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 1.01]]) {
  const g = casos.filter(c => c.p1 >= a && c.p1 < b);
  console.log(`  ${a.toFixed(1)}–${Math.min(b, 1).toFixed(1)}            ${String(g.length).padStart(4)}   ${pct(g.filter(c => c.pos === 1).length, g.length)}`);
}

// Menor umbral con el que ≥90 % de lo que se afirma es correcto (y al menos 5 casos)
let sugerido = null;
for (let t = 0.3; t <= 0.9; t = Math.round((t + 0.01) * 100) / 100) {
  const g = casos.filter(c => c.p1 >= t);
  if (g.length >= 5 && g.filter(c => c.pos === 1).length / g.length >= 0.9) { sugerido = t; break; }
}
console.log(sugerido ? `\nUmbral sugerido (≥90 % de aciertos al afirmar): ${sugerido.toFixed(2)}  (hoy: 0,60)` : '\nNingún umbral llega al 90 % con al menos 5 casos: con más datos, o conviene probar otro modelo.');
