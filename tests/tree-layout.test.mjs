import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('public/pathways/tech-tree.html', root), 'utf8');
const match = html.match(/\/\* TREE_LAYOUT_START \*\/(.*?)\/\* TREE_LAYOUT_END \*\//s);
assert.ok(match, 'tech-tree.html exposes the pure layout helper block');

const sandbox = { module: { exports: {} } };
vm.runInNewContext(match[1], sandbox);
const { buildLayout, themeForAction } = sandbox.module.exports;
const csc = JSON.parse(readFileSync(new URL('public/pathways/csc-ny.json', root), 'utf8'));

test('authored CSC theme map covers every action and labels key semantic themes', () => {
  const themes = new Map(csc.actions.map((action) => [action.id, themeForAction(csc, action).label]));
  assert.equal([...themes.values()].filter((label) => label === 'General').length, 0);
  assert.equal(themes.get(74), 'Transportation & Mobility');
  assert.equal(themes.get(83), 'Nature & Forestry');
  assert.equal(themes.get(91), 'Extreme Heat');
  assert.equal(themes.get(103), 'Flooding & Stormwater');
  assert.equal(themes.get(14), 'Municipal Buildings');
});

test('generic modules honor authored subgroup metadata and use deterministic content fallback', () => {
  const program = { id: 'other-program' };
  assert.equal(themeForAction(program, { subgroup: 'Coastal Resilience', name: 'Any action' }).label, 'Coastal Resilience');
  assert.equal(themeForAction(program, { name: 'Complete streets and transit plan', why: '' }).label, 'Transportation & Mobility');
  assert.equal(themeForAction(program, { name: 'Unclassifiable pilot', why: '' }).label, 'General');
});

test('layout is horizontal, subgrouped, collision-free, and exposes phase bands', () => {
  const layout = buildLayout(csc);
  assert.equal(layout.phases.length, csc.tiers.length);
  assert.ok(layout.phaseWidth >= 600, `expected wide phase columns, got ${layout.phaseWidth}`);
  assert.ok(layout.groups.some((group) => group.category === 'PE7' && group.label === 'Extreme Heat'));
  assert.ok(layout.groups.some((group) => group.category === 'PE7' && group.label === 'Flooding & Stormwater'));

  const positions = new Set();
  for (const action of csc.actions) {
    const pos = layout.positions[action.id];
    assert.ok(pos, `missing position for action ${action.id}`);
    const key = `${pos.x}:${pos.y}`;
    assert.ok(!positions.has(key), `layout collision at ${key}`);
    positions.add(key);
  }

  assert.ok(layout.positions[61].x > layout.positions[31].x, 'same-phase recycling sequence should read left to right');
  assert.ok(layout.positions[123].x > layout.positions[122].x, 'same-phase engagement sequence should read left to right');
  assert.ok(layout.height < csc.actions.length * 128, 'subgroup rows should be denser than one full row per action');
});
