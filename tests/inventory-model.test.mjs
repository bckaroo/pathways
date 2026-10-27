import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('public/pathways/tech-tree.html', root), 'utf8');
const match = html.match(/\/\* INVENTORY_MODEL_START \*\/(.*?)\/\* INVENTORY_MODEL_END \*\//s);
assert.ok(match, 'tech-tree.html exposes the pure inventory model helper block');

const sandbox = { module: { exports: {} } };
vm.runInNewContext(match[1], sandbox);
const INV = sandbox.module.exports;

// cross-realm safe comparison (vm values are not reference-equal to host literals)
const eq = (actual, expected, msg) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), msg);

// Sleepy Hollow demo figures (mirror of the in-app INVENTORY_DEMO)
const DATA = {
  ledgers: [
    { id: 'community', name: 'Community-wide', units: 'MtCO2e', scope: 'community', baseline_year: 2019,
      records: [
        { year: 2019, total: 74615 },
        { year: 2023, total: 87000, sector_shares: { Transportation: 49, 'Buildings & energy use': 48, Other: 3 } },
      ],
      trend_assumption: { growth_pct_yr: 2.0 } },
    { id: 'govops', name: 'Government operations', units: 'MtCO2e', scope: 'govops', baseline_year: 2018,
      records: [
        { year: 2018, total: 1078,
          sectors: { 'Vehicle Fleet': 428, 'Buildings & Facilities': 344, 'Public Lighting': 179, 'Water & Wastewater Distribution': 127 } },
      ] },
  ],
  targets: [
    { id: 'clcpa', ledger: 'community', stops: [{ pct: 40, year: 2030 }, { pct: 85, year: 2050 }] },
  ],
};

test('records are sorted and baseline resolves by baseline_year', () => {
  eq(INV.sortedRecords(INV.ledgerById(DATA, 'community')).map(r => r.year), [2019, 2023]);
  assert.equal(INV.baselineRecord(INV.ledgerById(DATA, 'community')).year, 2019);
  assert.equal(INV.latestRecord(INV.ledgerById(DATA, 'community')).year, 2023);
  assert.equal(INV.baselineRecord(INV.ledgerById(DATA, 'govops')).total, 1078);
});

test('absolute sector values are ranked and percentage shares are derived from totals', () => {
  const gov = INV.sectorRows(INV.ledgerById(DATA, 'govops'), INV.latestRecord(INV.ledgerById(DATA, 'govops')));
  eq(gov.map(s => s.name), ['Vehicle Fleet', 'Buildings & Facilities', 'Public Lighting', 'Water & Wastewater Distribution']);
  assert.equal(gov[0].value, 428);
  assert.equal(gov[0].pct, 39.7);
  assert.equal(gov[3].value, 127);
  const com = INV.sectorRows(INV.ledgerById(DATA, 'community'), INV.latestRecord(INV.ledgerById(DATA, 'community')));
  eq(com.map(s => s.pct), [49, 48, 3]);
  assert.equal(com[0].value, 42630); // 87000 × 49%
});

test('sector rows are empty (not invented) when no split exists', () => {
  const rows = INV.sectorRows(INV.ledgerById(DATA, 'community'), INV.baselineRecord(INV.ledgerById(DATA, 'community')));
  eq(rows, []);
});

test('targets attach to exactly one ledger', () => {
  assert.equal(INV.targetsFor(DATA, 'community').length, 1);
  eq(INV.targetsFor(DATA, 'govops'), []);
});

test('trend is compound growth from the baseline year', () => {
  assert.equal(INV.trendValue(74615, 2019, 2019, 2), 74615);
  assert.equal(INV.trendValue(74615, 2019, 2020, 2), 76107.3);   // ×1.02
  assert.equal(INV.trendValue(74615, 2019, 2023, 2), 80765.7);   // ×1.02^4
  assert.equal(INV.trendValue(74615, 2019, 2030, 2), 92774.4);   // ×1.02^11
});

