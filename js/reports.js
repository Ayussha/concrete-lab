/*
 * reports.js — test certificates, the register export and backups
 * ---------------------------------------------------------------
 * Certificates are rendered as ordinary page content and printed with
 * the browser's own print dialogue, which also produces the PDF. That
 * keeps the output identical on paper and on screen and avoids pulling
 * in a PDF library, so the app stays fully offline.
 */

'use strict';

const Reports = (function () {

  const el = UI.el;

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(v) {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) {
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  }
  function stamp() {
    return new Date().toISOString().slice(0, 10);
  }

  /* ---- register export ----------------------------------------- */
  function exportRegisterCSV(rows) {
    if (!rows || !rows.length) { UI.toast('Nothing to export.', 'warn'); return; }
    const header = ['Date', 'Job no.', 'Client', 'Project', 'Location', 'Element',
                    'Grade', 'Test', 'Standard', 'Test ref.', 'Age (days)',
                    'Key result', 'Key result name', 'Unit', 'Verdict',
                    'Verdict detail', 'Tested by'];
    const out = [header];
    rows.forEach(r => {
      const key = App.keySummary(r.def, r.result) || {};
      out.push([
        r.rec.date, r.job.jobNo, r.job.clientName, r.job.project, r.job.location,
        r.job.element, r.job.grade, r.def.name || r.rec.testType, r.def.code,
        r.rec.refNo, (r.rec.header || {}).age,
        key.value, key.label, key.unit, r.result && r.result.verdict.status,
        r.result && r.result.verdict.text, r.rec.testedBy
      ]);
    });
    download('test-register-' + stamp() + '.csv', toCSV(out), 'text/csv;charset=utf-8');
    UI.toast('Exported ' + rows.length + ' record(s).', 'ok');
  }

  function exportBackup() {
    DB.exportAll().then(data => {
      download('concrete-lab-backup-' + stamp() + '.json',
        JSON.stringify(data, null, 2), 'application/json');
      UI.toast('Backup exported. Keep it somewhere outside this device.', 'ok');
    });
  }

  /* ---- certificate --------------------------------------------- */
  function viewCertificate(host, jobId, api) {
    Promise.all([
      DB.get('jobs', jobId),
      DB.byIndex('tests', 'jobId', jobId),
      DB.getSettings()
    ]).then(([job, tests, settings]) => {
      if (!job) {
        host.appendChild(UI.emptyState('Job not found', '', 'Back to jobs', '#/jobs'));
        return;
      }
      tests.sort((a, b) => String(a.date).localeCompare(String(b.date)));

      /* ---- controls (not printed) ---- */
      const selected = {};
      tests.forEach(t => { selected[t.id] = true; });
      const refInput = el('input', { type: 'text', value: job.certificateRef || '',
        placeholder: 'Assign or type a certificate number' });
      const issueDate = el('input', { type: 'date', value: stamp() });

      const checkList = el('div', { class: 'check-list' });
      tests.forEach(t => {
        const def = api.testDef(t.testType);
        const cb = el('input', { type: 'checkbox', checked: 'checked',
          onchange: function (e) { selected[t.id] = e.target.checked; renderDoc(); } });
        checkList.appendChild(el('label', { class: 'check' }, [
          cb, el('span', { text: (def ? def.name : t.testType) + ' — ' +
            App.fmtDate(t.date) + ((t.header || {}).age ? ' (' + t.header.age + ' d)' : '') })
        ]));
      });

      const controls = el('div', { class: 'card no-print' }, [
        el('h2', { text: 'Certificate' }),
        el('div', { class: 'field-grid' }, [
          el('div', { class: 'field' }, [
            el('label', { text: 'Certificate number' }),
            refInput,
            el('small', { class: 'help', text: 'Numbers are issued in sequence and never reused.' })
          ]),
          el('div', { class: 'field' }, [
            el('label', { text: 'Date of issue' }), issueDate
          ])
        ]),
        el('div', { class: 'form-actions' }, [
          el('button', { class: 'btn ghost', text: 'Assign next number', onclick: function () {
            DB.nextCertificateNumber().then(ref => {
              refInput.value = ref;
              DB.put('jobs', Object.assign({}, job, { certificateRef: ref }));
              renderDoc();
              UI.toast('Certificate number ' + ref + ' assigned.', 'ok');
            });
          } }),
          el('button', { class: 'btn', text: 'Print / save as PDF', onclick: function () {
            if (!refInput.value) {
              UI.toast('Assign a certificate number before printing.', 'warn');
              return;
            }
            renderDoc();
            window.print();
          } }),
          el('a', { class: 'btn ghost', href: '#/job/' + job.id, text: 'Back to job' })
        ]),
        el('h3', { text: 'Tests to include' }),
        tests.length ? checkList : el('p', { class: 'muted', text: 'No tests recorded on this job.' })
      ]);
      host.appendChild(controls);
      refInput.addEventListener('input', renderDoc);
      issueDate.addEventListener('change', renderDoc);

      /* ---- the document itself ---- */
      const doc = el('div', { class: 'certificate' });
      host.appendChild(doc);

      function renderDoc() {
        UI.clear(doc);
        const included = tests.filter(t => selected[t.id]);

        /* letterhead */
        doc.appendChild(el('header', { class: 'cert-head' }, [
          settings.logo ? el('img', { class: 'cert-logo', src: settings.logo, alt: '' }) : null,
          el('div', { class: 'cert-lab' }, [
            el('h1', { text: settings.labName || 'Concrete Testing Laboratory' }),
            settings.address ? el('p', { class: 'cert-addr', text: settings.address }) : null,
            el('p', { class: 'cert-addr', text: [
              settings.phone ? 'Tel: ' + settings.phone : '',
              settings.email || ''
            ].filter(Boolean).join('  ·  ') }),
            settings.nablNumber
              ? el('p', { class: 'cert-addr', text: 'Accreditation no.: ' + settings.nablNumber })
              : null
          ])
        ]));

        doc.appendChild(el('h2', { class: 'cert-title', text: 'TEST CERTIFICATE' }));

        /* identification block */
        const idRows = [
          ['Certificate no.', refInput.value || '—', 'Date of issue', App.fmtDate(issueDate.value)],
          ['Job no.', job.jobNo || '—', 'Date opened', App.fmtDate(job.date)],
          ['Client', job.clientName || '—', 'Contractor', job.contractor || '—'],
          ['Project', job.project || '—', 'Site', job.location || '—'],
          ['Structural element', job.element || '—', 'Grade of concrete', job.grade || '—'],
          ['Supplier / plant', job.supplier || '—', 'Exposure condition', job.exposure || '—'],
          ['Volume represented', job.volume ? job.volume + ' m³' : '—', 'Sampled by', job.sampledBy || '—']
        ];
        const idt = el('table', { class: 'cert-id' });
        idRows.forEach(r => {
          idt.appendChild(el('tr', null, [
            el('th', { text: r[0] }), el('td', { text: String(r[1]) }),
            el('th', { text: r[2] }), el('td', { text: String(r[3]) })
          ]));
        });
        doc.appendChild(idt);

        if (!included.length) {
          doc.appendChild(el('p', { class: 'muted', text:
            'No tests selected. Tick at least one test above to build the certificate.' }));
          return;
        }

        /* one block per test */
        included.forEach((rec, i) => {
          const def = api.testDef(rec.testType);
          const r = api.computeTest(rec, job);
          const block = el('section', { class: 'cert-test' });
          block.appendChild(el('h3', { text: (i + 1) + '. ' + (def ? def.name : rec.testType) }));
          block.appendChild(el('p', { class: 'cert-method', text:
            'Method: ' + (def ? def.code : '—') +
            '   |   Date of test: ' + App.fmtDate(rec.date) +
            (rec.refNo ? '   |   Ref: ' + rec.refNo : '') +
            (rec.testedBy ? '   |   Tested by: ' + rec.testedBy : '') }));

          if (r.table) {
            const t = el('table', { class: 'cert-data' });
            t.appendChild(el('thead', null, el('tr', null,
              r.table.headers.map(h => el('th', { text: h })))));
            t.appendChild(el('tbody', null, r.table.rows.map(row =>
              el('tr', null, row.map(c => el('td', { text: String(c) }))))));
            block.appendChild(t);
          }

          if (r.summary && r.summary.length) {
            const st = el('table', { class: 'cert-summary' });
            r.summary.forEach(s => {
              st.appendChild(el('tr', null, [
                el('th', { text: s.label }),
                el('td', { text: String(s.value) + (s.unit ? ' ' + s.unit : '') })
              ]));
            });
            block.appendChild(st);
          }

          block.appendChild(el('p', { class: 'cert-verdict' }, [
            el('strong', { text: 'Result: ' + r.verdict.status + '. ' }),
            el('span', { text: r.verdict.text })
          ]));

          if (r.notes && r.notes.length) {
            block.appendChild(el('ul', { class: 'cert-notes' },
              r.notes.map(nn => el('li', { text: nn }))));
          }
          doc.appendChild(block);
        });

        /* acceptance summary */
        const acc = api.jobAcceptance(job, included);
        if (acc && acc.count) {
          const block = el('section', { class: 'cert-test' });
          block.appendChild(el('h3', { text: 'Acceptance criteria — IS 456:2000 Cl. 16.1' }));
          const st = el('table', { class: 'cert-summary' });
          [['Grade', acc.grade],
           ['Standard deviation used', acc.sigma + ' N/mm² (' +
             (acc.sigmaAssumed ? 'assumed, IS 456 Table 8' : 'established from site data') + ')'],
           ['Mean of four consecutive samples, minimum', acc.meanLimit + ' N/mm²'],
           ['Individual sample result, minimum', acc.individualLimit + ' N/mm²'],
           ['Samples assessed', String(acc.count)],
           ['Mean of all results', acc.mean + ' N/mm²'],
           ['Range', acc.min + ' to ' + acc.max + ' N/mm²']
          ].forEach(([k, v]) => {
            st.appendChild(el('tr', null, [el('th', { text: k }), el('td', { text: String(v) })]));
          });
          block.appendChild(st);

          if (acc.groups.length) {
            const gt = el('table', { class: 'cert-data' });
            gt.appendChild(el('thead', null, el('tr', null,
              ['Group', 'Results (N/mm²)', 'Mean', 'Required', 'Outcome']
                .map(h => el('th', { text: h })))));
            gt.appendChild(el('tbody', null, acc.groups.map(g => el('tr', null, [
              el('td', { text: 'Samples ' + g.from + '–' + g.to }),
              el('td', { text: g.results.join(', ') }),
              el('td', { text: String(g.mean) }),
              el('td', { text: String(g.limit) }),
              el('td', { text: g.pass ? 'Complies' : 'Does not comply' })
            ]))));
            block.appendChild(gt);
          }

          block.appendChild(el('p', { class: 'cert-verdict' },
            el('strong', { text: 'Conclusion: ' + acc.status + '.' })));
          if (acc.notes.length) {
            block.appendChild(el('ul', { class: 'cert-notes' },
              acc.notes.map(nn => el('li', { text: nn }))));
          }
          doc.appendChild(block);
        }

        /* signature and footer */
        doc.appendChild(el('div', { class: 'cert-sign' }, [
          el('div', { class: 'sign-box' }, [
            el('div', { class: 'sign-line' }),
            el('p', { text: settings.signatory || '' }),
            el('p', { class: 'cert-addr', text: settings.designation || '' }),
            el('p', { class: 'cert-addr', text: 'For ' + (settings.labName || '') })
          ])
        ]));

        doc.appendChild(el('footer', { class: 'cert-foot' }, [
          el('p', { text: 'This certificate relates only to the samples described ' +
            'above, as received and identified by the laboratory. It shall not be ' +
            'reproduced except in full without the written approval of the ' +
            'laboratory.' }),
          el('p', { text: 'Certificate no. ' + (refInput.value || '—') +
            '  ·  Page generated ' + App.fmtDate(stamp()) })
        ]));
      }

      renderDoc();
    });
  }

  return {
    viewCertificate: viewCertificate,
    exportRegisterCSV: exportRegisterCSV,
    exportBackup: exportBackup,
    download: download
  };
})();

if (typeof window !== 'undefined') window.Reports = Reports;
