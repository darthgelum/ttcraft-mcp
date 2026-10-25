import test from 'node:test';
import assert from 'node:assert/strict';
import { TableState } from '../dist/state.js';
import { validateBlueprint } from '../dist/blueprint.js';
import { commandMap } from '../dist/reference.js';
import { safeUrl } from '../dist/config.js';
import { stateFrame } from './fixture.mjs';
import { schema } from '../reference/schema.mjs';

const hello = (generation = 1, revision = 1) => ({ type: 'hello', protocol: 13, worldGeneration: generation, visibilityRevision: revision, game: { objects: {} } });
test('atomic v13 baselines, metadata preservation, personal membership and epoch replacement', () => {
  const state = new TableState(); state.json(hello());
  state.json({ type: 'props', objects: [{ id: 1, props: { guid: 'stable', label: 'Chip' } }] });
  state.binary(stateFrame([{ id: 1, position: [0.1, 0.02, -0.2] }]));
  assert.equal(state.baselineSeen, false);
  state.binary(stateFrame([{ id: 2 }], { tag: 11 }));
  assert.equal(state.baselineSeen, true);
  assert.deepEqual(state.resolve('stable').position, [0.1, 0.02, -0.2]);
  state.binary(stateFrame([{ id: 1, position: [0.2, 0.02, -0.2] }], { tag: 2 }));
  assert.equal(state.resolve('stable').position[0], 0.2);
  state.binary(stateFrame([], { tag: 1 }));
  assert.equal(state.objects.has(1), false); assert.equal(state.objects.has(2), true);
  state.json({ type: 'worldEpoch', worldGeneration: 2, visibilityRevision: 1 });
  state.binary(stateFrame([{ id: 9 }], { tag: 2, generation: 1 }));
  assert.equal(state.objects.size, 0);
  state.binary(stateFrame([{ id: 3 }], { generation: 2 }));
  state.binary(stateFrame([], { tag: 11, generation: 2 }));
  assert.equal(state.objects.has(2), false); assert.equal(state.objects.has(3), true);
});
test('reject unknown protocol and malformed binary without partial state updates', () => {
  const state = new TableState();
  assert.throws(() => state.json({ ...hello(), protocol: 99 }), /Unsupported/);
  state.json(hello());
  assert.throws(() => state.binary(Buffer.from([1, 255, 255])), /Truncated/);
  assert.equal(state.objects.size, 0);
});
test('full props replacement removes stale mixins and permits clearing a display label', () => {
  const state = new TableState(); state.json(hello());
  state.json({ type: 'props', objects: [{ id: 1, props: { guid: 'x', label: 'Named', vfx: [{ ref: 'fire' }] } }] });
  state.json({ type: 'props', objects: [{ id: 1, props: { guid: 'x', label: '' } }] });
  assert.equal(state.resolve('x').name, ''); assert.equal('vfx' in state.resolve('x').props, false);
});
test('blueprint validation rejects duplicate keys, missing references and reserved fields before mutation', () => {
  const obj = { key: 'x', spec: { kind: 'chip' }, position: [0, 0.1, 0] };
  assert.throws(() => validateBlueprint({ id: 'demo', objects: [obj, obj] }), /unique/);
  assert.throws(() => validateBlueprint({ id: 'demo', objects: [{ ...obj, template: '$missing' }] }), /Unknown/);
  assert.throws(() => validateBlueprint({ id: 'demo', objects: [{ ...obj, spec: { kind: 'chip', type: 'resettable' } }] }), /reserved/);
  assert.throws(() => validateBlueprint({ id: '../oops' }));
});
test('catalog exposes build/gameplay domains but excludes chat and transport internals', () => {
  for (const cmd of ['spawn', 'setscript', 'tableplan', 'deal', 'containerset', 'settabletdoc', 'lighting', 'music', 'timemachine']) assert.ok(commandMap.has(cmd), cmd);
  for (const cmd of ['chat', 'chatdm', 'identify', 'webrtc_offer', 'echo']) assert.equal(commandMap.has(cmd), false, cmd);
});
test('credentials only travel over HTTPS or loopback transports', () => {
  assert.equal(safeUrl('http://127.0.0.1:1234').protocol, 'http:');
  assert.equal(safeUrl('wss://42.tables.ttcraft.net/ws', true).protocol, 'wss:');
  assert.throws(() => safeUrl('http://example.org'));
  assert.throws(() => safeUrl('https://user:pass@example.org'));
  assert.throws(() => safeUrl('file:///tmp/token'));
});
test('binary decoder contract matches the bundled source-of-truth schema', () => {
  assert.equal(schema.protocolVersion, 13);
  assert.equal(schema.record.size, 35);
  assert.deepEqual(schema.record.off, { id: 0, kind: 4, flags: 5, pos: 6, quat: 12, extra: 20, holder: 21, extra2: 22, vel: 23, avel: 29 });
  assert.equal(schema.scale.recPos, 10000); assert.equal(schema.scale.quat, 32767);
  assert.deepEqual(schema.kinds, ['die', 'chip', 'coin', 'deck', 'card', 'prop', 'tablet', 'counter', 'clock', 'note']);
});
