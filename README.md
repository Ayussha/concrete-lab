# Concrete Lab

An offline web application for a concrete testing laboratory: record samples,
calculate results to Indian Standards, assess acceptance under IS 456, and
issue test certificates.

It is a static site with no build step, no framework and no server. Open
`index.html` and it runs. Records are stored in the browser's own database on
the device, so the app works with no network at all.

## What it covers

35 test methods across five categories.

| Category | Tests |
|---|---|
| Fresh concrete | Slump, compacting factor, Vee-Bee, flow table, fresh density, air content |
| Hardened concrete | Cube compressive, cylinder compressive, drilled cores, flexural strength, splitting tensile, static modulus of elasticity, hardened density, rebound hammer, ultrasonic pulse velocity |
| Durability | RCPT, RCMT, depth of penetration of water under pressure, water absorption, coefficient of permeability |
| Cement | Fineness by sieving, standard consistency, setting time, soundness, mortar cube strength, specific gravity |
| Aggregates | Sieve analysis (fine and coarse), specific gravity and absorption, impact value, crushing value, Los Angeles abrasion, flakiness and elongation, bulk density and voids, silt content |

Beyond the individual tests it also does the things a lab actually gets asked
for:

- **IS 456 Cl. 16.1 acceptance** across a job: groups 28-day results into
  non-overlapping fours, applies the mean and individual criteria, and says
  whether the concrete complies.
- **Test certificates** with your letterhead, sequential certificate numbers
  that are never reused, and printing to paper or PDF through the browser.
- **A searchable register** of every test with running mean and standard
  deviation, exportable to CSV.
- **Durability checks** against the exposure condition: minimum grade, cement
  content, water–cement ratio and cover from IS 456 Tables 5 and 16.
- **A standards calculator**: target mean strength, acceptance limits, modulus
  of elasticity, flexural strength and sampling frequency for any grade.

## Standards implemented

| Standard | Used for |
|---|---|
| IS 456:2000 | Acceptance criteria (Cl. 16.1, Table 11), sampling frequency (Table 15), workability (Table 7), durability (Table 5), cover (Table 16), Ec and fcr (Cl. 6.2) |
| IS 516 | Compressive, flexural and modulus tests; core testing (Part 4); durability (Part 2/Sec 1) |
| IS 1199 | Fresh concrete sampling and testing |
| IS 5816:1999 | Splitting tensile strength |
| IS 10262:2019 | Target mean strength, assumed standard deviation |
| IS 4031 | Cement physical tests |
| IS 2386 / IS 383:2016 | Aggregate tests and permissible limits |
| IS 13311 | Rebound hammer and ultrasonic pulse velocity |
| IS 3085 | Coefficient of permeability |
| ASTM C1202 | RCPT charge passed and penetrability classification |
| NT Build 492 | RCMT non-steady-state migration coefficient |
| DIN 1048 (Part 5) | Depth of penetration of water under pressure |

Every clause reference is noted inline in `js/standards.js` next to the
calculation that uses it, so any number on a certificate can be traced back to
the clause it came from.

**Standards get revised.** The values transcribed here are listed on the
Standards page in the app. Check them against your own current copies before
issuing certificates. This app is a calculation and record-keeping aid, not a
substitute for the standard.

## Running it

Double-click `index.html`. That is the whole installation.

`index.html` is a single self-contained file: the design and all the code are
inside it, so it works on its own. Copy just that one file to a desktop, a USB
stick or another computer and it still runs.

To serve it over http, which enables the service worker and lets you install it
as an app on a tablet:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

To publish it free on GitHub Pages: push this repository, then in the
repository's **Settings → Pages**, set the source to the `main` branch, root
folder. The app will be served at `https://<username>.github.io/concrete-lab/`.

## Where the data lives

In IndexedDB, in the browser, on the device. Nothing is uploaded anywhere.

