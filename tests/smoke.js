/*
 * smoke.js — runs every test definition's compute() with plausible
 * inputs and checks it returns a well-formed result without throwing.
 * Run with: node tests/smoke.js
 */
require('../js/tests.js');
require('../js/tests-materials.js');
const REG = globalThis.TEST_REGISTRY;

/* Representative values for fields the generic filler can't guess. */
const OVERRIDES = {
  slump:            { subsided: 210, specified: 100, slumpDirect: '' },
  'compacting-factor': { empty: 5, partial: 30, full: 34 },
  'vee-bee':        { seconds: 8 },
  'flow-table':     { d1: 320, d2: 330 },
  'fresh-density':  { empty: 5, full: 40.4, theoretical: 2360 },
  'air-content':    { apparent: 2.5, aggCorrection: 0.3, specifiedMax: 4 },
  'modulus-elasticity': { stress1: 1.0, strain1: 0.00004, stress2: 10, strain2: 0.00037 },
  'rebound-hammer': { readings: [38,40,39,41,37,40,39,38,42,40,39,41], correlation: 32 },
  upv:              { path: 300, readings: [70,71,70] },
  rcpt:             { readings: [60,62,65,68,70,73,75,78,80,82,85,87,90] },
  rcmt:             { tempInit: 21, tempFinal: 23, depths: [9,10,11,10,9,10,11] },
  'water-penetration': { depths: [12,18,15] },
  'permeability-coefficient': { flow: 12, thickness: 50, area: 7854, head: 10, duration: 100 },
  'cement-specific-gravity': { w1: 40, w2: 104, w3: 180.7, w4: 160 },
  'cement-setting-time': { initial: 120, final: 280, consistency: 30 },
  'flakiness-elongation': { total: 2000, flaky: 300, elongated: 350 },
  'bulk-density-voids': { empty: 5, full: 29, volume: 15 },
  'silt-content':   { siltLayer: 4, sandLayer: 150 }
};
const SPEC_OVERRIDES = {
  'cube-compressive':   { load: 700, mass: 8.45, length: 150, width: 150 },
  'cylinder-compressive': { load: 550, dia: 150 },
  'core-compressive':   { dia: 94, height: 188, load: 180, mass: 2.9 },
  'flexural-strength':  { load: 20, a: 250 },
  'split-tensile':      { load: 200 },
  'hardened-density':   { mass: 8.45 },
  'water-absorption':   { dry: 2400, sat: 2448 },
  'cement-fineness-sieve': { total: 100, retained: 6 },
  'cement-consistency': { cement: 400, water: 120, penetration: 6 },
  'cement-soundness':   { before: 10, after: 16 },
  'cement-compressive': { load: 290 },
  'aggregate-specific-gravity': { ovenDry: 1000, ssd: 1012, inWater: 625 },
  'impact-value':       { total: 350, fines: 60 },
  'crushing-value':     { total: 3000, fines: 600 },
  'abrasion-value':     { total: 5000, retained: 3700 }
};

function fillField(fl, testId) {
  const ov = OVERRIDES[testId] || {};
  if (fl.k in ov) return ov[fl.k];
  if (fl.type === 'select') return fl.def !== undefined ? fl.def : fl.options[0];
  if (fl.type === 'date') return '2026-11-01';
  if (fl.type === 'text') return 'SMOKE';
  if (fl.type === 'list') {
    const count = fl.def || 3;
    return Array.from({ length: count }, (_, i) => 10 + i);
  }
  return fl.def !== undefined ? fl.def : 10;
}

let ok = 0, bad = 0;
REG.forEach(t => {
  try {
    const h = {};
    (t.header || []).forEach(fl => { h[fl.k] = fillField(fl, t.id); });
    (t.fieldTables || []).forEach(tb => {
      h[tb.k] = tb.rows.map((r, i) => ({ sieve: r, retained: (i + 1) * 50 }));
    });
    const sp = [];
    if (t.specimens) {
      for (let i = 0; i < t.specimens.def; i++) {
        const row = {};
        t.specimens.fields.forEach(fl => {
          const so = SPEC_OVERRIDES[t.id] || {};
          row[fl.k] = (fl.k in so) ? so[fl.k] : fillField(fl, t.id);
        });
        sp.push(row);
      }
    }
    const ctx = { grade: 'M30', sigma: null, exposure: 'Severe', wearing: false };
    const r = t.compute(h, sp, ctx);

    const problems = [];
    if (!r) problems.push('returned nothing');
    else {
      if (!r.verdict || !r.verdict.status) problems.push('no verdict');
      else if (['PASS','FAIL','INFO','REVIEW'].indexOf(r.verdict.status) < 0)
        problems.push('bad verdict status: ' + r.verdict.status);
      if (!Array.isArray(r.summary) || !r.summary.length) problems.push('empty summary');
      if (!Array.isArray(r.notes)) problems.push('notes not an array');
      if (r.table) {
        if (!Array.isArray(r.table.headers)) problems.push('table headers not an array');
        (r.table.rows || []).forEach((row, i) => {
          if (row.length !== r.table.headers.length)
            problems.push('row ' + i + ' has ' + row.length + ' cells, headers has ' + r.table.headers.length);
        });
      }
      (r.summary || []).forEach(s => {
        if (s.value === undefined || s.value === null) problems.push('summary "' + s.label + '" has no value');
        if (typeof s.value === 'number' && !isFinite(s.value)) problems.push('summary "' + s.label + '" is NaN');
        if (String(s.value) === 'NaN') problems.push('summary "' + s.label + '" stringified NaN');
      });
    }
    if (problems.length) { bad++; console.log('  FAIL ' + t.id + ' -> ' + problems.join('; ')); }
    else { ok++; console.log('  ok   ' + t.id + '  [' + r.verdict.status + '] ' +
            r.summary.slice(0,2).map(s => s.label + ': ' + s.value + (s.unit ? ' ' + s.unit : '')).join(' | ')); }
  } catch (e) {
    bad++; console.log('  THREW ' + t.id + ' -> ' + e.message);
  }
});
console.log('\n============================');
console.log('compute ok: ' + ok + '   problems: ' + bad);
process.exit(bad ? 1 : 0);
