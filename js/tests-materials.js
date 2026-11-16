/*
 * tests-materials.js — durability, cement and aggregate tests
 * -----------------------------------------------------------
 * Same entry shape as tests.js; this file appends to the shared
 * TEST_REGISTRY. Load it after tests.js.
 */

'use strict';

(function (root) {

  const S = (typeof require !== 'undefined' && typeof window === 'undefined')
    ? require('./standards.js') : root;

  const Num = S.Num, IS456 = S.IS456, Durability = S.Durability,
        IS4031 = S.IS4031, IS2386 = S.IS2386;

  function f(k, label, type, o) {
    return Object.assign({ k: k, label: label, type: type || 'number' }, o || {});
  }
  function n(v) { const x = parseFloat(v); return isFinite(x) ? x : NaN; }
  function fmt(v, dp) { return isFinite(v) ? Num.dp(v, dp === undefined ? 2 : dp) : '—'; }
  function pass(ok, text) { return { status: ok ? 'PASS' : 'FAIL', text: text }; }
  function info(text) { return { status: 'INFO', text: text }; }
  const MACHINE = f('machine', 'Testing machine / equipment ID', 'text');

  const TESTS = [];

  /* =============================================================
   * DURABILITY AND PERMEABILITY
   * ============================================================= */

  TESTS.push({
    id: 'rcpt',
    primaryLabel: 'Charge passed (normalised to 95 mm dia)',
    name: 'Rapid Chloride Permeability Test',
    code: 'ASTM C1202 / IS 516 (Part 2/Sec 1)',
    category: 'Durability',
    header: [
      f('age', 'Age at test (days)', 'number', { def: 28 }),
      f('dia', 'Specimen diameter (mm)', 'number', { def: 100,
        help: 'Results are normalised to the 95 mm reference diameter' }),
      f('thickness', 'Specimen thickness (mm)', 'number', { def: 50 }),
      f('voltage', 'Applied voltage (V DC)', 'number', { def: 60 }),
      f('catholyte', 'Catholyte', 'text', { def: '3.0% NaCl solution' }),
      f('anolyte', 'Anolyte', 'text', { def: '0.3 N NaOH solution' }),
      f('readings', 'Current readings at 30 min intervals (mA)', 'list',
        { def: 13, help: '13 readings from 0 to 360 minutes' }),
      f('specLimit', 'Specified maximum charge passed (coulombs)', 'number'),
      MACHINE
    ],
    compute(h) {
      const r = Durability.rcptCharge(h.readings || [], h.dia);
      const lim = n(h.specLimit);
      const summary = [
        { label: 'Readings used', value: r.readingCount || 0, unit: '' },
        { label: 'Charge passed (as measured)', value: fmt(r.charge, 0), unit: 'coulombs' },
        { label: 'Charge passed (normalised to 95 mm dia)', value: fmt(r.normalised, 0), unit: 'coulombs' },
        { label: 'Chloride ion penetrability (ASTM C1202)', value: r.rating, unit: '' }
      ];
      const notes = ['Charge passed is integrated by the trapezoidal rule over ' +
        'the six hour test: Q = 900 × (I₀ + 2I₃₀ + … + 2I₃₃₀ + I₃₆₀), ' +
        'with currents in amperes.'];
      if (isFinite(n(h.dia)) && Math.abs(n(h.dia) - 95) > 0.5) {
        notes.push('Specimen diameter of ' + fmt(n(h.dia), 0) + ' mm differs from ' +
          'the 95 mm reference, so the charge has been scaled by (95/d)² as ' +
          'ASTM C1202 directs.');
      }
      notes.push('RCPT measures electrical conductance, which is influenced by ' +
        'the pore solution chemistry as well as the pore structure. Mixes ' +
        'containing silica fume, slag or calcium nitrite may give results that ' +
        'understate or overstate chloride resistance; RCMT is the more direct ' +
        'measure where this matters.');
      const verdict = isFinite(lim)
        ? pass(r.normalised <= lim, 'Normalised charge of ' + fmt(r.normalised, 0) +
            ' C against a specified maximum of ' + fmt(lim, 0) + ' C.')
        : info('Classified as "' + r.rating + '" penetrability under ASTM C1202 Table 1.');
      return { table: null, summary: summary, verdict: verdict, notes: notes };
    }
  });

  TESTS.push({
    id: 'rcmt',
    primaryLabel: 'Migration coefficient D\u2099\u209b\u209b\u2098',
    name: 'Rapid Chloride Migration Test',
    code: 'NT Build 492',
    category: 'Durability',
    header: [
      f('age', 'Age at test (days)', 'number', { def: 28 }),
      f('voltage', 'Applied voltage U (V)', 'number', { def: 30, required: true }),
      f('duration', 'Test duration t (hours)', 'number', { def: 24, required: true }),
      f('tempInit', 'Initial anolyte temperature (°C)', 'number'),
      f('tempFinal', 'Final anolyte temperature (°C)', 'number'),
      f('thickness', 'Specimen thickness L (mm)', 'number', { def: 50, required: true }),
      f('depths', 'Chloride penetration depths (mm)', 'list',
        { def: 7, help: 'Measured at 10 mm intervals across the split face' }),
      f('specLimit', 'Specified maximum Dₙₛₛₘ (×10⁻¹² m²/s)', 'number'),
      MACHINE
    ],
    compute(h) {
      const depths = (h.depths || []).map(n).filter(isFinite);
      const xd = Num.mean(depths);
      const T = Num.mean([n(h.tempInit), n(h.tempFinal)]);
      const r = Durability.rcmtCoefficient(h.voltage, T, h.thickness, xd, h.duration);
      const lim = n(h.specLimit);
      const summary = [
        { label: 'Applied voltage', value: fmt(n(h.voltage), 0), unit: 'V' },
        { label: 'Test duration', value: fmt(n(h.duration), 1), unit: 'h' },
        { label: 'Average anolyte temperature', value: fmt(T, 1), unit: '°C' },
        { label: 'Average penetration depth xₑ', value: fmt(xd, 1), unit: 'mm' },
        { label: 'Migration coefficient Dₙₛₛₘ', value: fmt(r.value, 2),
          unit: '×10⁻¹² m²/s' },
        { label: 'Indicative chloride resistance', value: r.rating, unit: '' }
      ];
      const notes = ['Calculated by the NT Build 492 expression for the ' +
        'non-steady-state migration coefficient.',
        'The resistance bands are industry convention rather than part of ' +
        'NT Build 492 itself and are reported as guidance only.'];
      const verdict = isFinite(lim)
        ? pass(r.value <= lim, 'Dₙₛₛₘ of ' + fmt(r.value, 2) +
            ' against a specified maximum of ' + fmt(lim, 2) + ' ×10⁻¹² m²/s.')
        : info('Migration coefficient reported for information.');
      return {
        table: {
          headers: ['Measurement point', 'Penetration depth (mm)'],
          rows: depths.map((d, i) => [i + 1, fmt(d, 1)])
        },
        summary: summary, verdict: verdict, notes: notes
      };
    }
  });

  TESTS.push({
    id: 'water-penetration',
    primaryLabel: 'Maximum depth of penetration',
    name: 'Depth of Penetration of Water Under Pressure',
    code: 'DIN 1048 (Part 5) / IS 516 (Part 2/Sec 1)',
    category: 'Durability',
    header: [
      f('age', 'Age at test (days)', 'number', { def: 28 }),
      f('pressure', 'Applied water pressure (N/mm²)', 'number', { def: 0.5 }),
      f('duration', 'Duration under pressure (hours)', 'number', { def: 72 }),
      f('depths', 'Maximum wetted depth on each split specimen (mm)', 'list', { def: 3 }),
      f('specLimit', 'Specified maximum depth (mm)', 'number', { def: 25 }),
      MACHINE
    ],
    compute(h) {
      const r = Durability.waterPenetration(h.depths || [], h.specLimit);
      return {
        table: {
          headers: ['Specimen', 'Depth of penetration (mm)'],
          rows: (h.depths || []).map((d, i) => [i + 1, fmt(n(d), 1)])
        },
        summary: [
          { label: 'Applied pressure', value: fmt(n(h.pressure), 2), unit: 'N/mm²' },
          { label: 'Duration', value: fmt(n(h.duration), 0), unit: 'h' },
          { label: 'Mean depth of penetration', value: fmt(r.mean, 1), unit: 'mm' },
          { label: 'Maximum depth of penetration', value: fmt(r.max, 1), unit: 'mm' },
          { label: 'Specified maximum', value: fmt(r.limit, 1), unit: 'mm' }
        ],
        verdict: pass(r.pass, 'Maximum penetration of ' + fmt(r.max, 1) +
          ' mm against a specified limit of ' + fmt(r.limit, 1) + ' mm.'),
        notes: ['The maximum depth, not the mean, governs acceptance.']
      };
    }
  });

  TESTS.push({
    id: 'water-absorption',
    name: 'Water Absorption of Hardened Concrete',
    code: 'IS 516 (Part 2/Sec 1) / ASTM C642',
    category: 'Durability',
    header: [
      f('age', 'Age at test (days)', 'number', { def: 28 }),
      f('specLimit', 'Specified maximum absorption (%)', 'number'),
      MACHINE
    ],
    specimens: {
      label: 'Specimen', min: 1, max: 6, def: 3,
      fields: [
        f('mark', 'Identification mark', 'text'),
        f('dry', 'Oven-dry mass (g)', 'number', { required: true }),
        f('sat', 'Saturated surface-dry mass (g)', 'number', { required: true })
      ]
    },
    compute(h, sp) {
      const rows = [], vals = [];
      sp.forEach((s, i) => {
        const a = Durability.waterAbsorption(s.sat, s.dry);
        if (isFinite(a)) vals.push(a);
        rows.push([s.mark || (i + 1), fmt(n(s.dry), 1), fmt(n(s.sat), 1), fmt(a, 2)]);
      });
      const avg = Num.mean(vals);
      const lim = n(h.specLimit);
      return {
        table: { headers: ['Specimen', 'Oven-dry mass (g)', 'SSD mass (g)',
                           'Absorption (%)'], rows: rows },
        summary: [{ label: 'Average water absorption', value: fmt(avg, 2), unit: '%' }],
        verdict: isFinite(lim)
          ? pass(avg <= lim, 'Average absorption of ' + fmt(avg, 2) +
              '% against a specified maximum of ' + fmt(lim, 2) + '%.')
          : info('Water absorption reported for information.'),
        notes: []
      };
    }
  });

  TESTS.push({
    id: 'permeability-coefficient',
    primaryLabel: 'Coefficient of permeability k',
    name: 'Coefficient of Permeability',
    code: 'IS 3085',
    category: 'Durability',
    header: [
      f('age', 'Age at test (days)', 'number', { def: 28 }),
      f('flow', 'Quantity of water percolated Q (ml)', 'number', { required: true }),
      f('thickness', 'Specimen thickness L (mm)', 'number', { required: true }),
      f('area', 'Cross-sectional area A (mm²)', 'number', { required: true }),
      f('head', 'Hydraulic head h (m of water)', 'number', { required: true }),
      f('duration', 'Duration t (hours)', 'number', { required: true }),
      MACHINE
    ],
    compute(h) {
      const Q = n(h.flow) * 1e-6;             /* ml -> m3 */
      const L = n(h.thickness) / 1000;        /* mm -> m  */
      const A = n(h.area) / 1e6;              /* mm2 -> m2 */
      const t = n(h.duration) * 3600;         /* h -> s   */
      const k = Durability.coefficientOfPermeability(Q, L, A, n(h.head), t);
      let band = '—';
      if (isFinite(k)) {
        if (k > 1e-9) band = 'Permeable';
        else if (k > 1e-11) band = 'Moderately impermeable';
        else band = 'Impermeable for practical purposes';
      }
      return {
        table: null,
        summary: [
          { label: 'Water percolated', value: fmt(n(h.flow), 1), unit: 'ml' },
          { label: 'Coefficient of permeability k',
            value: isFinite(k) ? k.toExponential(2) : '—', unit: 'm/s' },
          { label: 'Indicative classification', value: band, unit: '' }
        ],
        verdict: info('Calculated from Darcy’s law, k = QL / (Aht).'),
        notes: ['The classification bands are indicative working ranges, not ' +
                'limits set by IS 3085.']
      };
    }
  });

  /* =============================================================
   * CEMENT — IS 4031
   * ============================================================= */

  const CEMENT_TYPE = f('cementType', 'Cement type', 'select', {
    options: ['OPC 33', 'OPC 43', 'OPC 53', 'PPC', 'PSC'], def: 'OPC 53'
  });
  const CEMENT_ID = [
    f('brand', 'Brand / manufacturer', 'text'),
    CEMENT_TYPE,
    f('lot', 'Lot or batch number', 'text'),
    f('mfgDate', 'Date of manufacture', 'date')
  ];

  TESTS.push({
    id: 'cement-fineness-sieve',
    name: 'Fineness of Cement by Dry Sieving',
    code: 'IS 4031 (Part 1)',
    category: 'Cement',
    header: CEMENT_ID.concat([
      f('sieve', 'Sieve', 'text', { def: '90 micron IS sieve' }), MACHINE
    ]),
    specimens: {
      label: 'Trial', min: 1, max: 3, def: 3,
      fields: [
        f('total', 'Mass of sample taken (g)', 'number', { def: 100, required: true }),
        f('retained', 'Mass retained on sieve (g)', 'number', { required: true })
      ]
    },
    compute(h, sp) {
      const rows = [], vals = [];
      sp.forEach((s, i) => {
        const v = IS4031.finenessBySieving(s.retained, s.total);
        if (isFinite(v)) vals.push(v);
        rows.push([i + 1, fmt(n(s.total), 1), fmt(n(s.retained), 2), fmt(v, 2)]);
      });
      const avg = Num.mean(vals);
      const lim = IS4031.LIMITS.finenessRetained90um.max;
      return {
        table: { headers: ['Trial', 'Sample (g)', 'Retained (g)', 'Retained (%)'], rows: rows },
        summary: [
          { label: 'Average residue on the 90 micron sieve', value: fmt(avg, 2), unit: '%' },
          { label: 'Permissible maximum', value: lim, unit: '%' }
        ],
        verdict: pass(avg <= lim, 'Residue of ' + fmt(avg, 2) +
          '% against a maximum of ' + lim + '% for ordinary Portland cement.'),
        notes: ['The 10 percent limit applies to OPC. Blended cements are ' +
                'governed by their own specifications — confirm the limit for ' +
                (h.cementType || 'the cement type tested') + '.']
      };
    }
  });

  TESTS.push({
    id: 'cement-consistency',
    primaryLabel: 'Standard consistency, P',
    name: 'Standard Consistency of Cement Paste',
    code: 'IS 4031 (Part 4)',
    category: 'Cement',
    header: CEMENT_ID.concat([MACHINE]),
    specimens: {
      label: 'Trial', min: 1, max: 6, def: 3,
      fields: [
        f('cement', 'Mass of cement (g)', 'number', { def: 400 }),
        f('water', 'Water added (g)', 'number', { required: true }),
        f('penetration', 'Vicat plunger penetration from bottom (mm)', 'number', { required: true })
      ]
    },
    compute(h, sp) {
      const rows = [];
      let standard = NaN;
      sp.forEach((s, i) => {
        const pct = n(s.water) / n(s.cement) * 100;
        const pen = n(s.penetration);
        const ok = pen >= 5 && pen <= 7;
        if (ok && !isFinite(standard)) standard = pct;
        rows.push([i + 1, fmt(n(s.cement), 0), fmt(n(s.water), 1), fmt(pct, 1),
                   fmt(pen, 1), ok ? 'Yes' : 'No']);
      });
      return {
        table: {
          headers: ['Trial', 'Cement (g)', 'Water (g)', 'Water (%)',
                    'Penetration (mm)', 'Within 5–7 mm'],
          rows: rows
        },
        summary: [{ label: 'Standard consistency, P', value: fmt(standard, 1), unit: '%' }],
        verdict: isFinite(standard)
          ? info('Standard consistency is the water content at which the Vicat ' +
                 'plunger settles 5 to 7 mm from the bottom of the mould.')
          : { status: 'REVIEW', text: 'No trial achieved a penetration in the 5 to 7 mm band — repeat with adjusted water contents.' },
        notes: []
      };
    }
  });

  TESTS.push({
    id: 'cement-setting-time',
    name: 'Initial and Final Setting Time',
    code: 'IS 4031 (Part 5)',
    category: 'Cement',
    header: CEMENT_ID.concat([
      f('consistency', 'Standard consistency P (%)', 'number'),
      f('waterUsed', 'Water used, 0.85P (%)', 'number'),
      f('initial', 'Initial setting time (minutes)', 'number', { required: true }),
      f('final', 'Final setting time (minutes)', 'number', { required: true }),
      f('tempC', 'Test temperature (°C)', 'number', { def: 27 }),
      f('humidity', 'Relative humidity (%)', 'number', { def: 90 }),
      MACHINE
    ]),
    compute(h) {
      const i = n(h.initial), fi = n(h.final);
      const li = IS4031.LIMITS.initialSetting.min, lf = IS4031.LIMITS.finalSetting.max;
      const okI = i >= li, okF = fi <= lf;
      return {
        table: null,
        summary: [
          { label: 'Initial setting time', value: fmt(i, 0), unit: 'min' },
          { label: 'Minimum permitted', value: li, unit: 'min' },
          { label: 'Final setting time', value: fmt(fi, 0), unit: 'min' },
          { label: 'Maximum permitted', value: lf, unit: 'min' }
        ],
        verdict: pass(okI && okF,
          'Initial ' + fmt(i, 0) + ' min (minimum ' + li + ') and final ' +
          fmt(fi, 0) + ' min (maximum ' + lf + ').'),
        notes: ['Setting times are sensitive to temperature and humidity; ' +
                'IS 4031 (Part 5) requires 27 ± 2 °C and not less than ' +
                '90 percent relative humidity.']
      };
    }
  });

  TESTS.push({
    id: 'cement-soundness',
    name: 'Soundness of Cement',
    code: 'IS 4031 (Part 3)',
    category: 'Cement',
    header: CEMENT_ID.concat([
      f('method', 'Method', 'select',
        { options: ['Le Chatelier expansion', 'Autoclave expansion'],
          def: 'Le Chatelier expansion' }),
      MACHINE
    ]),
    specimens: {
      label: 'Specimen', min: 1, max: 3, def: 2,
      fields: [
        f('before', 'Distance between indicator points before (mm)', 'number'),
        f('after', 'Distance after immersion / autoclaving (mm)', 'number')
      ]
    },
    compute(h, sp) {
      const auto = h.method === 'Autoclave expansion';
      const rows = [], vals = [];
      sp.forEach((s, i) => {
        const before = n(s.before), after = n(s.after);
        const v = auto ? (after - before) / before * 100 : after - before;
        if (isFinite(v)) vals.push(v);
        rows.push([i + 1, fmt(before, 2), fmt(after, 2), fmt(v, 2)]);
      });
      const avg = Num.mean(vals);
      const lim = auto ? IS4031.LIMITS.soundnessAutoclave.max
                       : IS4031.LIMITS.soundnessLeChatelier.max;
      const unit = auto ? '%' : 'mm';
      return {
        table: {
          headers: ['Specimen', 'Before', 'After', 'Expansion (' + unit + ')'],
          rows: rows
        },
        summary: [
          { label: 'Average expansion', value: fmt(avg, 2), unit: unit },
          { label: 'Permissible maximum', value: lim, unit: unit }
        ],
        verdict: pass(avg <= lim, 'Expansion of ' + fmt(avg, 2) + ' ' + unit +
          ' against a maximum of ' + lim + ' ' + unit + '.'),
        notes: []
      };
    }
  });

  TESTS.push({
    id: 'cement-compressive',
    name: 'Compressive Strength of Cement Mortar Cubes',
    code: 'IS 4031 (Part 6)',
    category: 'Cement',
    header: CEMENT_ID.concat([
      f('age', 'Age at test (days)', 'select', { options: [3, 7, 28], def: 28, required: true }),
      f('consistency', 'Standard consistency P (%)', 'number'),
      f('sand', 'Standard sand grading', 'text', { def: 'IS 650 standard sand, grades I–III equally' }),
      MACHINE
    ]),
    specimens: {
      label: 'Cube', min: 1, max: 6, def: 3,
      fields: [
        f('mark', 'Identification mark', 'text'),
        f('load', 'Failure load (kN)', 'number', { required: true })
      ]
    },
    compute(h, sp) {
      const rows = [], vals = [];
      sp.forEach((s, i) => {
        const v = IS4031.mortarCubeStrength(s.load);
        if (isFinite(v)) vals.push(v);
        rows.push([s.mark || (i + 1), fmt(n(s.load), 2), fmt(v, 2)]);
      });
      const avg = Num.mean(vals);
      const age = n(h.age);
      const spec = IS4031.CEMENT_GRADES[h.cementType];
      const key = age <= 3 ? 'd3' : (age <= 7 ? 'd7' : 'd28');
      const req = spec ? spec[key] : NaN;
      const summary = [
        { label: 'Average compressive strength', value: fmt(avg, 2), unit: 'N/mm²' },
        { label: 'Age at test', value: fmt(age, 0), unit: 'days' }
      ];
      let verdict;
      if (spec && isFinite(req)) {
        summary.push({ label: 'Minimum required for ' + h.cementType + ' at ' + fmt(age, 0) + ' days',
                       value: req, unit: 'N/mm²' });
        verdict = pass(avg >= req, 'Average of ' + fmt(avg, 2) +
          ' N/mm² against a minimum of ' + req + ' N/mm² for ' +
          h.cementType + ' (' + spec.standard + ').');
      } else {
        verdict = info('No grade requirement matched — result reported for information.');
      }
      return {
        table: { headers: ['Cube', 'Load (kN)', 'Strength (N/mm²)'], rows: rows },
        summary: summary, verdict: verdict,
        notes: ['Cubes are 70.6 mm with a face area of 5000 mm², cast with ' +
                'one part cement to three parts standard sand and water of ' +
                'P/4 + 3.0 percent by mass of the dry mix (IS 4031 Part 6).']
      };
    }
  });

  TESTS.push({
    id: 'cement-specific-gravity',
    primaryLabel: 'Specific gravity of cement',
    name: 'Specific Gravity of Cement',
    code: 'IS 4031 (Part 11)',
    category: 'Cement',
    header: CEMENT_ID.concat([
      f('liquid', 'Displacement liquid', 'text', { def: 'Kerosene' }),
      f('liquidSG', 'Specific gravity of the liquid', 'number', { def: 0.79 }),
      f('w1', 'Mass of empty bottle (g)', 'number'),
      f('w2', 'Mass of bottle + cement (g)', 'number'),
      f('w3', 'Mass of bottle + cement + liquid (g)', 'number'),
      f('w4', 'Mass of bottle + liquid only (g)', 'number'),
      MACHINE
    ]),
    compute(h) {
      const w1 = n(h.w1), w2 = n(h.w2), w3 = n(h.w3), w4 = n(h.w4), sgl = n(h.liquidSG);
      const sg = ((w2 - w1) * sgl) / ((w2 - w1) - (w3 - w4));
      return {
        table: null,
        summary: [
          { label: 'Mass of cement', value: fmt(w2 - w1, 2), unit: 'g' },
          { label: 'Specific gravity of cement', value: fmt(sg, 2), unit: '' }
        ],
        verdict: info('Ordinary Portland cement typically falls between 3.10 ' +
          'and 3.16; a markedly lower value suggests moisture pick-up or ' +
          'a blended cement.'),
        notes: []
      };
    }
  });

  /* =============================================================
   * AGGREGATES — IS 2386 / IS 383
   * ============================================================= */

  const AGG_ID = [
    f('aggType', 'Aggregate type', 'select',
      { options: ['Coarse aggregate', 'Fine aggregate'], def: 'Coarse aggregate' }),
    f('source', 'Source / quarry', 'text'),
    f('nominalSize', 'Nominal maximum size (mm)', 'number', { def: 20 }),
    f('wearing', 'Intended for a wearing surface', 'select',
      { options: ['No', 'Yes'], def: 'No',
        help: 'Wearing surfaces attract the stricter IS 383 limits' })
  ];

  const FINE_SIEVES = ['10 mm', '4.75 mm', '2.36 mm', '1.18 mm',
                       '600 micron', '300 micron', '150 micron', 'Pan'];
  const COARSE_SIEVES = ['80 mm', '40 mm', '20 mm', '12.5 mm', '10 mm',
                         '4.75 mm', '2.36 mm', 'Pan'];

  TESTS.push({
    id: 'sieve-analysis-fine',
    primaryLabel: 'Grading zone (IS 383 Table 4)',
    name: 'Sieve Analysis of Fine Aggregate',
    code: 'IS 2386 (Part 1) / IS 383',
    category: 'Aggregates',
    header: [
      f('source', 'Source / quarry', 'text'),
      f('sampleMass', 'Total mass of sample (g)', 'number', { def: 1000 }),
      MACHINE
    ],
    fieldTables: [{
      k: 'sieves', label: 'Mass retained on each sieve',
      rowLabel: 'IS Sieve', rows: FINE_SIEVES,
      columns: [f('retained', 'Mass retained (g)', 'number')]
    }],
    compute(h) {
      const input = (h.sieves || []).map(r => ({ sieve: r.sieve, retained: r.retained }));
      const sa = IS2386.sieveAnalysis(input);
      const passing = {};
      sa.rows.forEach(r => { passing[r.sieve] = r.passing; });
      const zone = IS2386.classifyFineZone(passing);
      /* Fineness modulus for fine aggregate uses the cumulative retained
         on 4.75 mm down to 150 micron. */
      const fmSieves = ['4.75 mm', '2.36 mm', '1.18 mm', '600 micron',
                        '300 micron', '150 micron'];
      const cum = sa.rows.filter(r => fmSieves.indexOf(r.sieve) > -1)
                         .map(r => r.cumRetained);
      const FM = IS2386.finenessModulus(cum);
      return {
        table: {
          headers: ['IS Sieve', 'Mass retained (g)', 'Retained (%)',
                    'Cumulative retained (%)', 'Passing (%)'],
          rows: sa.rows.map(r => [r.sieve, fmt(r.retained, 1), fmt(r.pctRetained, 1),
                                  fmt(r.cumRetained, 1), fmt(r.passing, 1)])
        },
        summary: [
          { label: 'Total mass', value: fmt(sa.total, 1), unit: 'g' },
          { label: 'Fineness modulus', value: fmt(FM, 2), unit: '' },
          { label: 'Grading zone (IS 383 Table 4)', value: zone, unit: '' }
        ],
        verdict: zone.indexOf('Does not conform') === 0
          ? { status: 'FAIL', text: zone }
          : pass(true, 'Grading conforms to ' + zone + ' of IS 383 Table 4.'),
        notes: ['IS 383 permits a tolerance of up to 5 percent on sieves other ' +
                'than 600 micron; check borderline gradings against the full ' +
                'clause before rejecting a sand.']
      };
    }
  });

  TESTS.push({
    id: 'sieve-analysis-coarse',
    primaryLabel: 'Fineness modulus',
    name: 'Sieve Analysis of Coarse Aggregate',
    code: 'IS 2386 (Part 1) / IS 383',
    category: 'Aggregates',
    header: [
      f('source', 'Source / quarry', 'text'),
      f('nominalSize', 'Nominal maximum size (mm)', 'select',
        { options: [40, 20, 16, 12.5, 10], def: 20 }),
      f('sampleMass', 'Total mass of sample (g)', 'number', { def: 5000 }),
      MACHINE
    ],
    fieldTables: [{
      k: 'sieves', label: 'Mass retained on each sieve',
      rowLabel: 'IS Sieve', rows: COARSE_SIEVES,
      columns: [f('retained', 'Mass retained (g)', 'number')]
    }],
    compute(h) {
      const sa = IS2386.sieveAnalysis(
        (h.sieves || []).map(r => ({ sieve: r.sieve, retained: r.retained })));
      const cum = sa.rows.filter(r => r.sieve !== 'Pan').map(r => r.cumRetained);
      const FM = IS2386.finenessModulus(cum);
      return {
        table: {
          headers: ['IS Sieve', 'Mass retained (g)', 'Retained (%)',
                    'Cumulative retained (%)', 'Passing (%)'],
          rows: sa.rows.map(r => [r.sieve, fmt(r.retained, 1), fmt(r.pctRetained, 1),
                                  fmt(r.cumRetained, 1), fmt(r.passing, 1)])
        },
        summary: [
          { label: 'Total mass', value: fmt(sa.total, 1), unit: 'g' },
          { label: 'Nominal maximum size', value: fmt(n(h.nominalSize), 0), unit: 'mm' },
          { label: 'Fineness modulus', value: fmt(FM, 2), unit: '' }
        ],
        verdict: info('Compare the percentage passing against the single-sized ' +
          'or graded aggregate limits of IS 383 Table 7 for the declared ' +
          'nominal size.'),
        notes: []
      };
    }
  });

  TESTS.push({
    id: 'aggregate-specific-gravity',
    primaryLabel: 'Average bulk specific gravity (oven dry)',
    name: 'Specific Gravity and Water Absorption of Aggregate',
    code: 'IS 2386 (Part 3)',
    category: 'Aggregates',
    header: AGG_ID.concat([MACHINE]),
    specimens: {
      label: 'Trial', min: 1, max: 3, def: 2,
      fields: [
        f('ovenDry', 'Oven-dry mass in air, A (g)', 'number', { required: true }),
        f('ssd', 'Saturated surface-dry mass in air, B (g)', 'number', { required: true }),
        f('inWater', 'Mass in water, C (g)', 'number', { required: true })
      ]
    },
    compute(h, sp) {
      const rows = [], abs = [], bulk = [];
      sp.forEach((s, i) => {
        const r = IS2386.specificGravity(s.ovenDry, s.ssd, s.inWater);
        if (isFinite(r.absorption)) abs.push(r.absorption);
        if (isFinite(r.bulkDry)) bulk.push(r.bulkDry);
        rows.push([i + 1, fmt(n(s.ovenDry), 1), fmt(n(s.ssd), 1), fmt(n(s.inWater), 1),
                   fmt(r.bulkDry, 2), fmt(r.bulkSSD, 2), fmt(r.apparent, 2),
                   fmt(r.absorption, 2)]);
      });
      const avgAbs = Num.mean(abs);
      const lim = IS2386.LIMITS.waterAbsorption.general;
      return {
        table: {
          headers: ['Trial', 'A (g)', 'B (g)', 'C (g)', 'Bulk SG (dry)',
                    'Bulk SG (SSD)', 'Apparent SG', 'Absorption (%)'],
          rows: rows
        },
        summary: [
          { label: 'Average bulk specific gravity (oven dry)', value: fmt(Num.mean(bulk), 2), unit: '' },
          { label: 'Average water absorption', value: fmt(avgAbs, 2), unit: '%' },
          { label: 'IS 383 guidance maximum', value: lim, unit: '%' }
        ],
        verdict: pass(avgAbs <= lim, 'Absorption of ' + fmt(avgAbs, 2) +
          '% against the IS 383 guidance figure of ' + lim + '%.'),
        notes: ['IS 383 treats 2 percent as the normal upper bound for water ' +
                'absorption; higher values are permitted where the aggregate is ' +
                'shown to be otherwise sound, so a result above the figure ' +
                'warrants review rather than automatic rejection.']
      };
    }
  });

  function fines(id, name, code, limitKey, massDefault, extraHeader) {
    return {
      id: id, name: name, code: code, category: 'Aggregates',
      header: AGG_ID.concat(extraHeader || []).concat([MACHINE]),
      specimens: {
        label: 'Trial', min: 1, max: 3, def: 2,
        fields: [
          f('total', 'Total mass of sample (g)', 'number',
            { def: massDefault, required: true }),
          f('fines', 'Mass passing the 2.36 mm sieve (g)', 'number', { required: true })
        ]
      },
      compute(h, sp) {
        const rows = [], vals = [];
        sp.forEach((s, i) => {
          const v = IS2386.percentFines(s.fines, s.total);
          if (isFinite(v)) vals.push(v);
          rows.push([i + 1, fmt(n(s.total), 1), fmt(n(s.fines), 1), fmt(v, 2)]);
        });
        const avg = Num.mean(vals);
        const wearing = h.wearing === 'Yes';
        const lim = wearing ? IS2386.LIMITS[limitKey].wearing
                            : IS2386.LIMITS[limitKey].general;
        return {
          table: {
            headers: ['Trial', 'Total mass (g)', 'Fines passing 2.36 mm (g)', 'Value (%)'],
            rows: rows
          },
          summary: [
            { label: 'Average value', value: fmt(avg, 2), unit: '%' },
            { label: 'Permissible maximum' + (wearing ? ' (wearing surface)' : ''),
              value: lim, unit: '%' }
          ],
          verdict: pass(avg <= lim, 'Average of ' + fmt(avg, 2) +
            '% against a maximum of ' + lim + '% under ' +
            IS2386.LIMITS[limitKey].clause +
            (wearing ? ' for concrete wearing surfaces.' : '.')),
          notes: []
        };
      }
    };
  }

  TESTS.push(fines('impact-value', 'Aggregate Impact Value',
    'IS 2386 (Part 4)', 'impactValue', 350));
  TESTS.push(fines('crushing-value', 'Aggregate Crushing Value',
    'IS 2386 (Part 4)', 'crushingValue', 3000,
    [f('load', 'Load applied (kN)', 'number', { def: 400 })]));

  TESTS.push({
    id: 'abrasion-value',
    name: 'Los Angeles Abrasion Value',
    code: 'IS 2386 (Part 4)',
    category: 'Aggregates',
    header: AGG_ID.concat([
      f('grading', 'Grading of test sample', 'select',
        { options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], def: 'B' }),
      f('spheres', 'Number of abrasive charges', 'number', { def: 11 }),
      f('revolutions', 'Number of revolutions', 'number', { def: 500 }),
      MACHINE
    ]),
    specimens: {
      label: 'Trial', min: 1, max: 3, def: 2,
      fields: [
        f('total', 'Original mass of sample (g)', 'number', { def: 5000, required: true }),
        f('retained', 'Mass retained on the 1.7 mm sieve after test (g)', 'number', { required: true })
      ]
    },
    compute(h, sp) {
      const rows = [], vals = [];
      sp.forEach((s, i) => {
        const t = n(s.total), r = n(s.retained);
        const v = (t - r) / t * 100;
        if (isFinite(v)) vals.push(Num.dp(v, 2));
        rows.push([i + 1, fmt(t, 1), fmt(r, 1), fmt(v, 2)]);
      });
      const avg = Num.mean(vals);
      const wearing = h.wearing === 'Yes';
      const lim = wearing ? IS2386.LIMITS.abrasionValue.wearing
                          : IS2386.LIMITS.abrasionValue.general;
      return {
        table: {
          headers: ['Trial', 'Original mass (g)', 'Retained on 1.7 mm (g)',
                    'Abrasion value (%)'],
          rows: rows
        },
        summary: [
          { label: 'Average Los Angeles abrasion value', value: fmt(avg, 2), unit: '%' },
          { label: 'Permissible maximum' + (wearing ? ' (wearing surface)' : ''),
            value: lim, unit: '%' }
        ],
        verdict: pass(avg <= lim, 'Average of ' + fmt(avg, 2) +
          '% against a maximum of ' + lim + '%.'),
        notes: []
      };
    }
  });

  TESTS.push({
    id: 'flakiness-elongation',
    primaryLabel: 'Combined index',
    name: 'Flakiness and Elongation Indices',
    code: 'IS 2386 (Part 1)',
    category: 'Aggregates',
    header: AGG_ID.concat([
      f('total', 'Total mass of sample (g)', 'number', { required: true }),
      f('flaky', 'Mass passing the thickness gauge (g)', 'number'),
      f('elongated', 'Mass retained on the length gauge (g)', 'number'),
      MACHINE
    ]),
    compute(h) {
      const total = n(h.total);
      const fi = IS2386.index(h.flaky, total);
      const ei = IS2386.index(h.elongated, total);
      const combined = (isFinite(fi) ? fi : 0) + (isFinite(ei) ? ei : 0);
      const lim = IS2386.LIMITS.combinedFlakinessElongation.general;
      return {
        table: null,
        summary: [
          { label: 'Flakiness index', value: fmt(fi, 2), unit: '%' },
          { label: 'Elongation index', value: fmt(ei, 2), unit: '%' },
          { label: 'Combined index', value: fmt(combined, 2), unit: '%' },
          { label: 'Permissible maximum (combined)', value: lim, unit: '%' }
        ],
        verdict: pass(combined <= lim, 'Combined flakiness and elongation index of ' +
          fmt(combined, 2) + '% against a maximum of ' + lim + '% under IS 383.'),
        notes: ['The elongation index is not applicable to aggregate smaller ' +
                'than 6.3 mm (IS 2386 Part 1).']
      };
    }
  });

  TESTS.push({
    id: 'bulk-density-voids',
    primaryLabel: 'Bulk density',
    name: 'Bulk Density and Voids of Aggregate',
    code: 'IS 2386 (Part 3)',
    category: 'Aggregates',
    header: AGG_ID.concat([
      f('condition', 'Compaction condition', 'select',
        { options: ['Loose', 'Rodded / compacted'], def: 'Rodded / compacted' }),
      f('volume', 'Volume of measure (litres)', 'number', { def: 15 }),
      f('empty', 'Mass of empty measure (kg)', 'number'),
      f('full', 'Mass of measure + aggregate (kg)', 'number'),
      f('specificGravity', 'Specific gravity of aggregate', 'number', { def: 2.65 }),
      MACHINE
    ]),
    compute(h) {
      const net = n(h.full) - (n(h.empty) || 0);
      const vol = n(h.volume) / 1000;
      const bd = net / vol;
      const sg = n(h.specificGravity);
      const voids = isFinite(sg) && sg > 0 ? (1 - bd / (sg * 1000)) * 100 : NaN;
      return {
        table: null,
        summary: [
          { label: 'Net mass of aggregate', value: fmt(net, 2), unit: 'kg' },
          { label: 'Bulk density (' + (h.condition || '').toLowerCase() + ')',
            value: fmt(bd, 0), unit: 'kg/m³' },
          { label: 'Percentage of voids', value: fmt(voids, 1), unit: '%' }
        ],
        verdict: info('Bulk density and voids reported for information; used in ' +
          'mix proportioning under IS 10262.'),
        notes: []
      };
    }
  });

  TESTS.push({
    id: 'silt-content',
    name: 'Silt and Clay Content of Fine Aggregate',
    code: 'IS 2386 (Part 2)',
    category: 'Aggregates',
    header: [
      f('source', 'Source / quarry', 'text'),
      f('method', 'Method', 'select',
        { options: ['Sedimentation (field, by volume)', 'Wet sieving on 75 micron (by mass)'],
          def: 'Sedimentation (field, by volume)' }),
      f('siltLayer', 'Height of silt layer (mm) or mass of silt (g)', 'number'),
      f('sandLayer', 'Height of sand layer (mm) or dry mass of sample (g)', 'number'),
      f('specLimit', 'Specified maximum (%)', 'number', { def: 3 }),
      MACHINE
    ],
    compute(h) {
      const a = n(h.siltLayer), b = n(h.sandLayer);
      const pct = a / b * 100;
      const lim = n(h.specLimit);
      return {
        table: null,
        summary: [
          { label: 'Silt and clay content', value: fmt(pct, 2), unit: '%' },
          { label: 'Specified maximum', value: fmt(lim, 1), unit: '%' }
        ],
        verdict: isFinite(lim)
          ? pass(pct <= lim, 'Silt content of ' + fmt(pct, 2) +
              '% against a maximum of ' + fmt(lim, 1) + '%.')
          : info('Silt content reported for information.'),
        notes: ['IS 383 limits material finer than 75 micron to 3 percent for ' +
                'uncrushed sand and 15 percent for crushed sand; confirm which ' +
                'limit applies to this material.']
      };
    }
  });

  root.TEST_REGISTRY = (root.TEST_REGISTRY || []).concat(TESTS);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.TEST_REGISTRY;
  }

})(typeof window !== 'undefined' ? window : globalThis);
