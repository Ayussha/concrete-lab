/*
 * tests.js — declarative registry of every test the lab can record
 * ----------------------------------------------------------------
 * Each entry describes its own input fields and its own calculation,
 * so the UI can render any test with one generic form renderer and the
 * certificate can print any test with one generic table renderer.
 * Adding a new test means adding one object here — no UI changes.
 *
 * Entry shape
 *   id          stable key, stored in the database. Never rename.
 *   name        printed on the certificate
 *   code        the standard the method follows
 *   category    groups the test in the picker
 *   header      fields recorded once per test
 *   specimens   optional repeating block (cubes, beams, cylinders)
 *   compute(h, s, ctx)  -> { table, summary, verdict, notes }
 *
 * compute() contract
 *   h    object of header field values
 *   s    array of specimen value objects
 *   ctx  { grade, sigma, exposure, wearing } from the parent job
 *   returns
 *     table   { headers:[string], rows:[[value]] }  or null
 *     summary [{ label, value, unit }]
 *     verdict { status:'PASS'|'FAIL'|'INFO'|'REVIEW', text }
 *     notes   [string]
 */

'use strict';

(function (root) {

  const S = (typeof require !== 'undefined' && typeof window === 'undefined')
    ? require('./standards.js') : root;

  const Num = S.Num, IS456 = S.IS456, IS516 = S.IS516, IS5816 = S.IS5816,
        IS1199 = S.IS1199, Durability = S.Durability,
        IS4031 = S.IS4031, IS2386 = S.IS2386;

  /* ---- small helpers ------------------------------------------- */
  function f(k, label, type, o) {
    return Object.assign({ k: k, label: label, type: type || 'number' }, o || {});
  }
  function n(v) { const x = parseFloat(v); return isFinite(x) ? x : NaN; }
  function col(values) { return values.filter(v => isFinite(v)); }
  function fmt(v, dp) { return isFinite(v) ? Num.dp(v, dp === undefined ? 2 : dp) : '—'; }
  function pass(ok, text) {
    return { status: ok ? 'PASS' : 'FAIL', text: text };
  }
  function info(text) { return { status: 'INFO', text: text }; }

  /* Common header fields reused across tests. */
  const AGE = f('age', 'Age at test (days)', 'number', { required: true });
  const CURING = f('curing', 'Curing condition', 'select', {
    options: ['Water curing at 27 ± 2 °C', 'Water curing — site tank',
              'Accelerated curing', 'Air curing', 'As received'],
    def: 'Water curing at 27 ± 2 °C'
  });
  const MACHINE = f('machine', 'Testing machine / equipment ID', 'text');
  const TEMPC = f('tempC', 'Ambient temperature (°C)', 'number');

  const TESTS = [];

  /* =============================================================
   * FRESH CONCRETE — IS 1199
   * ============================================================= */

  TESTS.push({
    id: 'slump',
    name: 'Slump',
    code: 'IS 1199 (Part 2)',
    category: 'Fresh Concrete',
    header: [
      f('coneHeight', 'Height of slump cone (mm)', 'number', { def: 300 }),
      f('subsided', 'Height of subsided concrete (mm)', 'number',
        { help: 'Leave blank if entering the slump directly' }),
      f('slumpDirect', 'Measured slump (mm)', 'number',
        { help: 'Use if the subsidence was read off directly' }),
      f('slumpType', 'Type of slump', 'select',
        { options: ['True', 'Shear', 'Collapse'], def: 'True' }),
      f('specified', 'Specified slump (mm)', 'number'),
      f('tolerance', 'Permitted tolerance (± mm)', 'number', { def: 25 }),
      f('elapsed', 'Time after batching (min)', 'number'),
      TEMPC, MACHINE
    ],
    compute(h) {
      let slump = n(h.slumpDirect);
      let basis = 'measured directly';
      if (!isFinite(slump)) {
        slump = n(h.coneHeight) - n(h.subsided);
        basis = 'cone height \u2212 height of subsided concrete';
      }
      const cls = IS456.classifySlump(slump);
      const spec = n(h.specified), tol = isFinite(n(h.tolerance)) ? n(h.tolerance) : 25;
      const summary = [
        { label: 'Slump', value: fmt(slump, 0), unit: 'mm' },
        { label: 'Degree of workability (IS 456 Table 7)', value: cls, unit: '' },
        { label: 'Type of slump', value: h.slumpType || '—', unit: '' },
        { label: 'Basis of measurement', value: basis, unit: '' }
      ];
      if (isFinite(n(h.elapsed))) {
        summary.push({ label: 'Time after batching', value: fmt(n(h.elapsed), 0), unit: 'min' });
      }
      const notes = [];
      if (h.slumpType === 'Shear' || h.slumpType === 'Collapse') {
        notes.push('A shear or collapse slump indicates a harsh or over-wet ' +
          'mix. IS 1199 requires the test to be repeated with a fresh sample; ' +
          'if shear slump persists the result should be recorded as such.');
      }
      let verdict;
      if (isFinite(spec)) {
        const ok = Math.abs(slump - spec) <= tol;
        verdict = pass(ok, 'Measured ' + fmt(slump, 0) + ' mm against a specified ' +
          fmt(spec, 0) + ' ± ' + tol + ' mm.');
        summary.splice(1, 0, { label: 'Specified slump', value: fmt(spec, 0) + ' ± ' + tol, unit: 'mm' });
      } else {
        verdict = info('No specified slump recorded — result reported for information.');
      }
      return { table: null, summary: summary, verdict: verdict, notes: notes };
    }
  });

  TESTS.push({
    id: 'compacting-factor',
    primaryLabel: 'Compacting factor',
    name: 'Compacting Factor',
    code: 'IS 1199 (Part 2)',
    category: 'Fresh Concrete',
    header: [
      f('empty', 'Mass of empty cylinder (kg)', 'number'),
      f('partial', 'Mass of cylinder + partially compacted concrete (kg)', 'number'),
      f('full', 'Mass of cylinder + fully compacted concrete (kg)', 'number'),
      f('specified', 'Specified compacting factor', 'number'),
      TEMPC, MACHINE
    ],
    compute(h) {
      const cf = IS1199.compactingFactor(h.partial, h.full, h.empty);
      const cls = IS1199.classifyCompactingFactor(cf);
      const spec = n(h.specified);
      const summary = [
        { label: 'Mass of partially compacted concrete',
          value: fmt(n(h.partial) - (n(h.empty) || 0), 2), unit: 'kg' },
        { label: 'Mass of fully compacted concrete',
          value: fmt(n(h.full) - (n(h.empty) || 0), 2), unit: 'kg' },
        { label: 'Compacting factor', value: fmt(cf, 2), unit: '' },
        { label: 'Degree of workability (IS 456 Table 7)', value: cls, unit: '' }
      ];
      const verdict = isFinite(spec)
        ? pass(cf >= spec, 'Measured ' + fmt(cf, 2) + ' against a specified minimum of ' + fmt(spec, 2) + '.')
        : info('No specified value recorded — result reported for information.');
      return { table: null, summary: summary, verdict: verdict, notes: [] };
    }
  });

  TESTS.push({
    id: 'vee-bee',
    name: 'Vee-Bee Consistometer',
    code: 'IS 1199 (Part 2)',
    category: 'Fresh Concrete',
    header: [
      f('seconds', 'Vee-Bee time (seconds)', 'number', { required: true }),
      TEMPC, MACHINE
    ],
    compute(h) {
      const t = n(h.seconds);
      let cls = '—';
      if (isFinite(t)) {
        if (t > 20) cls = 'Extremely dry';
        else if (t > 12) cls = 'Very stiff';
        else if (t > 6) cls = 'Stiff';
        else if (t > 3) cls = 'Stiff plastic';
        else cls = 'Plastic to flowing';
      }
      return {
        table: null,
        summary: [
          { label: 'Vee-Bee degree', value: fmt(t, 1), unit: 's' },
          { label: 'Consistency', value: cls, unit: '' }
        ],
        verdict: info('Vee-Bee time recorded; compare against the mix specification.'),
        notes: ['Vee-Bee is the preferred measure for very low workability ' +
                'mixes where slump is not meaningful (IS 456 Table 7).']
      };
    }
  });

  TESTS.push({
    id: 'flow-table',
    primaryLabel: 'Flow',
    name: 'Flow Table',
    code: 'IS 1199 (Part 2) / IS 5512',
    category: 'Fresh Concrete',
    header: [
      f('baseDia', 'Initial base diameter (mm)', 'number', { def: 250 }),
      f('d1', 'Spread diameter 1 (mm)', 'number'),
      f('d2', 'Spread diameter 2 (mm)', 'number', { help: 'At right angles to d1' }),
      f('drops', 'Number of drops', 'number', { def: 15 }),
      TEMPC, MACHINE
    ],
    compute(h) {
      const d0 = n(h.baseDia) || 250;
      const avg = Num.mean([n(h.d1), n(h.d2)]);
      const flow = (avg - d0) / d0 * 100;
      return {
        table: null,
        summary: [
          { label: 'Average spread diameter', value: fmt(avg, 0), unit: 'mm' },
          { label: 'Flow', value: fmt(flow, 1), unit: '%' }
        ],
        verdict: info('Flow recorded; compare against the mix specification.'),
        notes: []
      };
    }
  });

  TESTS.push({
    id: 'fresh-density',
    primaryLabel: 'Fresh density',
    name: 'Density of Fresh Concrete',
    code: 'IS 1199 (Part 3)',
    category: 'Fresh Concrete',
    header: [
      f('volume', 'Volume of measure (litres)', 'number', { def: 15 }),
      f('empty', 'Mass of empty measure (kg)', 'number'),
      f('full', 'Mass of measure + concrete (kg)', 'number'),
      f('theoretical', 'Theoretical density from mix design (kg/m³)', 'number'),
      TEMPC, MACHINE
    ],
    compute(h) {
      const net = n(h.full) - (n(h.empty) || 0);
      const d = IS1199.freshDensity(net, n(h.volume));
      const th = n(h.theoretical);
      const summary = [
        { label: 'Net mass of concrete', value: fmt(net, 2), unit: 'kg' },
        { label: 'Fresh density', value: fmt(d, 0), unit: 'kg/m³' }
      ];
      let verdict = info('Fresh density recorded for information.');
      if (isFinite(th) && th > 0) {
        const yieldPct = d / th * 100;
        summary.push({ label: 'Theoretical density', value: fmt(th, 0), unit: 'kg/m³' });
        summary.push({ label: 'Yield', value: fmt(yieldPct, 1), unit: '%' });
        verdict = pass(Math.abs(yieldPct - 100) <= 2,
          'Measured density is ' + fmt(yieldPct, 1) + '% of the theoretical value ' +
          '(a 2% band is applied as the working tolerance).');
      }
      return { table: null, summary: summary, verdict: verdict, notes: [] };
    }
  });

  TESTS.push({
    id: 'air-content',
    primaryLabel: 'Air content of concrete',
    name: 'Air Content (Pressure Method)',
    code: 'IS 1199 (Part 3)',
    category: 'Fresh Concrete',
    header: [
      f('apparent', 'Apparent air content from gauge (%)', 'number', { required: true }),
      f('aggCorrection', 'Aggregate correction factor (%)', 'number', { def: 0 }),
      f('specifiedMin', 'Specified minimum air content (%)', 'number'),
      f('specifiedMax', 'Specified maximum air content (%)', 'number'),
      TEMPC, MACHINE
    ],
    compute(h) {
      const a = n(h.apparent), g = n(h.aggCorrection) || 0;
      const air = a - g;
      const lo = n(h.specifiedMin), hi = n(h.specifiedMax);
      const summary = [
        { label: 'Apparent air content', value: fmt(a, 1), unit: '%' },
        { label: 'Aggregate correction factor', value: fmt(g, 1), unit: '%' },
        { label: 'Air content of concrete', value: fmt(air, 1), unit: '%' }
      ];
      let verdict = info('Air content recorded for information.');
      if (isFinite(lo) || isFinite(hi)) {
        const okLo = !isFinite(lo) || air >= lo;
        const okHi = !isFinite(hi) || air <= hi;
        verdict = pass(okLo && okHi, 'Measured ' + fmt(air, 1) + '% against a specified range of ' +
          (isFinite(lo) ? fmt(lo, 1) : '—') + ' to ' + (isFinite(hi) ? fmt(hi, 1) : '—') + '%.');
      }
      return { table: null, summary: summary, verdict: verdict, notes: [] };
    }
  });

  /* =============================================================
   * HARDENED CONCRETE — IS 516 / IS 5816 / IS 13311
   * ============================================================= */

  TESTS.push({
    id: 'cube-compressive',
    primaryLabel: 'Average compressive strength',
    name: 'Compressive Strength of Concrete Cubes',
    code: 'IS 516 (Part 1/Sec 1)',
    category: 'Hardened Concrete',
    header: [
      AGE,
      f('cubeSize', 'Nominal cube size (mm)', 'select',
        { options: [150, 100], def: 150,
          help: '100 mm cubes are permitted where nominal maximum aggregate size does not exceed 20 mm' }),
      f('dateCast', 'Date cast', 'date'),
      f('dateTested', 'Date tested', 'date'),
      CURING,
      f('loadRate', 'Rate of loading (N/mm²/min)', 'number', { def: 14 }),
      MACHINE
    ],
    specimens: {
      label: 'Cube', min: 1, max: 6, def: 3,
      fields: [
        f('mark', 'Identification mark', 'text'),
        f('length', 'Measured length (mm)', 'number', { def: 150 }),
        f('width', 'Measured width (mm)', 'number', { def: 150 }),
        f('mass', 'Mass (kg)', 'number'),
        f('load', 'Failure load (kN)', 'number', { required: true }),
        f('failureType', 'Failure pattern', 'select',
          { options: ['Satisfactory', 'Unsatisfactory — see note'], def: 'Satisfactory' })
      ]
    },
    compute(h, sp, ctx) {
      const nominal = n(h.cubeSize) || 150;
      const rows = [], strengths = [], dimWarnings = [];
      /* A mistyped dimension changes the area, and therefore the strength,
         without any other visible sign. Anything more than 10 percent off
         the nominal size is almost certainly a data-entry error, so it is
         flagged rather than silently used. */
      function checkDim(value, label, mark) {
        if (isFinite(value) && Math.abs(value - nominal) / nominal > 0.10) {
          dimWarnings.push('Specimen ' + mark + ': ' + label + ' of ' + value +
            ' mm differs from the nominal ' + nominal + ' mm by more than 10 ' +
            'percent. Confirm the measurement before relying on this result.');
        }
      }
      sp.forEach((s, i) => {
        const mark = s.mark || ('C' + (i + 1));
        checkDim(n(s.length), 'length', mark);
        checkDim(n(s.width), 'width', mark);
        const L = isFinite(n(s.length)) ? n(s.length) : nominal;
        const W = isFinite(n(s.width)) ? n(s.width) : nominal;
        const area = L * W;
        const str = IS516.cubeStrength(s.load, area);
        const vol = Math.pow(nominal / 1000, 3);
        const dens = isFinite(n(s.mass)) ? IS516.density(n(s.mass), vol) : NaN;
        strengths.push(str);
        rows.push([
          s.mark || ('C' + (i + 1)),
          fmt(L, 1), fmt(W, 1), fmt(area, 0),
          isFinite(n(s.mass)) ? fmt(n(s.mass), 3) : '—',
          isFinite(dens) ? fmt(dens, 0) : '—',
          fmt(n(s.load), 1),
          fmt(str, 1)
        ]);
      });

      const res = IS516.sampleResult(strengths);
      const fck = IS456.fck(ctx.grade);
      const age = n(h.age);
      const summary = [
        { label: 'Number of specimens', value: col(strengths).length, unit: '' },
        { label: 'Average compressive strength', value: fmt(res.mean, 1), unit: 'N/mm²' },
        { label: 'Maximum deviation from the average', value: fmt(res.maxDeviationPct, 1), unit: '%' },
        { label: 'Age at test', value: fmt(age, 0), unit: 'days' }
      ];
      if (isFinite(fck)) {
        summary.push({ label: 'Specified characteristic strength, fₑₖ',
                       value: fmt(fck, 0), unit: 'N/mm²' });
      }

      const notes = [];
      let verdict;
      if (!res.valid) {
        notes.push('One or more individual specimen results differ from the ' +
          'average by more than 15 percent. Under IS 516 the result of this ' +
          'sample is not acceptable and the test should be repeated.');
        verdict = { status: 'REVIEW',
          text: 'Specimen scatter exceeds the 15 percent limit of IS 516 — the sample result is not valid.' };
      } else if (!isFinite(fck)) {
        verdict = info('No grade recorded against this job, so no acceptance check was applied.');
      } else if (age >= 27 && age <= 29) {
        const a = IS456.assessAcceptance([res.mean], ctx.grade, ctx.sigma);
        const ok = res.mean >= a.individualLimit;
        verdict = pass(ok,
          'Sample result ' + fmt(res.mean, 1) + ' N/mm² against the individual ' +
          'criterion of IS 456 Cl. 16.1 (not less than fₑₖ − ' +
          (fck >= 20 ? 4 : 3) + ' = ' + fmt(a.individualLimit, 1) + ' N/mm²).');
        notes.push('This is the individual-result criterion only. Compliance of ' +
          'the concrete also requires the mean of four non-overlapping ' +
          'consecutive samples to satisfy IS 456 Cl. 16.1 — see the job ' +
          'acceptance summary.');
      } else {
        const indicative = fck * 0.65;
        verdict = info('Tested at ' + fmt(age, 0) + ' days. IS 456 acceptance is ' +
          'assessed at 28 days; this result is reported for information.');
        if (age >= 6 && age <= 8) {
          summary.push({ label: 'Indicative 7-day expectation (65% of fₑₖ)',
                         value: fmt(indicative, 1), unit: 'N/mm²' });
          notes.push('The 65 percent figure is a widely used rule of thumb for ' +
            'early-age assessment, not a requirement of IS 456. It varies with ' +
            'cement type and should not be used to reject concrete.');
        }
      }
      dimWarnings.forEach(w => notes.push(w));
      if (sp.some(s => s.failureType && s.failureType.indexOf('Unsatisfactory') === 0)) {
        notes.push('An unsatisfactory failure pattern was recorded. IS 516 ' +
          'requires unusual failures to be noted and investigated before the ' +
          'result is relied upon.');
      }

      return {
        table: {
          headers: ['Mark', 'Length (mm)', 'Width (mm)', 'Area (mm²)',
                    'Mass (kg)', 'Density (kg/m³)', 'Load (kN)',
                    'Strength (N/mm²)'],
          rows: rows
        },
        summary: summary, verdict: verdict, notes: notes
      };
    }
  });

  TESTS.push({
    id: 'cylinder-compressive',
    name: 'Compressive Strength of Concrete Cylinders',
    code: 'IS 516 (Part 1/Sec 1)',
    category: 'Hardened Concrete',
    header: [
      AGE,
      f('dia', 'Nominal diameter (mm)', 'number', { def: 150 }),
      f('height', 'Nominal height (mm)', 'number', { def: 300 }),
      f('capping', 'Capping / end preparation', 'select',
        { options: ['Ground ends', 'Sulphur capping', 'Neoprene pads', 'None'], def: 'Ground ends' }),
      CURING, MACHINE
    ],
    specimens: {
      label: 'Cylinder', min: 1, max: 6, def: 3,
      fields: [
        f('mark', 'Identification mark', 'text'),
        f('dia', 'Measured diameter (mm)', 'number', { def: 150 }),
        f('mass', 'Mass (kg)', 'number'),
        f('load', 'Failure load (kN)', 'number', { required: true })
      ]
    },
    compute(h, sp, ctx) {
      const nomD = n(h.dia) || 150;
      const rows = [], strengths = [], dimWarnings = [];
      sp.forEach((s, i) => {
        const mark = s.mark || ('Y' + (i + 1));
        if (isFinite(n(s.dia)) && Math.abs(n(s.dia) - nomD) / nomD > 0.10) {
          dimWarnings.push('Specimen ' + mark + ': measured diameter of ' +
            n(s.dia) + ' mm differs from the nominal ' + nomD + ' mm by more ' +
            'than 10 percent. Confirm the measurement.');
        }
        const D = isFinite(n(s.dia)) ? n(s.dia) : nomD;
        const area = Math.PI * D * D / 4;
        const str = IS516.cubeStrength(s.load, area);
        strengths.push(str);
        rows.push([s.mark || ('Y' + (i + 1)), fmt(D, 1), fmt(area, 0),
                   fmt(n(s.load), 1), fmt(str, 1)]);
      });
      const res = IS516.sampleResult(strengths);
      /* IS 516 / IS 456 treat the 150x300 cylinder as about 0.8 of the
         equivalent cube strength. */
      const equivCube = isFinite(res.mean) ? Num.toStep(res.mean / 0.8, 0.5) : NaN;
      return {
        table: { headers: ['Mark', 'Diameter (mm)', 'Area (mm²)', 'Load (kN)',
                           'Strength (N/mm²)'], rows: rows },
        summary: [
          { label: 'Average cylinder strength', value: fmt(res.mean, 1), unit: 'N/mm²' },
          { label: 'Equivalent cube strength (cylinder ÷ 0.8)', value: fmt(equivCube, 1), unit: 'N/mm²' },
          { label: 'Maximum deviation from the average', value: fmt(res.maxDeviationPct, 1), unit: '%' }
        ],
        verdict: res.valid
          ? info('Cylinder strength recorded. The 0.8 cylinder-to-cube ratio is ' +
                 'an accepted approximation, not a measured conversion.')
          : { status: 'REVIEW', text: 'Specimen scatter exceeds 15 percent — the sample result is not valid under IS 516.' },
        notes: dimWarnings
      };
    }
  });

  TESTS.push({
    id: 'core-compressive',
    name: 'Compressive Strength of Drilled Cores',
    code: 'IS 516 (Part 4)',
    category: 'Hardened Concrete',
    header: [
      f('location', 'Location of core in structure', 'text'),
      f('dateDrilled', 'Date cored', 'date'),
      f('condition', 'Condition at test', 'select',
        { options: ['Soaked 48 h before test', 'As received', 'Air dried'],
          def: 'Soaked 48 h before test' }),
      MACHINE
    ],
    specimens: {
      label: 'Core', min: 1, max: 6, def: 3,
      fields: [
        f('mark', 'Core reference', 'text'),
        f('dia', 'Diameter (mm)', 'number', { required: true }),
        f('height', 'Height after trimming (mm)', 'number', { required: true }),
        f('mass', 'Mass (kg)', 'number'),
        f('load', 'Failure load (kN)', 'number', { required: true }),
        f('rebar', 'Reinforcement present', 'select', { options: ['No', 'Yes'], def: 'No' })
      ]
    },
    compute(h, sp) {
      /* Length-to-diameter correction, IS 516 (Part 4). Interpolated
         linearly between the tabulated points 2.00, 1.75, 1.50, 1.25, 1.00. */
      const pts = [[1.00, 0.87], [1.25, 0.93], [1.50, 0.96], [1.75, 0.98], [2.00, 1.00]];
      function corrFactor(ratio) {
        if (!isFinite(ratio)) return NaN;
        if (ratio >= 2) return 1.00;
        if (ratio <= 1) return 0.87;
        for (let i = 0; i < pts.length - 1; i++) {
          if (ratio >= pts[i][0] && ratio <= pts[i + 1][0]) {
            const t = (ratio - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
            return Num.dp(pts[i][1] + t * (pts[i + 1][1] - pts[i][1]), 3);
          }
        }
        return NaN;
      }
      const rows = [], equivs = [];
      let hasRebar = false;
      sp.forEach((s, i) => {
        const D = n(s.dia), H = n(s.height);
        const area = Math.PI * D * D / 4;
        const raw = (n(s.load) * 1000) / area;
        const ratio = H / D;
        const cf = corrFactor(ratio);
        const corrected = raw * cf;
        /* Corrected core strength is a cylinder strength; the equivalent
           cube strength is conventionally taken as 1.25 times that. */
        const equiv = corrected * 1.25;
        equivs.push(equiv);
        if (s.rebar === 'Yes') hasRebar = true;
        rows.push([s.mark || ('K' + (i + 1)), fmt(D, 1), fmt(H, 1), fmt(ratio, 2),
                   fmt(n(s.load), 1), fmt(raw, 1), fmt(cf, 3), fmt(corrected, 1), fmt(equiv, 1)]);
      });
      const avg = Num.mean(col(equivs));
      const notes = ['The correction factor is interpolated from the ' +
        'length-to-diameter table of IS 516 (Part 4). The equivalent cube ' +
        'strength is taken as 1.25 times the corrected core strength.'];
      if (hasRebar) {
        notes.push('Reinforcement was present in at least one core. IS 516 ' +
          '(Part 4) advises that cores containing reinforcement should be ' +
          'avoided; results from such cores are reported with reservation.');
      }
      return {
        table: {
          headers: ['Core', 'Dia (mm)', 'Height (mm)', 'H/D', 'Load (kN)',
                    'Measured (N/mm²)', 'Correction', 'Corrected (N/mm²)',
                    'Equiv. cube (N/mm²)'],
          rows: rows
        },
        summary: [
          { label: 'Average equivalent cube strength', value: fmt(avg, 1), unit: 'N/mm²' },
          { label: 'Number of cores', value: col(equivs).length, unit: '' }
        ],
        verdict: info('Core results assess concrete in the structure and are not ' +
          'a substitute for the cube acceptance criteria of IS 456 Cl. 16.'),
        notes: notes
      };
    }
  });

  TESTS.push({
    id: 'flexural-strength',
    name: 'Flexural Strength (Modulus of Rupture)',
    code: 'IS 516 (Part 1/Sec 1)',
    category: 'Hardened Concrete',
    header: [
      AGE,
      f('span', 'Effective span (mm)', 'select',
        { options: [600, 400], def: 600,
          help: '600 mm for 150 mm beams, 400 mm for 100 mm beams' }),
      f('loading', 'Loading arrangement', 'select',
        { options: ['Two-point (third-point) loading'], def: 'Two-point (third-point) loading' }),
      CURING, MACHINE
    ],
    specimens: {
      label: 'Beam', min: 1, max: 6, def: 3,
      fields: [
        f('mark', 'Identification mark', 'text'),
        f('width', 'Measured width b (mm)', 'number', { def: 150 }),
        f('depth', 'Measured depth d (mm)', 'number', { def: 150 }),
        f('load', 'Failure load (kN)', 'number', { required: true }),
        f('a', 'Distance a, fracture to nearer support (mm)', 'number')
      ]
    },
    compute(h, sp, ctx) {
      const span = n(h.span) || 600;
      const rows = [], vals = [], notes = [];
      sp.forEach((s, i) => {
        const r = IS516.flexuralStrength(s.load, span, s.width, s.depth, s.a);
        if (r.valid && isFinite(r.value)) vals.push(r.value);
        if (!r.valid) notes.push('Beam ' + (s.mark || i + 1) + ': ' + r.note);
        rows.push([s.mark || ('B' + (i + 1)), fmt(n(s.width), 1), fmt(n(s.depth), 1),
                   fmt(n(s.load), 2), isFinite(n(s.a)) ? fmt(n(s.a), 0) : '—',
                   r.formula, r.valid ? fmt(r.value, 2) : 'Discarded']);
      });
      const avg = Num.mean(vals);
      const fck = IS456.fck(ctx.grade);
      const summary = [
        { label: 'Average flexural strength', value: fmt(avg, 2), unit: 'N/mm²' },
        { label: 'Valid specimens', value: vals.length + ' of ' + sp.length, unit: '' }
      ];
      let verdict = info('Flexural strength recorded.');
      if (isFinite(fck)) {
        const expected = IS456.flexuralStrengthExpected(fck);
        summary.push({ label: 'Value expected from IS 456 Cl. 6.2.2 (0.7√fₑₖ)',
                       value: fmt(expected, 2), unit: 'N/mm²' });
        verdict = pass(avg >= expected,
          'Measured ' + fmt(avg, 2) + ' N/mm² against the IS 456 Cl. 6.2.2 ' +
          'expectation of ' + fmt(expected, 2) + ' N/mm² for ' + ctx.grade + '.');
        notes.push('IS 456 Cl. 6.2.2 gives fcr = 0.7√fₑₖ as the flexural ' +
          'strength assumed for design. It is a design assumption rather than ' +
          'an acceptance limit, and a shortfall should be read alongside the ' +
          'compressive strength results.');
      }
      return {
        table: {
          headers: ['Beam', 'b (mm)', 'd (mm)', 'Load (kN)', 'a (mm)',
                    'Formula', 'fb (N/mm²)'],
          rows: rows
        },
        summary: summary, verdict: verdict, notes: notes
      };
    }
  });

  TESTS.push({
    id: 'split-tensile',
    name: 'Splitting Tensile Strength',
    code: 'IS 5816:1999',
    category: 'Hardened Concrete',
    header: [AGE, CURING, MACHINE],
    specimens: {
      label: 'Cylinder', min: 1, max: 6, def: 3,
      fields: [
        f('mark', 'Identification mark', 'text'),
        f('dia', 'Diameter D (mm)', 'number', { def: 150 }),
        f('length', 'Length L (mm)', 'number', { def: 300 }),
        f('load', 'Failure load (kN)', 'number', { required: true })
      ]
    },
    compute(h, sp) {
      const rows = [], vals = [];
      sp.forEach((s, i) => {
        const v = IS5816.splitTensile(s.load, s.length, s.dia);
        if (isFinite(v)) vals.push(v);
        rows.push([s.mark || ('T' + (i + 1)), fmt(n(s.dia), 1), fmt(n(s.length), 1),
                   fmt(n(s.load), 1), fmt(v, 2)]);
      });
      return {
        table: { headers: ['Mark', 'D (mm)', 'L (mm)', 'Load (kN)',
                           'fct (N/mm²)'], rows: rows },
        summary: [
          { label: 'Average splitting tensile strength', value: fmt(Num.mean(vals), 2), unit: 'N/mm²' },
          { label: 'Number of specimens', value: vals.length, unit: '' }
        ],
        verdict: info('Splitting tensile strength calculated as fct = 2P / πLD per IS 5816.'),
        notes: []
      };
    }
  });

  TESTS.push({
    id: 'modulus-elasticity',
    name: 'Static Modulus of Elasticity',
    code: 'IS 516 (Part 1/Sec 1)',
    category: 'Hardened Concrete',
    header: [
      AGE,
      f('dia', 'Specimen diameter (mm)', 'number', { def: 150 }),
      f('height', 'Specimen height (mm)', 'number', { def: 300 }),
      f('gauge', 'Gauge length (mm)', 'number', { def: 200 }),
      f('stress1', 'Lower stress σ₁ (N/mm²)', 'number'),
      f('strain1', 'Strain at σ₁', 'number', { help: 'As a decimal, e.g. 0.000050' }),
      f('stress2', 'Upper stress σ₂ (N/mm²)', 'number'),
      f('strain2', 'Strain at σ₂', 'number'),
      MACHINE
    ],
    compute(h, sp, ctx) {
      const E = IS516.staticModulus(h.stress1, h.strain1, h.stress2, h.strain2);
      const fck = IS456.fck(ctx.grade);
      const summary = [
        { label: 'Measured static modulus', value: fmt(E / 1000, 2), unit: 'kN/mm²' },
        { label: 'Measured static modulus', value: fmt(E, 0), unit: 'N/mm²' }
      ];
      let verdict = info('Secant modulus calculated between the two recorded stress points.');
      if (isFinite(fck)) {
        const design = IS456.modulusOfElasticity(fck);
        summary.push({ label: 'Design value from IS 456 Cl. 6.2.3.1 (5000√fₑₖ)',
                       value: fmt(design, 0), unit: 'N/mm²' });
        const ratio = E / design * 100;
        summary.push({ label: 'Measured as a percentage of the design value',
                       value: fmt(ratio, 1), unit: '%' });
        verdict = info('IS 456 notes that the actual measured modulus may differ ' +
          'from 5000√fₑₖ by up to about 20 percent; the formula is a design ' +
          'assumption, not an acceptance limit.');
      }
      return { table: null, summary: summary, verdict: verdict, notes: [] };
    }
  });

  TESTS.push({
    id: 'hardened-density',
    name: 'Density of Hardened Concrete',
    code: 'IS 516 (Part 1/Sec 1)',
    category: 'Hardened Concrete',
    header: [AGE, CURING, MACHINE],
    specimens: {
      label: 'Specimen', min: 1, max: 6, def: 3,
      fields: [
        f('mark', 'Identification mark', 'text'),
        f('mass', 'Mass in air (kg)', 'number', { required: true }),
        f('size', 'Nominal cube size (mm)', 'number', { def: 150 })
      ]
    },
    compute(h, sp) {
      const rows = [], vals = [];
      sp.forEach((s, i) => {
        const size = n(s.size) || 150;
        const vol = Math.pow(size / 1000, 3);
        const d = IS516.density(n(s.mass), vol);
        if (isFinite(d)) vals.push(d);
        rows.push([s.mark || ('D' + (i + 1)), fmt(size, 0), fmt(n(s.mass), 3),
                   vol.toExponential(3), fmt(d, 0)]);
      });
      return {
        table: { headers: ['Mark', 'Size (mm)', 'Mass (kg)', 'Volume (m³)',
                           'Density (kg/m³)'], rows: rows },
        summary: [{ label: 'Average density', value: fmt(Num.mean(vals), 0), unit: 'kg/m³' }],
        verdict: info('Density recorded for information.'),
        notes: []
      };
    }
  });

  TESTS.push({
    id: 'rebound-hammer',
    primaryLabel: 'Average rebound number (after discard)',
    name: 'Rebound Hammer (Non-Destructive)',
    code: 'IS 13311 (Part 2)',
    category: 'Hardened Concrete',
    header: [
      f('location', 'Test location / member', 'text'),
      f('orientation', 'Hammer orientation', 'select',
        { options: ['Horizontal', 'Vertically downward', 'Vertically upward',
                    'Inclined downward', 'Inclined upward'], def: 'Horizontal' }),
      f('surface', 'Surface condition', 'select',
        { options: ['Dry and smooth', 'Dry and rough', 'Damp'], def: 'Dry and smooth' }),
      f('readings', 'Rebound numbers', 'list',
        { def: 12, help: 'IS 13311 requires at least 12 readings per test location' }),
      f('correlation', 'Strength from the machine correlation curve (N/mm²)', 'number'),
      MACHINE
    ],
    compute(h) {
      const vals = (h.readings || []).map(n).filter(isFinite);
      const avg = Num.mean(vals);
      const sd = Num.stdDev(vals);
      /* IS 13311 Part 2: discard readings differing from the average by
         more than 6 units and recompute. */
      const kept = vals.filter(v => Math.abs(v - avg) <= 6);
      const adjAvg = Num.mean(kept);
      let quality = '—';
      if (isFinite(adjAvg)) {
        if (adjAvg > 40) quality = 'Very good hard layer';
        else if (adjAvg > 30) quality = 'Good layer';
        else if (adjAvg > 20) quality = 'Fair';
        else if (adjAvg > 10) quality = 'Poor concrete';
        else quality = 'Delaminated';
      }
      const notes = ['Rebound number reflects the surface layer only. IS 13311 ' +
        '(Part 2) states that the method is not a substitute for compressive ' +
        'strength testing and should be correlated against cores or cubes from ' +
        'the same concrete before strength is inferred.'];
      if (vals.length < 12) {
        notes.push('Only ' + vals.length + ' readings recorded. IS 13311 (Part 2) ' +
          'requires a minimum of 12 readings at each test location.');
      }
      if (kept.length < vals.length) {
        notes.push((vals.length - kept.length) + ' reading(s) differing from the ' +
          'average by more than 6 units were discarded and the average recomputed, ' +
          'as required by IS 13311 (Part 2).');
      }
      return {
        table: null,
        summary: [
          { label: 'Readings taken', value: vals.length, unit: '' },
          { label: 'Average rebound number (all readings)', value: fmt(avg, 1), unit: '' },
          { label: 'Average rebound number (after discard)', value: fmt(adjAvg, 1), unit: '' },
          { label: 'Standard deviation', value: fmt(sd, 2), unit: '' },
          { label: 'Concrete quality (IS 13311 Part 2)', value: quality, unit: '' },
          { label: 'Strength from correlation curve',
            value: isFinite(n(h.correlation)) ? fmt(n(h.correlation), 1) : '—',
            unit: 'N/mm²' }
        ],
        verdict: info('Non-destructive indication of surface hardness; see notes.'),
        notes: notes
      };
    }
  });

  TESTS.push({
    id: 'upv',
    primaryLabel: 'Mean pulse velocity',
    name: 'Ultrasonic Pulse Velocity (Non-Destructive)',
    code: 'IS 13311 (Part 1)',
    category: 'Hardened Concrete',
    header: [
      f('location', 'Test location / member', 'text'),
      f('method', 'Transducer arrangement', 'select',
        { options: ['Direct (opposite faces)', 'Semi-direct', 'Indirect (surface)'],
          def: 'Direct (opposite faces)' }),
      f('path', 'Path length (mm)', 'number', { required: true }),
      f('readings', 'Transit times (microseconds)', 'list', { def: 3 }),
      MACHINE
    ],
    compute(h) {
      const path = n(h.path);
      const times = (h.readings || []).map(n).filter(isFinite);
      const vels = times.map(t => path / t);          /* mm/us == km/s */
      const v = Num.mean(vels);
      let grade = '—';
      if (isFinite(v)) {
        if (v > 4.5) grade = 'Excellent';
        else if (v >= 3.5) grade = 'Good';
        else if (v >= 3.0) grade = 'Medium';
        else grade = 'Doubtful';
      }
      const notes = ['Velocity criteria are those of IS 13311 (Part 1). ' +
        'A "Doubtful" result calls for further investigation rather than ' +
        'immediate rejection.'];
      if (h.method && h.method.indexOf('Indirect') === 0) {
        notes.push('Indirect transmission gives velocities typically some ' +
          '5 to 20 percent lower than direct transmission and should not be ' +
          'graded against the direct-transmission criteria without correction.');
      }
      return {
        table: {
          headers: ['Reading', 'Transit time (µs)', 'Velocity (km/s)'],
          rows: times.map((t, i) => [i + 1, fmt(t, 1), fmt(path / t, 3)])
        },
        summary: [
          { label: 'Path length', value: fmt(path, 0), unit: 'mm' },
          { label: 'Mean transit time', value: fmt(Num.mean(times), 1), unit: 'µs' },
          { label: 'Mean pulse velocity', value: fmt(v, 3), unit: 'km/s' },
          { label: 'Concrete quality grading (IS 13311 Part 1)', value: grade, unit: '' }
        ],
        verdict: info('Pulse velocity indicates homogeneity and the presence of ' +
          'voids or cracking; it is not a direct measure of strength.'),
        notes: notes
      };
    }
  });

  /* Registry is accumulated across tests.js and tests-materials.js in
     script load order. */
  root.TEST_REGISTRY = (root.TEST_REGISTRY || []).concat(TESTS);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.TEST_REGISTRY;
  }

})(typeof window !== 'undefined' ? window : globalThis);
