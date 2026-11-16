/*
 * standards.js — Indian Standard reference data and calculation engine
 * ---------------------------------------------------------------------
 * All code clause references are noted inline so results can be audited
 * against the printed standard. Values marked CONFIGURABLE can be
 * overridden from Settings if your lab works to a different revision.
 *
 * Primary references:
 *   IS 456:2000   Plain and Reinforced Concrete — Code of Practice
 *   IS 516        Methods of Tests for Strength of Concrete
 *   IS 1199       Fresh Concrete — Methods of Sampling and Testing
 *   IS 5816:1999  Splitting Tensile Strength of Concrete
 *   IS 10262:2019 Concrete Mix Proportioning — Guidelines
 *   IS 4031       Methods of Physical Tests for Hydraulic Cement
 *   IS 2386       Methods of Test for Aggregates for Concrete
 *   IS 383:2016   Coarse and Fine Aggregate for Concrete — Specification
 */

'use strict';

const Num = {
  /* Round to the nearest step, e.g. nearest 0.5 N/mm2 as IS 516 requires. */
  toStep(value, step) {
    if (!isFinite(value)) return NaN;
    return Math.round(value / step) * step;
  },
  /* Fixed decimals, returned as a number not a string. */
  dp(value, places) {
    if (!isFinite(value)) return NaN;
    const f = Math.pow(10, places);
    return Math.round(value * f) / f;
  },
  mean(arr) {
    const v = arr.filter(n => isFinite(n));
    if (!v.length) return NaN;
    return v.reduce((a, b) => a + b, 0) / v.length;
  },
  /* Sample standard deviation (n-1 denominator), as used for
     establishing site standard deviation under IS 456 Cl. 16.1. */
  stdDev(arr) {
    const v = arr.filter(n => isFinite(n));
    if (v.length < 2) return NaN;
    const m = Num.mean(v);
    const ss = v.reduce((a, b) => a + Math.pow(b - m, 2), 0);
    return Math.sqrt(ss / (v.length - 1));
  }
};

/* ===================================================================
 * IS 456:2000
 * =================================================================== */
