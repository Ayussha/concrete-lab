/*
 * app.js — router and views
 * -------------------------
 * Hash routing so the app works from file:// as well as from a server.
 */

'use strict';

const App = (function () {

  const el = UI.el;
  let SETTINGS = null;

  /* =============================================================
   * helpers
   * ============================================================= */
  function testDef(id) {
    return (window.TEST_REGISTRY || []).find(t => t.id === id);
  }
  function categories() {
    const out = [];
    (window.TEST_REGISTRY || []).forEach(t => {
      if (out.indexOf(t.category) < 0) out.push(t.category);
    });
    return out;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function fmtDate(d) {
    if (!d) return '—';
    const parts = String(d).slice(0, 10).split('-');
    if (parts.length !== 3) return d;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }
  function go(hash) { location.hash = hash; }
  function esc(s) { return String(s === undefined || s === null ? '' : s); }

  /* Recompute a stored test from its saved inputs. Results are always
     derived, never trusted from storage, so a corrected calculation in
     standards.js flows through to every existing record. */
  function computeTest(rec, job) {
    const def = testDef(rec.testType);
    if (!def) return null;
    const ctx = {
      grade: job ? job.grade : null,
      sigma: job ? job.sigma : null,
      exposure: job ? job.exposure : null,
      wearing: job ? job.wearing === 'Yes' : false
    };
    try {
      return def.compute(rec.header || {}, rec.specimens || [], ctx);
    } catch (e) {
      return {
        table: null, summary: [{ label: 'Error', value: e.message, unit: '' }],
        verdict: { status: 'REVIEW', text: 'This test could not be calculated: ' + e.message },
        notes: []
      };
    }
  }

  /* The headline figure for a test, used in list views and the CSV.
     A test may name it with primaryLabel; otherwise take the first
     summary entry that carries a unit, since counts and labels do not.
     Falling back to summary[0] guarantees something is always shown. */
  function keySummary(def, result) {
    const rows = (result && result.summary) || [];
    if (!rows.length) return null;
    if (def && def.primaryLabel) {
      const named = rows.find(s => s.label === def.primaryLabel);
      if (named) return named;
    }
    return rows.find(s => s.unit && String(s.value) !== '—') ||
           rows.find(s => String(s.value) !== '—') || rows[0];
  }

  /* IS 456 Cl.16.1 assessment across all 28-day cube results on a job. */
  function jobAcceptance(job, tests) {
    const cubes = tests
      .filter(t => t.testType === 'cube-compressive')
      .filter(t => {
        const age = parseFloat((t.header || {}).age);
        return age >= 27 && age <= 29;
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const results = [];
    cubes.forEach(t => {
      const r = computeTest(t, job);
      if (!r) return;
      const row = (r.summary || []).find(s =>
        s.label === 'Average compressive strength');
      const v = row ? parseFloat(row.value) : NaN;
      if (isFinite(v)) results.push(v);
    });
    if (!job.grade) return null;
    const a = IS456.assessAcceptance(results, job.grade, job.sigma);
    a.sampleCount = cubes.length;
    return a;
  }

  /* =============================================================
   * dashboard
   * ============================================================= */
  function viewDashboard(host) {
    Promise.all([DB.all('jobs'), DB.all('tests')]).then(([jobs, tests]) => {
      const recent = tests.slice()
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, 8);
      const jobsById = {};
      jobs.forEach(j => { jobsById[j.id] = j; });

      /* Cubes cast but not yet tested at 28 days: any job with a 7-day
         cube result and no 28-day result after 28 days have passed. */
      const due = [];
      jobs.forEach(j => {
        const jt = tests.filter(t => t.jobId === j.id && t.testType === 'cube-compressive');
        const has28 = jt.some(t => parseFloat((t.header || {}).age) >= 27);
        const cast = jt.map(t => (t.header || {}).dateCast).filter(Boolean).sort()[0];
        if (!has28 && cast) {
          const days = Math.floor((Date.now() - new Date(cast).getTime()) / 86400000);
          if (days >= 26) due.push({ job: j, days: days, cast: cast });
        }
      });

      host.appendChild(el('div', { class: 'page-head' }, [
        el('h1', { text: 'Dashboard' }),
        el('div', { class: 'actions' }, [
          el('a', { class: 'btn', href: '#/job/new', text: '+ New job' })
        ])
      ]));

      host.appendChild(el('div', { class: 'stats' }, [
        stat('Jobs', jobs.length),
        stat('Tests recorded', tests.length),
        stat('Clients', new Set(jobs.map(j => j.clientName).filter(Boolean)).size),
        stat('28-day tests due', due.length, due.length ? 'warn' : '')
      ]));

      if (due.length) {
        const t = el('table', { class: 'results' });
        t.appendChild(el('thead', null, el('tr', null,
          ['Job', 'Project', 'Grade', 'Cast on', 'Days since cast'].map(h => el('th', { text: h })))));
        t.appendChild(el('tbody', null, due.map(d => el('tr', {
          class: 'clickable', onclick: () => go('#/job/' + d.job.id)
        }, [
          el('td', { text: d.job.jobNo }), el('td', { text: d.job.project || '—' }),
          el('td', { text: d.job.grade || '—' }), el('td', { text: fmtDate(d.cast) }),
          el('td', { text: String(d.days) })
        ]))));
        host.appendChild(section('28-day cube tests due', t,
          'Jobs with cubes cast at least 26 days ago and no 28-day result recorded.'));
      }

      if (!tests.length) {
        host.appendChild(UI.emptyState(
          'Nothing recorded yet',
          'Create a job for the client and site, then record tests against it. ' +
          'Set up your letterhead in Settings first so certificates print correctly.',
          'Create the first job', '#/job/new'));
        return;
      }

      const rt = el('table', { class: 'results' });
      rt.appendChild(el('thead', null, el('tr', null,
        ['Date', 'Job', 'Test', 'Key result', 'Verdict'].map(h => el('th', { text: h })))));
      rt.appendChild(el('tbody', null, recent.map(t => {
        const job = jobsById[t.jobId];
        const r = computeTest(t, job);
        const def = testDef(t.testType);
        const key = keySummary(def, r);
        return el('tr', { class: 'clickable', onclick: () => go('#/test/' + t.id) }, [
          el('td', { text: fmtDate(t.date) }),
          el('td', { text: job ? job.jobNo : '—' }),
          el('td', { text: def ? def.name : t.testType }),
          el('td', { text: key ? (key.value + (key.unit ? ' ' + key.unit : '')) : '—' }),
          el('td', null, r ? UI.badge(r.verdict.status) : '—')
        ]);
      })));
      host.appendChild(section('Recent tests', rt));
    });
  }

  function stat(label, value, kind) {
    return el('div', { class: 'stat ' + (kind || '') }, [
      el('span', { class: 'stat-value', text: String(value) }),
      el('span', { class: 'stat-label', text: label })
    ]);
  }
  function section(title, content, sub) {
    return el('section', { class: 'card' }, [
      el('h2', { text: title }),
      sub ? el('p', { class: 'muted', text: sub }) : null,
      content
    ]);
  }

  /* =============================================================
   * jobs
   * ============================================================= */
  function viewJobs(host) {
    DB.all('jobs').then(jobs => {
      jobs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      host.appendChild(el('div', { class: 'page-head' }, [
        el('h1', { text: 'Jobs' }),
        el('div', { class: 'actions' },
          el('a', { class: 'btn', href: '#/job/new', text: '+ New job' }))
      ]));
      if (!jobs.length) {
        host.appendChild(UI.emptyState('No jobs yet',
          'A job groups every test for one client, site and concrete grade. ' +
          'Certificates and the IS 456 acceptance check are both built per job.',
          'Create a job', '#/job/new'));
        return;
      }
      const t = el('table', { class: 'results' });
      t.appendChild(el('thead', null, el('tr', null,
        ['Job no.', 'Date', 'Client', 'Project', 'Grade', 'Element']
          .map(h => el('th', { text: h })))));
      t.appendChild(el('tbody', null, jobs.map(j => el('tr', {
        class: 'clickable', onclick: () => go('#/job/' + j.id)
      }, [
        el('td', { text: j.jobNo || '—' }), el('td', { text: fmtDate(j.date) }),
        el('td', { text: j.clientName || '—' }), el('td', { text: j.project || '—' }),
        el('td', { text: j.grade || '—' }), el('td', { text: j.element || '—' })
      ]))));
      host.appendChild(el('div', { class: 'card' }, el('div', { class: 'table-scroll' }, t)));
    });
  }

  const JOB_FIELDS = [
    { k: 'jobNo', label: 'Job number', type: 'text', required: true },
    { k: 'date', label: 'Date opened', type: 'date' },
    { k: 'clientName', label: 'Client', type: 'text', required: true },
    { k: 'project', label: 'Project / work', type: 'text' },
    { k: 'location', label: 'Site location', type: 'text' },
    { k: 'contractor', label: 'Contractor', type: 'text' },
    { k: 'element', label: 'Structural element', type: 'text',
      help: 'e.g. Raft slab, Pier P12, Column C4 at second floor' },
    { k: 'grade', label: 'Grade of concrete', type: 'select',
      options: [''].concat(IS456.GRADES), def: 'M25' },
    { k: 'sigma', label: 'Established standard deviation (N/mm²)', type: 'number',
      help: 'Leave blank to use the assumed value from IS 456 Table 8' },
    { k: 'exposure', label: 'Exposure condition', type: 'select',
      options: IS456.EXPOSURE.map(e => e.name), def: 'Moderate' },
    { k: 'wearing', label: 'Concrete wearing surface', type: 'select',
      options: ['No', 'Yes'], def: 'No' },
    { k: 'volume', label: 'Volume of concrete represented (m³)', type: 'number' },
    { k: 'supplier', label: 'Concrete supplier / plant', type: 'text' },
    { k: 'sampledBy', label: 'Sampled by', type: 'text' },
    { k: 'notes', label: 'Notes', type: 'textarea' }
  ];

  function viewJobForm(host, id) {
    const p = id ? DB.get('jobs', id) : Promise.resolve({ date: today() });
    p.then(job => {
      job = job || { date: today() };
      host.appendChild(el('div', { class: 'page-head' },
        el('h1', { text: id ? 'Edit job' : 'New job' })));

      const grid = el('div', { class: 'field-grid', 'data-scope': 'job' });
      JOB_FIELDS.forEach(f => grid.appendChild(UI.fieldNode(f, job[f.k])));
      const card = el('div', { class: 'card' }, [grid]);

      const hint = el('p', { class: 'muted' });
      function refreshHint() {
        const v = UI.readScope(grid, JOB_FIELDS);
        if (!v.grade) { hint.textContent = ''; return; }
        const a = IS456.assessAcceptance([], v.grade, v.sigma);
        const freq = IS456.samplingFrequency(v.volume);
        let txt = 'For ' + v.grade + ': individual results must be at least ' +
          a.individualLimit + ' N/mm² and the mean of four consecutive ' +
          'samples at least ' + a.meanLimit + ' N/mm² (' + a.meanLimitBasis +
          ', σ = ' + a.sigma + (a.sigmaAssumed ? ' assumed' : ' established') + ').';
        if (freq.samples) {
          txt += ' IS 456 Table 15 requires at least ' + freq.samples +
            ' sample(s) — ' + freq.cubesFor28Day + ' cubes for 28-day testing — ' +
            'for ' + freq.volume + ' m³.';
        }
        hint.textContent = txt;
      }
      grid.addEventListener('change', refreshHint);
      grid.addEventListener('input', refreshHint);
      card.appendChild(hint);

      card.appendChild(el('div', { class: 'form-actions' }, [
        el('button', { class: 'btn', text: 'Save job', onclick: function () {
          const v = UI.readScope(grid, JOB_FIELDS);
          if (!v.jobNo || !v.clientName) {
            UI.toast('Job number and client are required.', 'warn'); return;
          }
          DB.put('jobs', Object.assign({}, job, v)).then(saved => {
            UI.toast('Job saved.', 'ok'); go('#/job/' + saved.id);
          });
        } }),
        el('a', { class: 'btn ghost', href: id ? '#/job/' + id : '#/jobs', text: 'Cancel' })
      ]));
      host.appendChild(card);
      refreshHint();
    });
  }

  function viewJob(host, id) {
    Promise.all([DB.get('jobs', id), DB.byIndex('tests', 'jobId', id)])
      .then(([job, tests]) => {
        if (!job) { host.appendChild(UI.emptyState('Job not found', 'It may have been deleted.', 'Back to jobs', '#/jobs')); return; }
        tests.sort((a, b) => String(a.date).localeCompare(String(b.date)));

        host.appendChild(el('div', { class: 'page-head' }, [
          el('div', null, [
            el('h1', { text: job.jobNo }),
            el('p', { class: 'muted', text: [job.clientName, job.project, job.location]
              .filter(Boolean).join(' · ') })
          ]),
          el('div', { class: 'actions' }, [
            el('a', { class: 'btn', href: '#/test/new/' + job.id, text: '+ Record test' }),
            el('a', { class: 'btn ghost', href: '#/certificate/' + job.id, text: 'Certificate' }),
            el('a', { class: 'btn ghost', href: '#/job/edit/' + job.id, text: 'Edit' })
          ])
        ]));

        /* details */
        const dl = el('dl', { class: 'summary' });
        [['Date opened', fmtDate(job.date)], ['Contractor', job.contractor],
         ['Structural element', job.element], ['Grade', job.grade],
         ['Exposure condition', job.exposure], ['Supplier', job.supplier],
         ['Volume represented', job.volume ? job.volume + ' m³' : null],
         ['Sampled by', job.sampledBy], ['Notes', job.notes]
        ].forEach(([k, v]) => {
          if (!v) return;
          dl.appendChild(el('dt', { text: k }));
          dl.appendChild(el('dd', { text: String(v) }));
        });
        host.appendChild(section('Job details', dl));

        /* durability requirements for the exposure condition */
        const exp = IS456.EXPOSURE.find(e => e.name === job.exposure);
        if (exp && job.grade) {
          const ok = IS456.fck(job.grade) >= IS456.fck(exp.rccGrade);
          const d = el('div', null, [
            el('dl', { class: 'summary' }, [
              el('dt', { text: 'Minimum grade for reinforced concrete' }),
              el('dd', { text: exp.rccGrade }),
              el('dt', { text: 'Minimum cement content' }),
              el('dd', { text: exp.rccCement + ' kg/m³' }),
              el('dt', { text: 'Maximum free water–cement ratio' }),
              el('dd', { text: String(exp.rccWC) }),
              el('dt', { text: 'Nominal cover to reinforcement' }),
              el('dd', { text: exp.cover + ' mm' })
            ]),
            el('div', { class: 'verdict ' + (ok ? 'pass' : 'fail') }, [
              el('span', { class: 'verdict-tag', text: ok ? 'PASS' : 'FAIL' }),
              el('span', { text: job.grade + ' against the minimum of ' + exp.rccGrade +
                ' required for ' + exp.name.toLowerCase() + ' exposure (IS 456 Table 5).' })
            ])
          ]);
          host.appendChild(section('Durability requirements — ' + exp.name + ' exposure', d,
            'IS 456:2000 Table 5, for 20 mm nominal maximum size aggregate, ' +
            'reinforced concrete. Cover from Table 16.'));
        }

        /* IS 456 acceptance */
        const acc = jobAcceptance(job, tests);
        if (acc) host.appendChild(section('IS 456 acceptance — compressive strength',
          acceptanceNode(acc),
          'Based on ' + acc.sampleCount + ' sample(s) tested at 28 days, in date order.'));

        /* tests */
        if (!tests.length) {
          host.appendChild(UI.emptyState('No tests on this job yet',
            'Record a fresh concrete test at the point of pour, or cube results as they come off the machine.',
            'Record a test', '#/test/new/' + job.id));
        } else {
          const t = el('table', { class: 'results' });
          t.appendChild(el('thead', null, el('tr', null,
            ['Date', 'Test', 'Standard', 'Age', 'Key result', 'Verdict']
              .map(h => el('th', { text: h })))));
          t.appendChild(el('tbody', null, tests.map(rec => {
            const def = testDef(rec.testType);
            const r = computeTest(rec, job);
            const key = keySummary(def, r);
            return el('tr', { class: 'clickable', onclick: () => go('#/test/' + rec.id) }, [
              el('td', { text: fmtDate(rec.date) }),
              el('td', { text: def ? def.name : rec.testType }),
              el('td', { text: def ? def.code : '—' }),
              el('td', { text: (rec.header || {}).age ? (rec.header.age + ' d') : '—' }),
              el('td', { text: key ? (key.value + (key.unit ? ' ' + key.unit : '')) : '—' }),
              el('td', null, r ? UI.badge(r.verdict.status) : '—')
            ]);
          })));
          host.appendChild(section('Tests', el('div', { class: 'table-scroll' }, t)));
        }

        host.appendChild(el('div', { class: 'danger-zone' },
          el('button', { class: 'btn danger ghost', text: 'Delete this job and its tests',
            onclick: function () {
              UI.confirm('Delete job ' + job.jobNo + ' and all ' + tests.length +
                ' test record(s) on it? This cannot be undone.').then(yes => {
                if (!yes) return;
                Promise.all(tests.map(t2 => DB.remove('tests', t2.id)))
                  .then(() => DB.remove('jobs', job.id))
                  .then(() => { UI.toast('Job deleted.', 'ok'); go('#/jobs'); });
              });
            } })));
      });
  }

  function acceptanceNode(a) {
    const wrap = el('div');
    wrap.appendChild(el('dl', { class: 'summary' }, [
      el('dt', { text: 'Grade' }), el('dd', { text: a.grade }),
      el('dt', { text: 'Standard deviation used' }),
      el('dd', { text: a.sigma + ' N/mm² (' + (a.sigmaAssumed ? 'assumed, IS 456 Table 8' : 'established from site data') + ')' }),
      el('dt', { text: 'Mean of four must be at least' }),
      el('dd', { text: a.meanLimit + ' N/mm² (' + a.meanLimitBasis + ')' }),
      el('dt', { text: 'Each individual result must be at least' }),
      el('dd', { text: a.individualLimit + ' N/mm²' }),
      el('dt', { text: 'Results to date' }),
      el('dd', { text: a.count ? (a.count + ' — mean ' + a.mean + ', range ' + a.min + ' to ' + a.max) : 'none' })
    ]));

    if (a.groups.length) {
      const t = el('table', { class: 'results' });
      t.appendChild(el('thead', null, el('tr', null,
        ['Group', 'Results (N/mm²)', 'Mean', 'Required', 'Outcome']
          .map(h => el('th', { text: h })))));
      t.appendChild(el('tbody', null, a.groups.map(g => el('tr', null, [
        el('td', { text: 'Samples ' + g.from + '–' + g.to }),
        el('td', { text: g.results.join(', ') }),
        el('td', { text: String(g.mean) }),
        el('td', { text: String(g.limit) }),
        el('td', null, UI.badge(g.pass ? 'PASS' : 'FAIL'))
      ]))));
      wrap.appendChild(el('div', { class: 'table-scroll' }, t));
    }

    const failed = a.individual.filter(r => !r.pass);
    if (failed.length) {
      wrap.appendChild(el('p', { class: 'muted', text:
        'Individual results below the limit: ' +
        failed.map(r => 'sample ' + r.index + ' at ' + r.value + ' N/mm²').join('; ') + '.' }));
    }

    wrap.appendChild(el('div', { class: 'verdict ' + a.status.toLowerCase().replace(/ /g, '-') }, [
      el('span', { class: 'verdict-tag', text: a.status }),
      el('span', { text: a.status === 'COMPLIES'
        ? 'The concrete satisfies the acceptance criteria of IS 456 Cl. 16.1 on the results recorded so far.'
        : a.status === 'PROVISIONAL'
        ? 'Individual results are satisfactory, but four results are needed before the mean criterion can be applied.'
        : a.status === 'NO DATA'
        ? 'No 28-day cube results have been recorded against this job yet.'
        : 'The results recorded do not satisfy IS 456 Cl. 16.1. See IS 456 Cl. 17 for the action to be taken.' })
    ]));

    if (a.notes.length) {
      wrap.appendChild(el('ul', { class: 'notes' }, a.notes.map(n => el('li', { text: n }))));
    }
    return wrap;
  }

  /* =============================================================
   * tests
   * ============================================================= */
  function viewTestPicker(host, jobId) {
    DB.get('jobs', jobId).then(job => {
      host.appendChild(el('div', { class: 'page-head' }, [
        el('div', null, [
          el('h1', { text: 'Record a test' }),
          el('p', { class: 'muted', text: job ? (job.jobNo + ' · ' + (job.project || '')) : '' })
        ]),
        el('div', { class: 'actions' },
          el('a', { class: 'btn ghost', href: '#/job/' + jobId, text: 'Back to job' }))
      ]));
      categories().forEach(cat => {
        const list = el('div', { class: 'test-picker' });
        (window.TEST_REGISTRY || []).filter(t => t.category === cat).forEach(t => {
          list.appendChild(el('a', {
            class: 'picker-item', href: '#/test/new/' + jobId + '/' + t.id
          }, [
            el('strong', { text: t.name }),
            el('small', { text: t.code })
          ]));
        });
        host.appendChild(section(cat, list));
      });
    });
  }

  function viewTestForm(host, jobId, typeId, testId) {
    const pTest = testId ? DB.get('tests', testId) : Promise.resolve(null);
    pTest.then(rec => {
      const type = typeId || (rec && rec.testType);
      const jid = jobId || (rec && rec.jobId);
      const def = testDef(type);
      if (!def) {
        host.appendChild(UI.emptyState('Unknown test type',
          'The test type "' + esc(type) + '" is not in the registry.', 'Back', '#/jobs'));
        return;
      }
      DB.get('jobs', jid).then(job => {
        host.appendChild(el('div', { class: 'page-head' }, [
          el('div', null, [
            el('h1', { text: def.name }),
            el('p', { class: 'muted', text: def.code + (job ? ' · ' + job.jobNo : '') })
          ]),
          el('div', { class: 'actions' },
            el('a', { class: 'btn ghost', href: '#/job/' + jid, text: 'Back to job' }))
        ]));

        const meta = [
          { k: 'refNo', label: 'Test reference', type: 'text' },
          { k: 'date', label: 'Date of test', type: 'date', def: today() },
          { k: 'sampledBy', label: 'Sampled by', type: 'text' },
          { k: 'testedBy', label: 'Tested by', type: 'text' }
        ];
        const metaGrid = el('div', { class: 'field-grid', 'data-scope': 'meta' });
        meta.forEach(f => metaGrid.appendChild(UI.fieldNode(f, rec ? rec[f.k] : undefined)));

        const form = UI.buildForm(def, rec);
        const preview = el('div', { class: 'card preview' },
          el('p', { class: 'muted', text: 'Enter the readings and choose Calculate to see the result.' }));

        function calculate() {
          const data = form.read();
          const ctx = {
            grade: job ? job.grade : null, sigma: job ? job.sigma : null,
            exposure: job ? job.exposure : null, wearing: job ? job.wearing === 'Yes' : false
          };
          let r;
          try { r = def.compute(data.header, data.specimens, ctx); }
          catch (e) { UI.toast('Could not calculate: ' + e.message, 'warn'); return null; }
          UI.clear(preview);
          preview.appendChild(el('h2', { text: 'Result' }));
          preview.appendChild(UI.resultNode(r));
          return { data: data, result: r };
        }

        const card = el('div', { class: 'card' }, [
          el('h3', { text: 'Record' }), metaGrid, form,
          el('div', { class: 'form-actions' }, [
            el('button', { class: 'btn ghost', text: 'Calculate', onclick: calculate }),
            el('button', { class: 'btn', text: 'Save test', onclick: function () {
              const missing = form.validate();
              if (missing.length) {
                UI.toast('Required: ' + missing.slice(0, 3).join(', ') +
                  (missing.length > 3 ? ' and ' + (missing.length - 3) + ' more' : ''), 'warn');
                return;
              }
              const c = calculate();
              if (!c) return;
              const m = UI.readScope(metaGrid, meta);
              DB.put('tests', Object.assign({}, rec || {}, {
                jobId: jid, testType: type,
                refNo: m.refNo, date: m.date, sampledBy: m.sampledBy, testedBy: m.testedBy,
                header: c.data.header, specimens: c.data.specimens
              })).then(() => { UI.toast('Test saved.', 'ok'); go('#/job/' + jid); });
            } }),
            testId ? el('button', { class: 'btn danger ghost', text: 'Delete', onclick: function () {
              UI.confirm('Delete this test record? This cannot be undone.').then(yes => {
                if (!yes) return;
                DB.remove('tests', testId).then(() => { UI.toast('Test deleted.', 'ok'); go('#/job/' + jid); });
              });
            } }) : null
          ])
        ]);

        host.appendChild(card);
        host.appendChild(preview);
        if (rec) calculate();
      });
    });
  }

  function viewTest(host, id) {
    DB.get('tests', id).then(rec => {
      if (!rec) { host.appendChild(UI.emptyState('Test not found', '', 'Back', '#/register')); return; }
      DB.get('jobs', rec.jobId).then(job => {
        const def = testDef(rec.testType);
        const r = computeTest(rec, job);
        host.appendChild(el('div', { class: 'page-head' }, [
          el('div', null, [
            el('h1', { text: def ? def.name : rec.testType }),
            el('p', { class: 'muted', text: (def ? def.code : '') +
              (job ? ' · ' + job.jobNo + ' · ' + (job.project || '') : '') })
          ]),
          el('div', { class: 'actions' }, [
            el('a', { class: 'btn', href: '#/test/edit/' + rec.id, text: 'Edit' }),
            el('a', { class: 'btn ghost', href: '#/job/' + rec.jobId, text: 'Back to job' })
          ])
        ]));
        const dl = el('dl', { class: 'summary' });
        [['Test reference', rec.refNo], ['Date of test', fmtDate(rec.date)],
         ['Sampled by', rec.sampledBy], ['Tested by', rec.testedBy]
        ].forEach(([k, v]) => {
          if (!v) return;
          dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v }));
        });
        host.appendChild(section('Record', dl));

        /* the inputs as entered, so the certificate can be audited */
        const inputs = el('dl', { class: 'summary' });
        (def.header || []).forEach(f => {
          const v = (rec.header || {})[f.k];
          if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return;
          inputs.appendChild(el('dt', { text: f.label }));
          inputs.appendChild(el('dd', { text: Array.isArray(v) ? v.join(', ') : String(v) }));
        });
        host.appendChild(section('Inputs as recorded', inputs));
        host.appendChild(section('Result', UI.resultNode(r)));
      });
    });
  }

  /* =============================================================
   * register
   * ============================================================= */
  function viewRegister(host) {
    Promise.all([DB.all('tests'), DB.all('jobs')]).then(([tests, jobs]) => {
      const jobsById = {}; jobs.forEach(j => { jobsById[j.id] = j; });
      tests.sort((a, b) => String(b.date).localeCompare(String(a.date)));

      host.appendChild(el('div', { class: 'page-head' }, [
        el('h1', { text: 'Test register' }),
        el('div', { class: 'actions' }, [
          el('button', { class: 'btn ghost', text: 'Export CSV',
            onclick: () => Reports.exportRegisterCSV(rowsFor()) })
        ])
      ]));

      const filters = el('div', { class: 'filters' });
      const search = el('input', { type: 'search', placeholder: 'Search job, client, project or reference' });
      const typeSel = el('select', null, [el('option', { value: '', text: 'All tests' })]
        .concat((window.TEST_REGISTRY || []).map(t => el('option', { value: t.id, text: t.name }))));
      const verdictSel = el('select', null,
        ['', 'PASS', 'FAIL', 'REVIEW', 'INFO'].map(v =>
          el('option', { value: v, text: v || 'All verdicts' })));
      const fromD = el('input', { type: 'date' });
      const toD = el('input', { type: 'date' });
      [['Search', search], ['Test', typeSel], ['Verdict', verdictSel],
       ['From', fromD], ['To', toD]].forEach(([l, n]) => {
        filters.appendChild(el('div', { class: 'field' }, [el('label', { text: l }), n]));
      });

      const tableHost = el('div', { class: 'table-scroll' });
      const statsLine = el('p', { class: 'muted' });

      function rowsFor() {
        const q = search.value.trim().toLowerCase();
        return tests.filter(rec => {
          const job = jobsById[rec.jobId] || {};
          if (typeSel.value && rec.testType !== typeSel.value) return false;
          if (fromD.value && String(rec.date) < fromD.value) return false;
          if (toD.value && String(rec.date) > toD.value) return false;
          if (verdictSel.value) {
            const r = computeTest(rec, job);
            if (!r || r.verdict.status !== verdictSel.value) return false;
          }
          if (q) {
            const hay = [job.jobNo, job.clientName, job.project, job.element,
                         rec.refNo, (testDef(rec.testType) || {}).name]
              .filter(Boolean).join(' ').toLowerCase();
            if (hay.indexOf(q) < 0) return false;
          }
          return true;
        }).map(rec => ({ rec: rec, job: jobsById[rec.jobId] || {},
                         def: testDef(rec.testType) || {},
                         result: computeTest(rec, jobsById[rec.jobId]) }));
      }

      function render() {
        const rows = rowsFor();
        UI.clear(tableHost);
        const cubeVals = rows
          .filter(r => r.rec.testType === 'cube-compressive')
          .map(r => {
            const s = (r.result.summary || []).find(x => x.label === 'Average compressive strength');
            return s ? parseFloat(s.value) : NaN;
          }).filter(isFinite);
        statsLine.textContent = rows.length + ' record(s)' +
          (cubeVals.length >= 2
            ? ' · cube results: mean ' + Num.dp(Num.mean(cubeVals), 2) +
              ' N/mm², standard deviation ' + Num.dp(Num.stdDev(cubeVals), 2) +
              ' N/mm² over ' + cubeVals.length + ' samples'
            : '');

        if (!rows.length) {
          tableHost.appendChild(el('p', { class: 'muted', text: 'No records match these filters.' }));
          return;
        }
        const t = el('table', { class: 'results' });
        t.appendChild(el('thead', null, el('tr', null,
          ['Date', 'Job no.', 'Client', 'Element', 'Test', 'Standard', 'Key result', 'Verdict']
            .map(h => el('th', { text: h })))));
        t.appendChild(el('tbody', null, rows.map(r => {
          const key = keySummary(r.def, r.result);
          return el('tr', { class: 'clickable', onclick: () => go('#/test/' + r.rec.id) }, [
            el('td', { text: fmtDate(r.rec.date) }),
            el('td', { text: r.job.jobNo || '—' }),
            el('td', { text: r.job.clientName || '—' }),
            el('td', { text: r.job.element || '—' }),
            el('td', { text: r.def.name || r.rec.testType }),
            el('td', { text: r.def.code || '—' }),
            el('td', { text: key ? (key.value + (key.unit ? ' ' + key.unit : '')) : '—' }),
            el('td', null, UI.badge(r.result.verdict.status))
          ]);
        })));
        tableHost.appendChild(t);
      }

      [search, typeSel, verdictSel, fromD, toD].forEach(n => {
        n.addEventListener('input', render); n.addEventListener('change', render);
      });

      host.appendChild(el('div', { class: 'card' }, [filters, statsLine, tableHost]));
      render();
    });
  }

  /* =============================================================
   * standards reference
   * ============================================================= */
  function viewStandards(host) {
    host.appendChild(el('div', { class: 'page-head' },
      el('h1', { text: 'Standards reference' })));

    const calc = el('div', { class: 'card' });
    calc.appendChild(el('h2', { text: 'Acceptance and mix design calculator' }));
    const gradeSel = el('select', null, IS456.GRADES.map(g =>
      el('option', { value: g, text: g, selected: g === 'M30' })));
    const sigIn = el('input', { type: 'number', step: 'any', placeholder: 'blank = Table 8' });
    const volIn = el('input', { type: 'number', step: 'any', placeholder: 'm³' });
    const out = el('dl', { class: 'summary' });
    function recalc() {
      const g = gradeSel.value;
      const a = IS456.assessAcceptance([], g, sigIn.value);
      const t = IS456.targetMeanStrength(g, sigIn.value);
      const fr = IS456.samplingFrequency(volIn.value);
      UI.clear(out);
      [['Characteristic strength fₑₖ', a.fck + ' N/mm²'],
       ['Standard deviation σ', a.sigma + ' N/mm² (' + (a.sigmaAssumed ? 'assumed' : 'established') + ')'],
       ['Target mean strength (IS 10262)', t.target + ' N/mm², governed by ' + t.governedBy],
       ['Mean of four must be at least', a.meanLimit + ' N/mm² (' + a.meanLimitBasis + ')'],
       ['Each result must be at least', a.individualLimit + ' N/mm²'],
       ['Modulus of elasticity (Cl. 6.2.3.1)', IS456.modulusOfElasticity(a.fck) + ' N/mm²'],
       ['Flexural strength (Cl. 6.2.2)', IS456.flexuralStrengthExpected(a.fck) + ' N/mm²'],
       ['Minimum samples (Table 15)', fr.samples ? fr.samples + ' samples, ' + fr.cubesFor28Day + ' cubes at 28 days' : 'enter a volume']
      ].forEach(([k, v]) => {
        out.appendChild(el('dt', { text: k })); out.appendChild(el('dd', { text: String(v) }));
      });
    }
    [gradeSel, sigIn, volIn].forEach(n => {
      n.addEventListener('input', recalc); n.addEventListener('change', recalc);
    });
    calc.appendChild(el('div', { class: 'field-grid' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Grade' }), gradeSel]),
      el('div', { class: 'field' }, [el('label', { text: 'Established standard deviation' }), sigIn]),
      el('div', { class: 'field' }, [el('label', { text: 'Volume of concrete' }), volIn])
    ]));
    calc.appendChild(out);
    host.appendChild(calc);
    recalc();

    host.appendChild(section('Workability — IS 456 Table 7',
      simpleTable(['Placing condition', 'Degree', 'Slump', 'Compacting factor'],
        IS456.WORKABILITY.map(w => [w.placing, w.degree, w.slump, w.compactingFactor]))));

    host.appendChild(section('Durability — IS 456 Table 5 (20 mm aggregate)',
      simpleTable(['Exposure', 'Min cement, RCC (kg/m³)', 'Max w/c, RCC',
                   'Min grade, RCC', 'Nominal cover (mm)'],
        IS456.EXPOSURE.map(e => [e.name, e.rccCement, e.rccWC, e.rccGrade, e.cover])),
      'Cover values are from IS 456 Table 16.'));

    host.appendChild(section('Sampling frequency — IS 456 Table 15',
      simpleTable(['Volume of concrete in the work (m³)', 'Minimum number of samples'],
        [['1 – 5', '1'], ['6 – 15', '2'], ['16 – 30', '3'], ['31 – 50', '4'],
         ['51 and above', '4 plus one for each additional 50 m³ or part thereof']]),
      'One sample means three specimens for each age of test.'));

    host.appendChild(section('Chloride ion penetrability — ASTM C1202',
      simpleTable(['Charge passed (coulombs)', 'Penetrability'],
        [['Over 4000', 'High'], ['2000 – 4000', 'Moderate'], ['1000 – 2000', 'Low'],
         ['100 – 1000', 'Very low'], ['Under 100', 'Negligible']])));

    host.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'A note on these values' }),
      el('p', { text: 'The figures reproduced here are the ones the app uses in ' +
        'its calculations, transcribed from the standards named against each ' +
        'table. Standards are revised. Before issuing certificates, check these ' +
        'against your own current copies, and keep those copies to hand — this ' +
        'app is a calculation and record-keeping aid, not a substitute for the ' +
        'standard itself.' })
    ]));
  }

  function simpleTable(headers, rows) {
    const t = el('table', { class: 'results' });
    t.appendChild(el('thead', null, el('tr', null, headers.map(h => el('th', { text: h })))));
    t.appendChild(el('tbody', null, rows.map(r =>
      el('tr', null, r.map(c => el('td', { text: String(c) }))))));
    return el('div', { class: 'table-scroll' }, t);
  }

  /* =============================================================
   * settings
   * ============================================================= */
  const SETTING_FIELDS = [
    { k: 'labName', label: 'Laboratory name', type: 'text', required: true },
    { k: 'address', label: 'Address', type: 'textarea' },
    { k: 'phone', label: 'Telephone', type: 'text' },
    { k: 'email', label: 'Email', type: 'text' },
    { k: 'nablNumber', label: 'NABL / accreditation number', type: 'text' },
    { k: 'signatory', label: 'Authorised signatory', type: 'text' },
    { k: 'designation', label: 'Designation', type: 'text' },
    { k: 'certPrefix', label: 'Certificate number prefix', type: 'text' },
    { k: 'certCounter', label: 'Next certificate number', type: 'number' }
  ];

  function viewSettings(host) {
    DB.getSettings().then(s => {
      host.appendChild(el('div', { class: 'page-head' }, el('h1', { text: 'Settings' })));

      const grid = el('div', { class: 'field-grid', 'data-scope': 'settings' });
      SETTING_FIELDS.forEach(f => grid.appendChild(UI.fieldNode(f, s[f.k])));

      const logoPreview = el('div', { class: 'logo-preview' },
        s.logo ? el('img', { src: s.logo, alt: 'Laboratory logo' })
               : el('span', { class: 'muted', text: 'No logo set' }));
      let logoData = s.logo || '';
      const logoInput = el('input', { type: 'file', accept: 'image/*', onchange: function (e) {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 500000) { UI.toast('Please use a logo under 500 KB.', 'warn'); return; }
        const fr = new FileReader();
        fr.onload = function () {
          logoData = fr.result;
          UI.clear(logoPreview);
          logoPreview.appendChild(el('img', { src: logoData, alt: 'Laboratory logo' }));
        };
        fr.readAsDataURL(file);
      } });

      host.appendChild(el('div', { class: 'card' }, [
        el('h2', { text: 'Certificate letterhead' }),
        el('p', { class: 'muted', text: 'These details print at the head of every certificate.' }),
        grid,
        el('div', { class: 'field' }, [el('label', { text: 'Logo' }), logoInput, logoPreview]),
        el('div', { class: 'form-actions' },
          el('button', { class: 'btn', text: 'Save settings', onclick: function () {
            const v = UI.readScope(grid, SETTING_FIELDS);
            v.certCounter = parseInt(v.certCounter, 10) || 1;
            v.logo = logoData;
            DB.saveSettings(Object.assign({}, s, v)).then(() => {
              SETTINGS = null; UI.toast('Settings saved.', 'ok');
            });
          } }))
      ]));

      /* backup */
      const restoreInput = el('input', { type: 'file', accept: '.json,application/json',
        onchange: function (e) {
          const file = e.target.files[0];
          if (!file) return;
          const fr = new FileReader();
          fr.onload = function () {
            let data;
            try { data = JSON.parse(fr.result); }
            catch (err) { UI.toast('That file is not valid JSON.', 'warn'); return; }
            UI.confirm('Restore this backup? Records with the same identifier ' +
              'will be overwritten; anything else already here is kept.').then(yes => {
              if (!yes) return;
              DB.importAll(data, false).then(counts => {
                UI.toast('Restored ' + counts.jobs + ' job(s) and ' +
                  counts.tests + ' test(s).', 'ok');
              }).catch(err => UI.toast(err.message, 'warn'));
            });
          };
          fr.readAsText(file);
        } });

      host.appendChild(el('div', { class: 'card' }, [
        el('h2', { text: 'Backup and restore' }),
        el('p', { text: 'All records are stored in this browser on this device. ' +
          'Clearing site data, switching browser, or reinstalling will lose them. ' +
          'Export a backup regularly and keep it somewhere safe.' }),
        el('div', { class: 'form-actions' }, [
          el('button', { class: 'btn', text: 'Export backup (JSON)',
            onclick: () => Reports.exportBackup() }),
          el('button', { class: 'btn ghost', text: 'Export all tests (CSV)',
            onclick: function () {
              Promise.all([DB.all('tests'), DB.all('jobs')]).then(([tests, jobs]) => {
                const jobsById = {}; jobs.forEach(j => { jobsById[j.id] = j; });
                Reports.exportRegisterCSV(tests.map(rec => ({
                  rec: rec, job: jobsById[rec.jobId] || {},
                  def: testDef(rec.testType) || {},
                  result: computeTest(rec, jobsById[rec.jobId])
                })));
              });
            } })
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Restore from a backup file' }), restoreInput
        ])
      ]));

      host.appendChild(el('div', { class: 'danger-zone' },
        el('button', { class: 'btn danger ghost', text: 'Erase all data on this device',
          onclick: function () {
            UI.confirm('Erase every job, test and setting stored in this browser? ' +
              'Export a backup first — this cannot be undone.').then(yes => {
              if (!yes) return;
              DB.wipe().then(() => { UI.toast('All data erased.', 'ok'); go('#/'); });
            });
          } })));
    });
  }

  /* =============================================================
   * router
   * ============================================================= */
  const ROUTES = [
    [/^#?\/?$/,                     (h) => viewDashboard(h)],
    [/^#\/jobs$/,                   (h) => viewJobs(h)],
    [/^#\/job\/new$/,               (h) => viewJobForm(h, null)],
    [/^#\/job\/edit\/(.+)$/,        (h, m) => viewJobForm(h, m[1])],
    [/^#\/job\/(.+)$/,              (h, m) => viewJob(h, m[1])],
    [/^#\/test\/new\/([^/]+)$/,     (h, m) => viewTestPicker(h, m[1])],
    [/^#\/test\/new\/([^/]+)\/(.+)$/, (h, m) => viewTestForm(h, m[1], m[2], null)],
    [/^#\/test\/edit\/(.+)$/,       (h, m) => viewTestForm(h, null, null, m[1])],
    [/^#\/test\/(.+)$/,             (h, m) => viewTest(h, m[1])],
    [/^#\/register$/,               (h) => viewRegister(h)],
    [/^#\/standards$/,              (h) => viewStandards(h)],
    [/^#\/settings$/,               (h) => viewSettings(h)],
    [/^#\/certificate\/(.+)$/,      (h, m) => Reports.viewCertificate(h, m[1], {
      computeTest: computeTest, jobAcceptance: jobAcceptance, testDef: testDef
    })]
  ];

  function route() {
    const hash = location.hash || '#/';
    const host = UI.qs('#view');
    UI.clear(host);
    window.scrollTo(0, 0);
    document.body.classList.remove('printing');

    for (let i = 0; i < ROUTES.length; i++) {
      const m = hash.match(ROUTES[i][0]);
      if (m) {
        try { ROUTES[i][1](host, m); }
        catch (e) {
          host.appendChild(UI.emptyState('Something went wrong', e.message, 'Back to dashboard', '#/'));
        }
        highlightNav(hash);
        return;
      }
    }
    host.appendChild(UI.emptyState('Page not found', 'That address does not exist.', 'Back to dashboard', '#/'));
  }

  function highlightNav(hash) {
    document.querySelectorAll('nav a').forEach(a => {
      const href = a.getAttribute('href');
      const active = href === '#/'
        ? (hash === '#/' || hash === '')
        : hash.indexOf(href) === 0;
      a.classList.toggle('active', active);
    });
  }

  function start() {
    window.addEventListener('hashchange', route);
    DB.open().then(() => {
      route();
    }).catch(e => {
      UI.qs('#view').appendChild(UI.emptyState(
        'Local storage is unavailable',
        'This app stores records in the browser database. ' + e.message +
        ' Private browsing windows and some locked-down browser settings block it.',
        null, null));
    });
  }

  return { start: start, computeTest: computeTest, jobAcceptance: jobAcceptance,
           testDef: testDef, fmtDate: fmtDate, section: section,
           keySummary: keySummary };
})();

if (typeof window !== 'undefined') window.App = App;
