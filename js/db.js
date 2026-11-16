/*
 * db.js — local storage layer
 * ---------------------------
 * Everything the lab records lives in IndexedDB in the browser on this
 * device. Nothing is sent anywhere. That makes the app work offline and
 * keeps client data on the lab's own machine, but it also means the
 * browser profile IS the database: use Backup regularly.
 *
 * Stores
 *   settings  one record, key 'lab' — letterhead and defaults
 *   clients   { id, name, address, contact, email }
 *   jobs      { id, jobNo, date, clientId, project, grade, ... }
 *   tests     { id, jobId, testType, header, specimens, result, ... }
 */

'use strict';

const DB = (function () {

  const NAME = 'concrete-lab';
  const VERSION = 1;
  let _db = null;

  /* When the browser refuses IndexedDB — a sandboxed file preview, some
     private windows — the app keeps working on a temporary in-memory copy
     so it can still be looked at, and App shows a warning that nothing
     will be saved. MEM is null whenever real storage is in use. */
  let MEM = null;
  let MEM_REASON = '';
  function useMemory(err) {
    MEM = { settings: {}, clients: {}, jobs: {}, tests: {} };
    MEM_REASON = (err && err.message) || 'The browser blocked local storage.';
  }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

  function open() {
    if (MEM) return Promise.resolve(null);
    if (_db) return Promise.resolve(_db);
    return new Promise(resolve => {
      let req;
      try { req = indexedDB.open(NAME, VERSION); }
      catch (e) { useMemory(e); resolve(null); return; }
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('clients')) {
          const s = db.createObjectStore('clients', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('jobs')) {
          const s = db.createObjectStore('jobs', { keyPath: 'id' });
          s.createIndex('jobNo', 'jobNo', { unique: false });
          s.createIndex('clientId', 'clientId', { unique: false });
          s.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('tests')) {
          const s = db.createObjectStore('tests', { keyPath: 'id' });
          s.createIndex('jobId', 'jobId', { unique: false });
          s.createIndex('testType', 'testType', { unique: false });
          s.createIndex('date', 'date', { unique: false });
        }
      };
      req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
      req.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        useMemory(e.target.error); resolve(null);
      };
    });
  }

  function tx(store, mode) {
    return open().then(db => db.transaction(store, mode).objectStore(store));
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /* ---- generic CRUD -------------------------------------------- */
  function put(store, obj) {
    if (!obj.id) obj.id = uid();
    obj.updatedAt = new Date().toISOString();
    if (!obj.createdAt) obj.createdAt = obj.updatedAt;
    return open().then(() => {
      if (MEM) { MEM[store][obj.id] = clone(obj); return obj; }
      return tx(store, 'readwrite').then(s => wrap(s.put(obj))).then(() => obj);
    });
  }
  function get(store, id) {
    return open().then(() => MEM
      ? clone(MEM[store][id])
      : tx(store, 'readonly').then(s => wrap(s.get(id))));
  }
  function all(store) {
    return open().then(() => MEM
      ? Object.keys(MEM[store]).map(k => clone(MEM[store][k]))
      : tx(store, 'readonly').then(s => wrap(s.getAll())));
  }
  function byIndex(store, index, value) {
    return open().then(() => MEM
      ? Object.keys(MEM[store]).map(k => MEM[store][k])
          .filter(r => r[index] === value).map(clone)
      : tx(store, 'readonly').then(s => wrap(s.index(index).getAll(value))));
  }
  function remove(store, id) {
    return open().then(() => {
      if (MEM) { delete MEM[store][id]; return undefined; }
      return tx(store, 'readwrite').then(s => wrap(s.delete(id)));
    });
  }

  function uid() {
    return Date.now().toString(36) + '-' +
           Math.random().toString(36).slice(2, 8);
  }

  /* ---- settings ------------------------------------------------ */
  const DEFAULT_SETTINGS = {
    id: 'lab',
    labName: 'Concrete Testing Laboratory',
    address: '',
    phone: '',
    email: '',
    nablNumber: '',
    signatory: '',
    designation: 'Laboratory In-charge',
    certPrefix: 'TC',
    certCounter: 1,
    logo: ''
  };

  function getSettings() {
    return get('settings', 'lab').then(s =>
      Object.assign({}, DEFAULT_SETTINGS, s || {}));
  }
  function saveSettings(obj) {
    return put('settings', Object.assign({ id: 'lab' }, obj));
  }

  /* Certificate numbers are issued in sequence and never reused, so a
     cancelled certificate leaves a gap rather than renumbering. */
  function nextCertificateNumber() {
    return getSettings().then(s => {
      const num = s.certCounter || 1;
      const year = new Date().getFullYear();
      const ref = (s.certPrefix || 'TC') + '/' + year + '/' +
                  String(num).padStart(4, '0');
      return saveSettings(Object.assign({}, s, { certCounter: num + 1 }))
        .then(() => ref);
    });
  }

  /* ---- backup and restore -------------------------------------- */
  function exportAll() {
    return Promise.all([
      getSettings(), all('clients'), all('jobs'), all('tests')
    ]).then(([settings, clients, jobs, tests]) => ({
      format: 'concrete-lab-backup',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      settings: settings, clients: clients, jobs: jobs, tests: tests
    }));
  }

  /* Restore is additive by default: existing records with the same id are
     overwritten, records not in the backup are left alone. Pass
     replace=true to clear the stores first. */
  function importAll(data, replace) {
    if (!data || data.format !== 'concrete-lab-backup') {
      return Promise.reject(new Error(
        'This file is not a Concrete Lab backup. Expected a JSON file ' +
        'exported from this app.'));
    }
    const stores = ['clients', 'jobs', 'tests'];
    return open().then(db => {
      if (!MEM) return db;
      if (replace) stores.forEach(n => { MEM[n] = {}; });
      stores.forEach(n => (data[n] || []).forEach(rec => {
        if (rec && rec.id) MEM[n][rec.id] = clone(rec);
      }));
      if (data.settings) MEM.settings.lab = Object.assign({}, clone(data.settings), { id: 'lab' });
      return null;
    }).then(db => db === null ? {
      clients: (data.clients || []).length,
      jobs: (data.jobs || []).length,
      tests: (data.tests || []).length
    } : new Promise((resolve, reject) => {
      const t = db.transaction(stores.concat('settings'), 'readwrite');
      t.onerror = () => reject(t.error);
      t.oncomplete = () => resolve({
        clients: (data.clients || []).length,
        jobs: (data.jobs || []).length,
        tests: (data.tests || []).length
      });
      if (replace) stores.forEach(s => t.objectStore(s).clear());
      stores.forEach(name => {
        (data[name] || []).forEach(rec => {
          if (rec && rec.id) t.objectStore(name).put(rec);
        });
      });
      if (data.settings) {
        t.objectStore('settings').put(
          Object.assign({}, data.settings, { id: 'lab' }));
      }
    }));
  }

  function wipe() {
    return open().then(db => MEM
      ? void (MEM = { settings: {}, clients: {}, jobs: {}, tests: {} })
      : new Promise((resolve, reject) => {
      const stores = ['clients', 'jobs', 'tests', 'settings'];
      const t = db.transaction(stores, 'readwrite');
      t.onerror = () => reject(t.error);
      t.oncomplete = () => resolve();
      stores.forEach(s => t.objectStore(s).clear());
    }));
  }

  return {
    open: open, uid: uid,
    put: put, get: get, all: all, byIndex: byIndex, remove: remove,
    getSettings: getSettings, saveSettings: saveSettings,
    nextCertificateNumber: nextCertificateNumber,
    exportAll: exportAll, importAll: importAll, wipe: wipe,
    isTemporary: function () { return !!MEM; },
    temporaryReason: function () { return MEM_REASON; },
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
})();

if (typeof window !== 'undefined') window.DB = DB;