const IS456 = {

  /* Standard designated grades. Cl. 6.1 / Table 2.
     M65 and above fall outside the table and are treated as high
     strength concrete — the app still computes, but flags them. */
  GRADES: [
    'M10', 'M15', 'M20', 'M25', 'M30', 'M35', 'M40',
    'M45', 'M50', 'M55', 'M60', 'M65', 'M70', 'M75', 'M80',
    'M90', 'M100', 'M110', 'M120'
  ],

  /* Characteristic compressive strength, 150 mm cube at 28 days, N/mm2. */
  fck(grade) {
    if (!grade) return NaN;
    const n = parseFloat(String(grade).replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : NaN;
  },

  isStandardGrade(grade) {
    return IS456.GRADES.indexOf(String(grade).toUpperCase()) !== -1;
  },

  /* Assumed standard deviation where site data is not yet established.
     IS 456:2000 Table 8 / IS 10262:2019 Table 2.           CONFIGURABLE
     Above M50 the standards give no tabulated value; 6.0 is carried
     forward as a working assumption and is flagged in the output. */
  assumedStdDev(grade) {
    const f = IS456.fck(grade);
    if (!isFinite(f)) return NaN;
    if (f <= 15) return 3.5;
    if (f <= 25) return 4.0;
    if (f <= 50) return 5.0;
    return 6.0;                       // beyond the table — flagged
  },

  stdDevIsTabulated(grade) {
    return IS456.fck(grade) <= 50;
  },

  /* Target mean strength for mix design.
     IS 10262:2019 Cl. 4.2: the greater of fck + 1.65s and fck + X. */
  targetMeanStrength(grade, sigma) {
    const f = IS456.fck(grade);
    /* Note: isFinite(null) is true in JavaScript, so the guard must test
       for a real positive number before trusting a supplied sigma. */
    const supplied = parseFloat(sigma);
    const s = (isFinite(supplied) && supplied > 0)
      ? supplied
      : IS456.assumedStdDev(grade);
    const X = IS456.factorX(grade);
    const byStdDev = f + 1.65 * s;
    const byFactor = f + X;
    return {
      fck: f,
      sigma: s,
      factorX: X,
      byStdDev: Num.dp(byStdDev, 2),
      byFactor: Num.dp(byFactor, 2),
      target: Num.dp(Math.max(byStdDev, byFactor), 2),
      governedBy: byStdDev >= byFactor ? 'fck + 1.65s' : 'fck + X'
    };
  },

  /* Factor X, IS 10262:2019 Table 2.                        CONFIGURABLE */
  factorX(grade) {
    const f = IS456.fck(grade);
    if (!isFinite(f)) return NaN;
    if (f <= 15) return 5.0;
    if (f <= 25) return 5.5;
    if (f <= 50) return 6.5;
    return 8.0;
  },

  /* Compliance margins, IS 456:2000 Cl. 16.1 and Table 11.
     M15: mean of 4 >= fck + 0.825s or fck + 3, whichever greater;
          individual >= fck - 3.
     M20 and above: the same with 4 N/mm2 in place of 3 N/mm2. */
  acceptanceMargins(grade) {
    const f = IS456.fck(grade);
    const m = f >= 20 ? 4 : 3;
    return { meanFixed: m, individualBelow: m };
  },

  /* Full acceptance assessment for a set of test results.
   *
   * results  array of test results in N/mm2, each result being the
   *          average of one sample (normally 3 cubes)
   * grade    e.g. 'M30'
   * sigma    established site standard deviation, or null to use the
   *          assumed value from Table 8
   *
   * IS 456 Cl. 16.1 — groups of four NON-OVERLAPPING consecutive results.
   * With fewer than four results the mean criterion cannot yet be
   * applied; only the individual criterion is reported.
   */
  assessAcceptance(results, grade, sigma) {
    const f = IS456.fck(grade);
    const suppliedSigma = parseFloat(sigma);
    const sigmaOk = isFinite(suppliedSigma) && suppliedSigma > 0;
    const s = sigmaOk ? suppliedSigma : IS456.assumedStdDev(grade);
    const margins = IS456.acceptanceMargins(grade);

    /* The standard requires 0.825s to be rounded to the nearest
       0.5 N/mm2 before being added to fck. */
    const byStdDev = f + Num.toStep(0.825 * s, 0.5);
    const byFixed = f + margins.meanFixed;
    const meanLimit = Math.max(byStdDev, byFixed);
    const individualLimit = f - margins.individualBelow;

    const clean = results.filter(n => isFinite(n));
    const notes = [];
    const groups = [];

    /* Non-overlapping consecutive groups of four. */
    for (let i = 0; i + 4 <= clean.length; i += 4) {
      const g = clean.slice(i, i + 4);
      const gm = Num.mean(g);
      groups.push({
        from: i + 1,
        to: i + 4,
        results: g,
        mean: Num.dp(gm, 2),
        limit: Num.dp(meanLimit, 2),
        pass: gm >= meanLimit
      });
    }

    const individual = clean.map((r, i) => ({
      index: i + 1,
      value: Num.dp(r, 2),
      limit: Num.dp(individualLimit, 2),
      pass: r >= individualLimit
    }));

    const remainder = clean.length % 4;
    if (clean.length < 4) {
      notes.push(
        'Fewer than four test results — the mean-of-four criterion of ' +
        'IS 456 Cl. 16.1 cannot yet be applied. Only the individual ' +
        'result criterion has been checked.'
      );
    } else if (remainder) {
      notes.push(
        remainder + ' result(s) fall outside the last complete group of ' +
        'four and are not yet assessed against the mean criterion.'
      );
    }
    if (!sigmaOk) {
      notes.push(
        'Assumed standard deviation of ' + s + ' N/mm\u00b2 used ' +
        '(IS 456 Table 8). Substitute the established site standard ' +
        'deviation once at least 30 test results are available.'
      );
    }
    if (!IS456.stdDevIsTabulated(grade)) {
      notes.push(
        'Grade ' + grade + ' lies outside IS 456 Table 8. Verify the ' +
        'standard deviation and acceptance margins against the project ' +
        'specification before issuing the certificate.'
      );
    }

    const meanFails = groups.filter(g => !g.pass);
    const indFails = individual.filter(r => !r.pass);

    let status;
    if (!clean.length) status = 'NO DATA';
    else if (meanFails.length || indFails.length) status = 'DOES NOT COMPLY';
    else if (clean.length < 4) status = 'PROVISIONAL';
    else status = 'COMPLIES';

    return {
      grade: grade,
      fck: f,
      sigma: s,
      sigmaAssumed: !sigmaOk,
      meanLimit: Num.dp(meanLimit, 2),
      meanLimitBasis: byStdDev >= byFixed
        ? 'fck + 0.825s (rounded to nearest 0.5)'
        : 'fck + ' + margins.meanFixed,
      individualLimit: Num.dp(individualLimit, 2),
      groups: groups,
      individual: individual,
      status: status,
      notes: notes,
      count: clean.length,
      mean: Num.dp(Num.mean(clean), 2),
      stdDev: Num.dp(Num.stdDev(clean), 2),
      min: clean.length ? Num.dp(Math.min.apply(null, clean), 2) : NaN,
      max: clean.length ? Num.dp(Math.max.apply(null, clean), 2) : NaN
    };
  },

  /* Minimum frequency of sampling, IS 456:2000 Cl. 15.2.2, Table 15.
     One sample = 3 specimens for each age of test. */
  samplingFrequency(volumeM3) {
    const v = parseFloat(volumeM3);
    if (!isFinite(v) || v <= 0) return { volume: v, samples: 0, basis: '—' };
    let n;
    if (v <= 5) n = 1;
    else if (v <= 15) n = 2;
    else if (v <= 30) n = 3;
    else if (v <= 50) n = 4;
    else n = 4 + Math.ceil((v - 50) / 50);
    return {
      volume: v,
      samples: n,
      cubesFor28Day: n * 3,
      basis: v <= 50
        ? 'IS 456 Table 15'
        : 'IS 456 Table 15 — 4 samples for the first 50 m\u00b3 plus one ' +
          'per additional 50 m\u00b3 or part thereof'
    };
  },

  /* Degree of workability against placing conditions, IS 456 Table 7. */
  WORKABILITY: [
    {
      placing: 'Blinding concrete; shallow sections; pavements using pavers',
      degree: 'Very low',
      slump: '—',
      compactingFactor: '0.75 – 0.80',
      note: 'Measure by compacting factor; slump is not meaningful'
    },
    {
      placing: 'Mass concrete; lightly reinforced sections in slabs, beams, ' +
               'walls and columns; floors; hand-placed pavements; canal ' +
               'lining; strip footings',
      degree: 'Low',
      slump: '25 – 75 mm',
      compactingFactor: '0.80 – 0.85',
      note: ''
    },
    {
      placing: 'Heavily reinforced sections in slabs, beams, walls and ' +
               'columns; slipform work; pumped concrete',
      degree: 'Medium',
      slump: '50 – 100 mm',
      compactingFactor: '0.85 – 0.92',
      note: ''
    },
    {
      placing: 'Trench fill; in-situ piling',
      degree: 'High',
      slump: '100 – 150 mm',
      compactingFactor: 'above 0.92',
      note: ''
    },
    {
      placing: 'Tremie concrete',
      degree: 'Very high',
      slump: '—',
      compactingFactor: '—',
      note: 'Measure by flow table; see IS 456 Cl. 7.1.2'
    }
  ],

  classifySlump(slumpMm) {
    const s = parseFloat(slumpMm);
    if (!isFinite(s)) return '—';
    if (s < 25) return 'Very low';
    if (s <= 75) return 'Low';
    if (s <= 100) return 'Medium';
    if (s <= 150) return 'High';
    return 'Very high / flowing — verify against the mix specification';
  },

  /* Minimum requirements for durability, IS 456:2000 Table 5,
     for 20 mm nominal maximum size aggregate. */
  EXPOSURE: [
    { name: 'Mild',        rccCement: 300, rccWC: 0.55, rccGrade: 'M20',
      pccCement: 220, pccWC: 0.60, pccGrade: '—',   cover: 20 },
    { name: 'Moderate',    rccCement: 300, rccWC: 0.50, rccGrade: 'M25',
      pccCement: 240, pccWC: 0.60, pccGrade: 'M15', cover: 30 },
    { name: 'Severe',      rccCement: 320, rccWC: 0.45, rccGrade: 'M30',
      pccCement: 250, pccWC: 0.50, pccGrade: 'M20', cover: 45 },
    { name: 'Very severe', rccCement: 340, rccWC: 0.45, rccGrade: 'M35',
      pccCement: 260, pccWC: 0.45, pccGrade: 'M20', cover: 50 },
    { name: 'Extreme',     rccCement: 360, rccWC: 0.40, rccGrade: 'M40',
      pccCement: 280, pccWC: 0.40, pccGrade: 'M25', cover: 75 }
  ],

  /* Modulus of elasticity, IS 456 Cl. 6.2.3.1: Ec = 5000 sqrt(fck) MPa.
     This is the short-term static modulus assumed for design, not a
     measured value. */
  modulusOfElasticity(fck) {
    return Num.dp(5000 * Math.sqrt(fck), 0);
  },

  /* Flexural strength, IS 456 Cl. 6.2.2: fcr = 0.7 sqrt(fck) N/mm2.
     Used as the expected value to compare a measured beam result against. */
  flexuralStrengthExpected(fck) {
    return Num.dp(0.7 * Math.sqrt(fck), 2);
  }
};

/* ===================================================================
 * IS 516 — strength of concrete
 * =================================================================== */
const IS516 = {

  /* Cube cross-sectional areas, mm2. 150 mm is standard; 100 mm is
     permitted where nominal maximum aggregate size does not exceed
     20 mm. */
  cubeArea(sizeMm) {
    const s = parseFloat(sizeMm);
    return isFinite(s) ? s * s : NaN;
  },

  /* Compressive strength of one specimen.
     load in kN, area in mm2, result in N/mm2 reported to the
     nearest 0.5 N/mm2. */
  cubeStrength(loadKN, areaMm2) {
    const f = (parseFloat(loadKN) * 1000) / parseFloat(areaMm2);
    return isFinite(f) ? Num.toStep(f, 0.5) : NaN;
  },

  /* Density of a hardened specimen, kg/m3. */
  density(massKg, volumeM3) {
    const d = parseFloat(massKg) / parseFloat(volumeM3);
    return isFinite(d) ? Num.dp(d, 0) : NaN;
  },

  /* A test result is the average of the specimens in the sample.
     IS 516: individual specimen strengths should not differ from the
     average by more than 15 percent; if any does, the result of that
     sample is not valid. */
  sampleResult(strengths) {
    const v = strengths.filter(n => isFinite(n));
    if (!v.length) return { mean: NaN, valid: false, outliers: [], spread: NaN };
    const m = Num.mean(v);
    const outliers = [];
    v.forEach((s, i) => {
      const dev = Math.abs(s - m) / m * 100;
      if (dev > 15) outliers.push({ index: i + 1, value: s, deviation: Num.dp(dev, 1) });
    });
    const spread = v.length > 1
      ? Num.dp(Math.max.apply(null, v) - Math.min.apply(null, v), 2)
      : 0;
    return {
      mean: Num.toStep(m, 0.5),
      meanExact: Num.dp(m, 2),
      valid: outliers.length === 0,
      outliers: outliers,
      spread: spread,
      maxDeviationPct: v.length
        ? Num.dp(Math.max.apply(null, v.map(s => Math.abs(s - m) / m * 100)), 1)
        : NaN
    };
  },

  /* Flexural strength by two-point (third-point) loading, IS 516.
   *
   *   P  maximum load, kN
   *   L  effective span, mm (600 for 150 mm beams, 400 for 100 mm beams)
   *   b  measured width, mm
   *   d  measured depth, mm
   *   a  distance between the line of fracture and the nearer support,
   *      measured on the centre line of the tensile side, mm
   *
   * If a is greater than the primary threshold, fb = P*L / (b*d^2).
   * If a falls in the secondary band, fb = 3*P*a / (b*d^2).
   * If a is below the secondary band, the result is discarded.
   */
  flexuralStrength(P_kN, L, b, d, a) {
    const P = parseFloat(P_kN) * 1000;
    const span = parseFloat(L), B = parseFloat(b), D = parseFloat(d), A = parseFloat(a);
    if (![P, span, B, D].every(isFinite) || B <= 0 || D <= 0) {
      return { value: NaN, formula: '—', valid: false,
               note: 'Incomplete dimensions or load' };
    }
    /* Thresholds scale with the specimen size: 200/170 mm for a
       150 mm beam on a 600 mm span, 133/110 mm for a 100 mm beam. */
    const large = D >= 125;
    const primary = large ? 200 : 133;
    const secondary = large ? 170 : 110;

    if (!isFinite(A)) {
      return {
        value: Num.dp(P * span / (B * D * D), 2),
        formula: 'fb = PL / bd\u00b2',
        valid: true,
        note: 'Fracture location not recorded — standard formula applied. ' +
              'Record the distance "a" to confirm validity.'
      };
    }
    if (A > primary) {
      return {
        value: Num.dp(P * span / (B * D * D), 2),
        formula: 'fb = PL / bd\u00b2',
        valid: true,
        note: 'Fracture within the middle third (a = ' + A + ' mm).'
      };
    }
    if (A >= secondary) {
      return {
        value: Num.dp(3 * P * A / (B * D * D), 2),
        formula: 'fb = 3Pa / bd\u00b2',
        valid: true,
        note: 'Fracture outside the middle third but within the permitted ' +
              'band (a = ' + A + ' mm); the modified formula applies.'
      };
    }
    return {
      value: NaN,
      formula: '—',
      valid: false,
      note: 'Fracture at a = ' + A + ' mm, below the limit of ' + secondary +
            ' mm. The result shall be discarded (IS 516).'
    };
  },

  /* Static modulus of elasticity from a stress–strain pair, N/mm2.
     Secant modulus between the seating stress and one third of the
     average compressive strength. */
  staticModulus(stress1, strain1, stress2, strain2) {
    const ds = parseFloat(stress2) - parseFloat(stress1);
    const de = parseFloat(strain2) - parseFloat(strain1);
    const E = ds / de;
    return isFinite(E) ? Num.dp(E, 0) : NaN;
  }
};

/* ===================================================================
 * IS 5816:1999 — splitting tensile strength
 * =================================================================== */
const IS5816 = {
  /* fct = 2P / (pi * L * D), P in kN, L and D in mm, result N/mm2. */
  splitTensile(P_kN, lengthMm, diaMm) {
    const P = parseFloat(P_kN) * 1000;
    const L = parseFloat(lengthMm), D = parseFloat(diaMm);
    const f = (2 * P) / (Math.PI * L * D);
    return isFinite(f) ? Num.dp(f, 2) : NaN;
  }
};

/* ===================================================================
 * IS 1199 — fresh concrete
 * =================================================================== */
const IS1199 = {
  /* Compacting factor = mass of partially compacted concrete divided by
     mass of fully compacted concrete, both net of the container. */
  compactingFactor(partialKg, fullKg, containerKg) {
    const c = parseFloat(containerKg) || 0;
    const p = parseFloat(partialKg) - c;
    const f = parseFloat(fullKg) - c;
    const cf = p / f;
    return isFinite(cf) ? Num.dp(cf, 2) : NaN;
  },

  /* Fresh density, kg/m3, from net mass and container volume. */
  freshDensity(netMassKg, volumeLitres) {
    const d = parseFloat(netMassKg) / (parseFloat(volumeLitres) / 1000);
    return isFinite(d) ? Num.dp(d, 0) : NaN;
  },

  /* Air content by the pressure method, reported as a percentage. */
  classifyCompactingFactor(cf) {
    const v = parseFloat(cf);
    if (!isFinite(v)) return '—';
    if (v < 0.80) return 'Very low';
    if (v < 0.85) return 'Low';
    if (v < 0.92) return 'Medium';
    return 'High';
  }
};

/* ===================================================================
 * Durability and permeability
 * =================================================================== */
const Durability = {

  /* Rapid Chloride Permeability Test, ASTM C1202 / IS 516 (Part 2/Sec 1).
   *
   * Charge passed by the trapezoidal rule over six hours with readings
   * at 30 minute intervals:
   *   Q = 900 * (I0 + 2*I30 + 2*I60 + ... + 2*I330 + I360)
   * with currents in amperes and Q in coulombs.
   *
   * readings: array of 13 currents in milliamperes, t = 0 ... 360 min.
   * diameter: specimen diameter in mm; results are normalised to the
   *           95 mm reference diameter by Qs = Qx * (95/x)^2.
   */
  rcptCharge(readingsMa, diameterMm) {
    const r = readingsMa.map(v => parseFloat(v)).filter(v => isFinite(v));
    if (r.length < 2) return { charge: NaN, normalised: NaN, rating: '—' };
    let sum = 0;
    for (let i = 0; i < r.length; i++) {
      const amps = r[i] / 1000;
      sum += (i === 0 || i === r.length - 1) ? amps : 2 * amps;
    }
    /* 900 seconds is the half-interval weight for 30 minute spacing. */
    const Q = 900 * sum;
    const d = parseFloat(diameterMm);
    const normalised = isFinite(d) && d > 0 ? Q * Math.pow(95 / d, 2) : Q;
    return {
      charge: Num.dp(Q, 0),
      normalised: Num.dp(normalised, 0),
      rating: Durability.rcptRating(normalised),
      readingCount: r.length
    };
  },

  /* Chloride ion penetrability classification, ASTM C1202 Table 1. */
  rcptRating(coulombs) {
    const q = parseFloat(coulombs);
    if (!isFinite(q)) return '—';
    if (q > 4000) return 'High';
    if (q > 2000) return 'Moderate';
    if (q > 1000) return 'Low';
    if (q > 100) return 'Very low';
    return 'Negligible';
  },

  /* Rapid Chloride Migration Test, NT Build 492.
   *
   *   Dnssm = (0.0239 * (273+T) * L) / ((U-2) * t)
   *           * [ xd - 0.0238 * sqrt( ((273+T) * L * xd) / (U-2) ) ]
   *
   *   U  applied voltage, V
   *   T  average of initial and final temperature in the anolyte, degC
   *   L  specimen thickness, mm
   *   xd average chloride penetration depth, mm
   *   t  test duration, hours
   *   result in 1e-12 m2/s
   */
  rcmtCoefficient(U, T, L, xd, tHours) {
    const u = parseFloat(U), temp = parseFloat(T),
          l = parseFloat(L), x = parseFloat(xd), t = parseFloat(tHours);
    if (![u, temp, l, x, t].every(isFinite) || u <= 2 || t <= 0) {
      return { value: NaN, rating: '—' };
    }
    const k = (0.0239 * (273 + temp) * l) / ((u - 2) * t);
    const corr = 0.0238 * Math.sqrt(((273 + temp) * l * x) / (u - 2));
    const D = k * (x - corr);
    return {
      value: Num.dp(D, 2),
      rating: Durability.rcmtRating(D),
      unit: '\u00d710\u207b\u00b9\u00b2 m\u00b2/s'
    };
  },

  /* Indicative resistance bands for Dnssm. These are widely used
     industry bands rather than a clause in NT Build 492 itself, so
     they are reported as guidance only.                   CONFIGURABLE */
  rcmtRating(D) {
    const d = parseFloat(D);
    if (!isFinite(d)) return '—';
    if (d > 15) return 'Low resistance';
    if (d > 10) return 'Moderate resistance';
    if (d > 5) return 'High resistance';
    if (d > 2.5) return 'Very high resistance';
    return 'Extremely high resistance';
  },

  /* Depth of penetration of water under pressure,
     DIN 1048 Part 5 / IS 516 (Part 2/Sec 1).
     Specimens are subjected to 0.5 N/mm2 for 72 hours and split; the
     maximum depth of the wetted front is reported in mm.
     Many specifications accept a maximum of 25 mm.         CONFIGURABLE */
  waterPenetration(depthsMm, limitMm) {
    const d = depthsMm.map(v => parseFloat(v)).filter(isFinite);
    if (!d.length) return { max: NaN, mean: NaN, rating: '—' };
    const max = Math.max.apply(null, d);
    const lim = isFinite(parseFloat(limitMm)) ? parseFloat(limitMm) : 25;
    return {
      max: Num.dp(max, 1),
      mean: Num.dp(Num.mean(d), 1),
      limit: lim,
      pass: max <= lim,
      rating: max <= lim ? 'Within specified limit' : 'Exceeds specified limit'
    };
  },

  /* Water absorption of hardened concrete, percent by mass. */
  waterAbsorption(satMassKg, dryMassKg) {
    const w = parseFloat(satMassKg), d = parseFloat(dryMassKg);
    const a = (w - d) / d * 100;
    return isFinite(a) ? Num.dp(a, 2) : NaN;
  },

  /* Coefficient of permeability by the falling head method,
     IS 3085, in m/s. */
  coefficientOfPermeability(Q_m3, L_m, A_m2, h_m, t_s) {
    const k = (parseFloat(Q_m3) * parseFloat(L_m)) /
              (parseFloat(A_m2) * parseFloat(h_m) * parseFloat(t_s));
    return isFinite(k) ? k : NaN;
  }
};

/* ===================================================================
 * IS 4031 — cement
 * =================================================================== */
const IS4031 = {
  /* Fineness by dry sieving on the 90 micron sieve, percent retained.
     IS 4031 Part 1. OPC: not more than 10 percent.          CONFIGURABLE */
  finenessBySieving(retainedG, totalG) {
    const f = parseFloat(retainedG) / parseFloat(totalG) * 100;
    return isFinite(f) ? Num.dp(f, 2) : NaN;
  },

  /* Compressive strength of cement mortar cubes, IS 4031 Part 6.
     70.6 mm cubes, face area 5000 mm2, 1:3 cement to standard sand,
     water = P/4 + 3.0 percent of the combined mass. */
  mortarCubeStrength(loadKN) {
    const f = (parseFloat(loadKN) * 1000) / 5000;
    return isFinite(f) ? Num.dp(f, 2) : NaN;
  },

  mortarWaterRequirement(consistencyP, combinedMassG) {
    const p = parseFloat(consistencyP);
    const m = parseFloat(combinedMassG);
    const pct = p / 4 + 3.0;
    return {
      percent: Num.dp(pct, 2),
      waterG: isFinite(m) ? Num.dp(m * pct / 100, 1) : NaN
    };
  },

  /* Minimum compressive strength of cement, IS 269 / IS 8112 / IS 12269,
     N/mm2 at 3, 7 and 28 days.                              CONFIGURABLE */
  CEMENT_GRADES: {
    'OPC 33': { d3: 16, d7: 22, d28: 33, standard: 'IS 269' },
    'OPC 43': { d3: 23, d7: 33, d28: 43, standard: 'IS 269 / IS 8112' },
    'OPC 53': { d3: 27, d7: 37, d28: 53, standard: 'IS 269 / IS 12269' },
    'PPC':    { d3: 16, d7: 22, d28: 33, standard: 'IS 1489 (Part 1)' },
    'PSC':    { d3: 16, d7: 22, d28: 33, standard: 'IS 455' }
  },

  /* Physical requirement limits for ordinary Portland cement.
     Setting times in minutes, soundness in mm / percent.    CONFIGURABLE */
  LIMITS: {
    finenessRetained90um: { max: 10, unit: '%',    clause: 'IS 4031 Part 1' },
    finenessBlaine:       { min: 225, unit: 'm\u00b2/kg', clause: 'IS 4031 Part 2' },
    initialSetting:       { min: 30, unit: 'min',  clause: 'IS 4031 Part 5' },
    finalSetting:         { max: 600, unit: 'min', clause: 'IS 4031 Part 5' },
    soundnessLeChatelier: { max: 10, unit: 'mm',   clause: 'IS 4031 Part 3' },
    soundnessAutoclave:   { max: 0.8, unit: '%',   clause: 'IS 4031 Part 3' }
  }
};

/* ===================================================================
 * IS 2386 / IS 383 — aggregates
 * =================================================================== */
const IS2386 = {

  /* Fineness modulus from cumulative percentage retained on the
     standard sieve set, divided by 100. IS 2386 Part 1. */
  finenessModulus(cumulativeRetainedPct) {
    const v = cumulativeRetainedPct.map(parseFloat).filter(isFinite);
    if (!v.length) return NaN;
    return Num.dp(v.reduce((a, b) => a + b, 0) / 100, 2);
  },

  /* Sieve analysis: converts retained masses into percentage retained,
     cumulative retained and percentage passing. */
  sieveAnalysis(rows) {
    const total = rows.reduce((a, r) => a + (parseFloat(r.retained) || 0), 0);
    let cum = 0;
    const out = rows.map(r => {
      const m = parseFloat(r.retained) || 0;
      const pct = total > 0 ? m / total * 100 : 0;
      cum += pct;
      return {
        sieve: r.sieve,
        retained: Num.dp(m, 1),
        pctRetained: Num.dp(pct, 1),
        cumRetained: Num.dp(cum, 1),
        passing: Num.dp(100 - cum, 1)
      };
    });
    return { rows: out, total: Num.dp(total, 1) };
  },

  /* Grading zones for fine aggregate, IS 383:2016 Table 4.
     Percentage passing limits by sieve size. */
  FINE_ZONES: {
    'Zone I':   { '10 mm': [100, 100], '4.75 mm': [90, 100], '2.36 mm': [60, 95],
                  '1.18 mm': [30, 70], '600 micron': [15, 34], '300 micron': [5, 20],
                  '150 micron': [0, 10] },
    'Zone II':  { '10 mm': [100, 100], '4.75 mm': [90, 100], '2.36 mm': [75, 100],
                  '1.18 mm': [55, 90], '600 micron': [35, 59], '300 micron': [8, 30],
                  '150 micron': [0, 10] },
    'Zone III': { '10 mm': [100, 100], '4.75 mm': [90, 100], '2.36 mm': [85, 100],
                  '1.18 mm': [75, 100], '600 micron': [60, 79], '300 micron': [12, 40],
                  '150 micron': [0, 10] },
    'Zone IV':  { '10 mm': [100, 100], '4.75 mm': [95, 100], '2.36 mm': [95, 100],
                  '1.18 mm': [90, 100], '600 micron': [80, 100], '300 micron': [15, 50],
                  '150 micron': [0, 15] }
  },

  /* Identify which grading zone a fine aggregate falls in. The 600
     micron sieve is the primary discriminator under IS 383. */
  classifyFineZone(passingBySieve) {
    const matches = [];
    Object.keys(IS2386.FINE_ZONES).forEach(zone => {
      const limits = IS2386.FINE_ZONES[zone];
      let ok = true;
      Object.keys(limits).forEach(sieve => {
        const p = parseFloat(passingBySieve[sieve]);
        if (!isFinite(p)) return;
        if (p < limits[sieve][0] || p > limits[sieve][1]) ok = false;
      });
      if (ok) matches.push(zone);
    });
    return matches.length ? matches.join(' / ')
                          : 'Does not conform to any zone of IS 383 Table 4';
  },

  /* Specific gravity and water absorption, IS 2386 Part 3. */
  specificGravity(ovenDryG, ssdG, inWaterG) {
    const A = parseFloat(ovenDryG), B = parseFloat(ssdG), C = parseFloat(inWaterG);
    return {
      apparent: Num.dp(A / (A - C), 2),
      bulkDry: Num.dp(A / (B - C), 2),
      bulkSSD: Num.dp(B / (B - C), 2),
      absorption: Num.dp((B - A) / A * 100, 2)
    };
  },

  /* Aggregate impact value and crushing value, IS 2386 Part 4.
     Both are the percentage of fines passing the 2.36 mm sieve. */
  percentFines(finesG, totalG) {
    const v = parseFloat(finesG) / parseFloat(totalG) * 100;
    return isFinite(v) ? Num.dp(v, 2) : NaN;
  },

  /* Flakiness and elongation indices, IS 2386 Part 1. */
  index(passingOrRetainedG, totalG) {
    const v = parseFloat(passingOrRetainedG) / parseFloat(totalG) * 100;
    return isFinite(v) ? Num.dp(v, 2) : NaN;
  },

  /* Permissible limits for coarse aggregate, IS 383:2016.
     Wearing surfaces attract the stricter limit.            CONFIGURABLE */
  LIMITS: {
    crushingValue:   { general: 45, wearing: 30, unit: '%', clause: 'IS 383 / IS 2386 Part 4' },
    impactValue:     { general: 45, wearing: 30, unit: '%', clause: 'IS 383 / IS 2386 Part 4' },
    abrasionValue:   { general: 50, wearing: 30, unit: '%', clause: 'IS 383 / IS 2386 Part 4' },
    combinedFlakinessElongation: { general: 40, wearing: 40, unit: '%', clause: 'IS 383' },
    waterAbsorption: { general: 2.0, wearing: 2.0, unit: '%', clause: 'IS 383' }
  }
};

/* Exposed on window for the plain-script loading used by index.html.
   Guarded so the file can also be require()'d by the test harness. */
if (typeof window !== 'undefined') {
  window.Num = Num;
  window.IS456 = IS456;
  window.IS516 = IS516;
  window.IS5816 = IS5816;
  window.IS1199 = IS1199;
  window.Durability = Durability;
  window.IS4031 = IS4031;
  window.IS2386 = IS2386;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Num, IS456, IS516, IS5816, IS1199, Durability, IS4031, IS2386 };
}
