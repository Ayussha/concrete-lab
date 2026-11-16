/*
 * ui.js — DOM helpers and the generic form renderer
 * -------------------------------------------------
 * Every test in the registry is rendered by buildForm() from its own
 * field definitions, so no test needs bespoke UI code.
 */

'use strict';

const UI = (function () {

  /* ---- element construction ------------------------------------ */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(k => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else node.setAttribute(k, v);
      });
    }
    (Array.isArray(children) ? children : (children ? [children] : []))
      .forEach(c => {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'object' ? c : document.createTextNode(c));
      });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function qs(sel, root) { return (root || document).querySelector(sel); }

  /* ---- feedback ------------------------------------------------ */
  let toastTimer = null;
  function toast(message, kind) {
    const host = qs('#toast');
    if (!host) return;
    host.className = 'toast show ' + (kind || 'info');
    host.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { host.className = 'toast'; }, 4200);
  }

  function confirmAction(message) {
    return new Promise(resolve => {
      const backdrop = el('div', { class: 'modal-backdrop' });
      const box = el('div', { class: 'modal' }, [
        el('p', { text: message }),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn ghost', onclick: () => { close(); resolve(false); }, text: 'Cancel' }),
          el('button', { class: 'btn danger', onclick: () => { close(); resolve(true); }, text: 'Continue' })
        ])
      ]);
      function close() { document.body.removeChild(backdrop); }
      backdrop.appendChild(box);
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) { close(); resolve(false); }
      });
      document.body.appendChild(backdrop);
    });
  }

  /* ---- single field -------------------------------------------- */
  function fieldNode(fl, value) {
    let input;
    const id = 'f_' + fl.k + '_' + Math.random().toString(36).slice(2, 7);

    if (fl.type === 'select') {
      input = el('select', { id: id, 'data-k': fl.k });
      fl.options.forEach(o => {
        const opt = el('option', { value: String(o), text: String(o) });
        if (String(value !== undefined && value !== '' ? value : fl.def) === String(o)) {
          opt.selected = true;
        }
        input.appendChild(opt);
      });
    } else if (fl.type === 'textarea') {
      input = el('textarea', { id: id, 'data-k': fl.k, rows: 3 });
      input.value = value !== undefined ? value : (fl.def || '');
    } else {
      input = el('input', {
        id: id, 'data-k': fl.k,
        type: fl.type === 'date' ? 'date' : (fl.type === 'text' ? 'text' : 'number'),
        step: fl.type === 'number' ? 'any' : null,
        inputmode: fl.type === 'number' ? 'decimal' : null
      });
      const v = value !== undefined && value !== null ? value
              : (fl.def !== undefined ? fl.def : '');
      input.value = v;
    }
    if (fl.required) input.setAttribute('required', 'required');

    return el('div', { class: 'field' + (fl.required ? ' required' : '') }, [
      el('label', { for: id, text: fl.label }),
      input,
      fl.help ? el('small', { class: 'help', text: fl.help }) : null
    ]);
  }

  /* ---- repeating numeric list ---------------------------------- */
  function listNode(fl, values) {
    const wrap = el('div', { class: 'list-field', 'data-k': fl.k });
    const rows = el('div', { class: 'list-rows' });
    const initial = (values && values.length) ? values
                  : new Array(fl.def || 3).fill('');

    function addRow(v, index) {
      const row = el('div', { class: 'list-row' }, [
        el('span', { class: 'list-idx', text: String(index + 1) }),
        el('input', { type: 'number', step: 'any', inputmode: 'decimal',
                      value: v === undefined ? '' : v, 'data-list': '1' }),
        el('button', {
          class: 'btn tiny ghost', type: 'button', title: 'Remove this reading',
          text: '×',
          onclick: function () { rows.removeChild(row); renumber(); }
        })
      ]);
      rows.appendChild(row);
    }
    function renumber() {
      Array.prototype.forEach.call(rows.children, (r, i) => {
        r.firstChild.textContent = String(i + 1);
      });
    }
    initial.forEach(addRow);

    wrap.appendChild(el('label', { text: fl.label }));
    if (fl.help) wrap.appendChild(el('small', { class: 'help', text: fl.help }));
    wrap.appendChild(rows);
    wrap.appendChild(el('button', {
      class: 'btn tiny', type: 'button', text: '+ Add reading',
      onclick: function () { addRow('', rows.children.length); }
    }));
    return wrap;
  }

  /* ---- fixed-row table (sieve analysis) ------------------------- */
  function tableNode(tb, values) {
    const wrap = el('div', { class: 'table-field', 'data-k': tb.k });
    wrap.appendChild(el('label', { text: tb.label }));
    const table = el('table', { class: 'data-entry' });
    table.appendChild(el('thead', null, el('tr', null,
      [el('th', { text: tb.rowLabel })].concat(
        tb.columns.map(c => el('th', { text: c.label }))))));
    const tbody = el('tbody');
    tb.rows.forEach((rowLabel, i) => {
      const existing = (values || []).find(v => v.sieve === rowLabel) || {};
      const cells = [el('th', { class: 'row-label', text: rowLabel,
                                'data-row': rowLabel })];
      tb.columns.forEach(c => {
        cells.push(el('td', null, el('input', {
          type: 'number', step: 'any', inputmode: 'decimal',
          'data-col': c.k, value: existing[c.k] !== undefined ? existing[c.k] : ''
        })));
      });
      tbody.appendChild(el('tr', null, cells));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  /* ---- reading values back out --------------------------------- */
  function readScope(scope, fields) {
    const out = {};
    (fields || []).forEach(fl => {
      const node = scope.querySelector('[data-k="' + fl.k + '"]');
      if (!node) return;
      if (fl.type === 'list') {
        out[fl.k] = Array.prototype.map
          .call(node.querySelectorAll('input[data-list]'), i => i.value)
          .filter(v => v !== '');
      } else {
        out[fl.k] = node.value;
      }
    });
    return out;
  }

  function readTables(scope, fieldTables) {
    const out = {};
    (fieldTables || []).forEach(tb => {
      const node = scope.querySelector('[data-k="' + tb.k + '"]');
      if (!node) return;
      out[tb.k] = Array.prototype.map.call(node.querySelectorAll('tbody tr'), tr => {
        const rec = { sieve: tr.querySelector('.row-label').dataset.row };
        tr.querySelectorAll('input[data-col]').forEach(inp => {
          rec[inp.dataset.col] = inp.value;
        });
        return rec;
      });
    });
    return out;
  }

  /* ---- whole test form ----------------------------------------- */
  function buildForm(def, existing) {
    existing = existing || {};
    const header = existing.header || {};
    const specimens = existing.specimens || [];

    const root = el('div', { class: 'test-form' });

    /* header fields */
    const headerFields = (def.header || []).filter(fl => fl.type !== 'list');
    const listFields = (def.header || []).filter(fl => fl.type === 'list');

    if (headerFields.length) {
      root.appendChild(el('h3', { text: 'Test details' }));
      const grid = el('div', { class: 'field-grid', 'data-scope': 'header' });
      headerFields.forEach(fl => grid.appendChild(fieldNode(fl, header[fl.k])));
      root.appendChild(grid);
    }
    listFields.forEach(fl => {
      const host = el('div', { class: 'field-grid single', 'data-scope': 'header' });
      host.appendChild(listNode(fl, header[fl.k]));
      root.appendChild(host);
    });
    (def.fieldTables || []).forEach(tb => {
      const host = el('div', { class: 'field-grid single', 'data-scope': 'header' });
      host.appendChild(tableNode(tb, header[tb.k]));
      root.appendChild(host);
    });

    /* specimen block */
    let specHost = null;
    if (def.specimens) {
      const s = def.specimens;
      root.appendChild(el('h3', { text: s.label + 's' }));
      specHost = el('div', { class: 'specimens', 'data-scope': 'specimens' });

      function addSpecimen(values, index) {
        const card = el('div', { class: 'specimen' });
        card.appendChild(el('div', { class: 'specimen-head' }, [
          el('strong', { text: s.label + ' ' + (index + 1) }),
          el('button', {
            class: 'btn tiny ghost', type: 'button', text: 'Remove',
            onclick: function () {
              if (specHost.children.length <= s.min) {
                toast('At least ' + s.min + ' ' + s.label.toLowerCase() +
                      ' is required for this test.', 'warn');
                return;
              }
              specHost.removeChild(card); renumberSpecimens();
            }
          })
        ]));
        const grid = el('div', { class: 'field-grid' });
        s.fields.forEach(fl => grid.appendChild(fieldNode(fl, (values || {})[fl.k])));
        card.appendChild(grid);
        specHost.appendChild(card);
      }
      function renumberSpecimens() {
        Array.prototype.forEach.call(specHost.children, (c, i) => {
          c.querySelector('.specimen-head strong').textContent = s.label + ' ' + (i + 1);
        });
      }

      const count = specimens.length || s.def;
      for (let i = 0; i < count; i++) addSpecimen(specimens[i], i);
      root.appendChild(specHost);
      root.appendChild(el('button', {
        class: 'btn tiny', type: 'button', text: '+ Add ' + s.label.toLowerCase(),
        onclick: function () {
          if (specHost.children.length >= s.max) {
            toast('This test allows at most ' + s.max + ' ' +
                  s.label.toLowerCase() + 's.', 'warn');
            return;
          }
          addSpecimen({}, specHost.children.length);
        }
      }));
    }

    /* read the whole form back */
    root.read = function () {
      const headerScopes = root.querySelectorAll('[data-scope="header"]');
      let h = {};
      Array.prototype.forEach.call(headerScopes, sc => {
        Object.assign(h, readScope(sc, def.header));
        Object.assign(h, readTables(sc, def.fieldTables));
      });
      const sp = [];
      if (specHost) {
        Array.prototype.forEach.call(specHost.children, card => {
          sp.push(readScope(card, def.specimens.fields));
        });
      }
      return { header: h, specimens: sp };
    };

    /* check required fields; returns an array of missing labels */
    root.validate = function () {
      const missing = [];
      const data = root.read();
      (def.header || []).forEach(fl => {
        if (fl.required && (data.header[fl.k] === '' ||
            data.header[fl.k] === undefined)) missing.push(fl.label);
      });
      if (def.specimens) {
        data.specimens.forEach((sp, i) => {
          def.specimens.fields.forEach(fl => {
            if (fl.required && (sp[fl.k] === '' || sp[fl.k] === undefined)) {
              missing.push(def.specimens.label + ' ' + (i + 1) + ' — ' + fl.label);
            }
          });
        });
      }
      return missing;
    };

    return root;
  }

  /* ---- result rendering ---------------------------------------- */
  function resultNode(result) {
    if (!result) return el('p', { class: 'muted', text: 'No result yet.' });
    const wrap = el('div', { class: 'result' });

    if (result.table) {
      const t = el('table', { class: 'results' });
      t.appendChild(el('thead', null, el('tr', null,
        result.table.headers.map(h => el('th', { text: h })))));
      t.appendChild(el('tbody', null, result.table.rows.map(r =>
        el('tr', null, r.map(c => el('td', { text: String(c) }))))));
      wrap.appendChild(el('div', { class: 'table-scroll' }, t));
    }

    if (result.summary && result.summary.length) {
      const dl = el('dl', { class: 'summary' });
      result.summary.forEach(s => {
        dl.appendChild(el('dt', { text: s.label }));
        dl.appendChild(el('dd', { text: String(s.value) + (s.unit ? ' ' + s.unit : '') }));
      });
      wrap.appendChild(dl);
    }

    if (result.verdict) {
      wrap.appendChild(el('div', { class: 'verdict ' + result.verdict.status.toLowerCase() }, [
        el('span', { class: 'verdict-tag', text: result.verdict.status }),
        el('span', { text: result.verdict.text })
      ]));
    }

    if (result.notes && result.notes.length) {
      wrap.appendChild(el('ul', { class: 'notes' },
        result.notes.map(n2 => el('li', { text: n2 }))));
    }
    return wrap;
  }

  function badge(status) {
    return el('span', { class: 'badge ' + String(status).toLowerCase(), text: status });
  }

  function emptyState(title, body, actionLabel, actionHref) {
    return el('div', { class: 'empty' }, [
      el('h3', { text: title }),
      el('p', { text: body }),
      actionLabel ? el('a', { class: 'btn', href: actionHref, text: actionLabel }) : null
    ]);
  }

  return {
    el: el, clear: clear, qs: qs, toast: toast, confirm: confirmAction,
    buildForm: buildForm, resultNode: resultNode, badge: badge,
    emptyState: emptyState, fieldNode: fieldNode, readScope: readScope
  };
})();

if (typeof window !== 'undefined') window.UI = UI;