The practical consequence: **the browser profile is the database.** Clearing
site data, switching browser, using a private window, or reinstalling the
operating system will lose the records. Export a backup from Settings
regularly and keep it off the device.

Backups are plain JSON and restore additively, so you can also use them to move
records between devices, or to merge results recorded on a lab tablet into the
office machine.

## Project layout

```
index.html              THE APP — one self-contained file, built by build.js
dev.html                development shell that loads css/ and js/ separately
build.js                inlines css/ and js/ into index.html
manifest.webmanifest    installable-app metadata
sw.js                   offline cache for the shell
css/styles.css          screen interface and the printed certificate
js/standards.js         IS reference data and every calculation
js/tests.js             fresh and hardened concrete test definitions
js/tests-materials.js   durability, cement and aggregate test definitions
js/db.js                IndexedDB storage, backup and restore
js/ui.js                DOM helpers and the generic form renderer
js/reports.js           certificates, CSV export, backups
js/app.js               router and views
tests/verify.js         calculation checks against worked examples
tests/smoke.js          runs every test definition's compute()
tests/e2e.js            drives the real app in Chromium
assets/                 icons
```

## Making changes

Edit the files in `css/` and `js/`, and use `dev.html` to try them out, since
it loads the separate files directly. Then rebuild the app file:

```bash
node build.js
```

Never edit `index.html` by hand: every build overwrites it. When the rebuilt
version is published, also bump `CACHE` in `sw.js` so installed copies pick up
the change.

## How to add a test

Tests are declarative. Add one object to `js/tests.js` or
`js/tests-materials.js` and it appears in the picker, gets a form, calculates,
lands in the register and prints on certificates. No UI code to write.

```js
TESTS.push({
  id: 'my-test',                   // stable key — never rename, it is stored
  name: 'My Test',
  code: 'IS 1234 (Part 1)',
  category: 'Hardened Concrete',
  primaryLabel: 'Headline figure',  // which summary row is the key result
  header: [ f('reading', 'Reading (mm)', 'number', { required: true }) ],
  specimens: {                      // optional repeating block
    label: 'Cube', min: 1, max: 6, def: 3,
    fields: [ f('load', 'Failure load (kN)', 'number', { required: true }) ]
  },
  compute(h, sp, ctx) {
    return {
      table: { headers: ['Cube', 'Load (kN)'], rows: sp.map((s, i) => [i + 1, s.load]) },
      summary: [{ label: 'Headline figure', value: 42, unit: 'N/mm²' }],
      verdict: { status: 'PASS', text: 'Why it passed.' },
      notes: ['Anything the certificate should caveat.']
    };
  }
});
```

Field types are `number`, `text`, `date`, `select` (with `options`),
`textarea`, and `list` (a variable number of readings). For a fixed set of
rows, such as a sieve stack, use `fieldTables` — see `sieve-analysis-fine`.

`ctx` carries the job's grade, standard deviation, exposure condition and
whether it is a wearing surface, so a test can apply the right limit.

Results are always recalculated from the stored inputs, never read back from
storage. Correct a formula in `js/standards.js` and every existing record
reflects the correction.

## Tests

```bash
node tests/verify.js   # calculations against worked examples
node tests/smoke.js    # every test definition computes without throwing
node tests/e2e.js      # full workflow in a real browser (needs playwright)
```

`verify.js` and `smoke.js` need nothing but Node. `e2e.js` needs Playwright
with Chromium; install it with `npm install playwright && npx playwright
install chromium`.

Run `SHOTS=1 node tests/e2e.js` to also write screenshots to `/tmp`.

`e2e.js` also opens `index.html` straight from disk, both in the project
folder and copied alone into an empty folder, to prove a double-click works.
Run `node build.js` first so it tests your latest changes.

If you change `standards.js`, run `verify.js` before committing. It is the file
where a mistake turns into a wrong certificate.

## Licence

MIT — see `LICENSE`.