test('target path is piecewise linear between declared target years and holds flat after the last', () => {
  const stops = [{ pct: 40, year: 2030 }, { pct: 85, year: 2050 }];
  assert.equal(INV.targetValueAt(74615, 2019, stops, 2019), 74615);     // baseline year = baseline total
  assert.equal(INV.targetValueAt(74615, 2019, stops, 2030), 44769);     // −40%
  assert.equal(INV.targetValueAt(74615, 2019, stops, 2040), 27980.6);   // midway to −85%
  assert.equal(INV.targetValueAt(74615, 2019, stops, 2050), 11192.3);   // −85%
  assert.equal(INV.targetValueAt(74615, 2019, stops, 2060), 11192.3);   // held flat
  assert.equal(INV.targetValueAt(74615, 2019, stops, 1900), 74615);     // before baseline
});

test('target path never goes below zero', () => {
  assert.equal(INV.targetValueAt(1000, 2020, [{ pct: 150, year: 2050 }], 2050), 0);
});

test('projection spans inventory, target, and requested end years with nulls off inventory years', () => {
  const p = INV.buildProjection(DATA, 'community', { endYear: 2032 });
  assert.equal(p.baselineYear, 2019);
  assert.equal(p.baselineTotal, 74615);
  assert.equal(p.points[0].year, 2019);
  assert.equal(p.points[p.points.length - 1].year, 2032);
  const byYear = Object.fromEntries(p.points.map(x => [x.year, x]));
  assert.equal(byYear[2019].measured, 74615);
  assert.equal(byYear[2020].measured, null);
  assert.equal(byYear[2023].measured, 87000);
  assert.equal(byYear[2030].target, 44769);
  assert.equal(byYear[2030].trend, 92774.4);
  // float-artifact guard: every emitted value is a clean 1-decimal number
  p.points.forEach(x => {
    [x.measured, x.trend, x.target].forEach(v => {
      if (v != null) assert.equal(v, Math.round(v * 10) / 10);
    });
  });
});

test('projection end year defaults to the last target year, else baseline + 5', () => {
  const c = INV.buildProjection(DATA, 'community');
  assert.equal(c.points[c.points.length - 1].year, 2050);   // last target year
  const g = INV.buildProjection(DATA, 'govops');
  assert.equal(g.points[g.points.length - 1].year, 2023);   // 2018 + 5, no targets
});

test('gap-to-target is reported only for measured years', () => {
  const p = INV.buildProjection(DATA, 'community', { endYear: 2032, growthPctYr: 2 });
  assert.equal(INV.gapPctAt(p, 2020), null);      // no measurement that year
  assert.equal(INV.gapPctAt(p, 2019), 0);         // baseline year sits ON the path by definition
  const gap2023 = INV.gapPctAt(p, 2023);
  assert.ok(gap2023 > 30 && gap2023 < 40, 'gap 2023 in the 30s (measured 87000 vs path ~63762), got ' + gap2023);
});

test('targetMetYear is set only when the last measured year still sits on or below the path', () => {
  const ahead = JSON.parse(JSON.stringify(DATA));
  ahead.ledgers[0].records.push({ year: 2055, total: 10000 });   // below the −85% line
  const p = INV.buildProjection(ahead, 'community');
  assert.equal(p.targetMetYear, 2055);
  const notYet = INV.buildProjection(DATA, 'community', { endYear: 2050 });
  assert.equal(notYet.targetMetYear, null);                       // 2023 is still above the path
});

test('summary keeps ledgers separate — gov ops is never added to community', () => {
  const com = INV.summarize(INV.ledgerById(DATA, 'community'));
  const gov = INV.summarize(INV.ledgerById(DATA, 'govops'));
  assert.equal(com.baselineTotal, 74615);   // not 74615 + 1078
  assert.equal(gov.baselineTotal, 1078);
  assert.equal(com.latestTotal, 87000);
  assert.equal(com.changePct, 16.6);
  assert.equal(gov.changePct, 0);
});
