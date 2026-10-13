import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('public/pathways/tech-tree.html', root), 'utf8');
const match = html.match(/\/\* GHG_MODEL_START \*\/(.*?)\/\* GHG_MODEL_END \*\//s);
assert.ok(match, 'tech-tree.html exposes the pure GHG model helper block');

const sandbox = { module: { exports: {} } };
vm.runInNewContext(match[1], sandbox);
const {
  aggregateImpacts,
  actionImpact,
  buildTrajectory,
  modeledImpact,
  normalizeScenario,
  parseMaxPoints,
} = sandbox.module.exports;

test('maximum points parser handles numeric, range, and tiered CSC displays', () => {
  assert.equal(parseMaxPoints(4), 4);
  assert.equal(parseMaxPoints('8-16'), 16);
  assert.equal(parseMaxPoints('5 / 10 / 15'), 15);
  assert.equal(parseMaxPoints('tiers: 3, 9, or 21 points'), 21);
  assert.equal(parseMaxPoints('not scored'), 0);
});

test('modeled impact prorates by credited points and clamps the ratio', () => {
  assert.equal(modeledImpact(1000, 0, 20), 0);
  assert.equal(modeledImpact(1000, 5, 20), 250);
  assert.equal(modeledImpact(1000, 20, 20), 1000);
  assert.equal(modeledImpact(1000, 30, 20), 1000);
  assert.equal(modeledImpact(1000, -2, 20), 0);
  assert.equal(modeledImpact(1000, 5, 0), 0);
});

test('action impact uses explicit per-action assumptions rather than a point conversion factor', () => {
  const action = {
    id: 23,
    points: '2-22',
    impact: { kind: 'direct', max_annual_mtco2e: 500, overlap_group: 'municipal-fleet' },
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(actionImpact(action, { creditedPoints: 11 }))),
    {
      kind: 'direct',
      maxPoints: 22,
      creditedPoints: 11,
      maxAnnual: 500,
      modeledAnnual: 250,
      overlapGroup: 'municipal-fleet',
    },
  );
  assert.equal(actionImpact({ points: 20, impact: { kind: 'enabling' } }, { creditedPoints: 20 }).modeledAnnual, 0);
  assert.equal(actionImpact({ points: 20, impact: { kind: 'adaptation' } }, { creditedPoints: 20 }).modeledAnnual, 0);
});

test('portfolio aggregation takes the largest estimate in an overlap group', () => {
  const actions = [
    { id: 1, points: 10, impact: { kind: 'direct', max_annual_mtco2e: 100, overlap_group: 'buildings' } },
    { id: 2, points: 10, impact: { kind: 'direct', max_annual_mtco2e: 70, overlap_group: 'buildings' } },
    { id: 3, points: 10, impact: { kind: 'direct', max_annual_mtco2e: 40 } },
    { id: 4, points: 10, impact: { kind: 'enabling' } },
  ];
  const result = aggregateImpacts(actions, {
    1: { creditedPoints: 10 },
    2: { creditedPoints: 10 },
    3: { creditedPoints: 5 },
    4: { creditedPoints: 10 },
  });
  assert.equal(result.totalAnnual, 120);
  assert.equal(result.unadjustedAnnual, 190);
  assert.equal(result.overlapAvoided, 70);
  assert.equal(result.quantifiedActions, 3);
});

test('scenario normalization preserves the reported Sleepy Hollow baseline and bounds editable inputs', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(normalizeScenario({
      baselineAnnual: 74615,
      baselineYear: 2019,
      bauGrowthPct: 1.5,
      targetYear: 2030,
      targetReductionPct: 50,
    }))),
    {
      baselineAnnual: 74615,
      baselineYear: 2019,
      bauGrowthPct: 1.5,
      targetYear: 2030,
      targetReductionPct: 50,
    },
  );
  const bounded = normalizeScenario({ baselineAnnual: -1, baselineYear: 2200, bauGrowthPct: -200, targetYear: 1900, targetReductionPct: 140 });
  assert.equal(bounded.baselineAnnual, 0);
  assert.equal(bounded.baselineYear, 2100);
  assert.equal(bounded.bauGrowthPct, -100);
  assert.equal(bounded.targetYear, 2100);
  assert.equal(bounded.targetReductionPct, 100);
});

test('trajectory starts savings in the completion year, ignores undated actions, and avoids overlap each year', () => {
  const actions = [
    { id: 1, points: 10, impact: { kind: 'direct', max_annual_mtco2e: 100, overlap_group: 'buildings' } },
    { id: 2, points: 10, impact: { kind: 'direct', max_annual_mtco2e: 70, overlap_group: 'buildings' } },
    { id: 3, points: 10, impact: { kind: 'direct', max_annual_mtco2e: 40 } },
    { id: 4, points: 10, impact: { kind: 'direct', max_annual_mtco2e: 999 } },
  ];
  const points = buildTrajectory(actions, {
    1: { creditedPoints: 10 },
    2: { creditedPoints: 10 },
    3: { creditedPoints: 5 },
    4: { creditedPoints: 10 },
  }, { 1: 2021, 2: 2020, 3: 2021 }, {
    baselineAnnual: 1000,
    baselineYear: 2020,
    bauGrowthPct: 0,
    targetYear: 2022,
    targetReductionPct: 50,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(points)), [
    { year: 2020, bau: 1000, adjusted: 930, target: 1000, annualSavings: 70 },
    { year: 2021, bau: 1000, adjusted: 880, target: 750, annualSavings: 120 },
    { year: 2022, bau: 1000, adjusted: 880, target: 500, annualSavings: 120 },
  ]);
});

test('trajectory handles partial points, BAU growth, pre-baseline completions, and caps emissions at zero', () => {
  const actions = [
    { id: 1, points: 20, impact: { kind: 'direct', max_annual_mtco2e: 2000 } },
    { id: 2, points: 10, impact: { kind: 'direct', max_annual_mtco2e: 100 } },
  ];
  const points = buildTrajectory(actions, {
    1: { creditedPoints: 5 },
    2: { creditedPoints: 10 },
  }, { 1: 2018 }, {
    baselineAnnual: 400,
    baselineYear: 2019,
    bauGrowthPct: 10,
    targetYear: 2020,
    targetReductionPct: 25,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(points)), [
    { year: 2019, bau: 400, adjusted: 0, target: 400, annualSavings: 500 },
    { year: 2020, bau: 440, adjusted: 0, target: 300, annualSavings: 500 },
  ]);
  assert.equal(points[0].annualSavings, 500, 'undated action 2 is excluded');
});

test('left metric and dossier disclose the concept-only methodology', () => {
  assert.match(html, /id="m-ghg"/);
  assert.match(html, /Illustrative annual impact/);
  assert.match(html, /id="impact-points"/);
  assert.match(html, /id="impact-max"/);
  assert.match(html, /not an emissions inventory/i);
  assert.match(html, /DEC-approved accounting method/i);
  assert.match(html, /No universal point-to-ton/i);
});
