// What users store is forever: device and feature external ids, the feature
// fields the Discover "Update" compares (category, type, unit, min, max), and
// every key of the manifest (configuration, buttons, widgets and settings,
// triggers with their fields, values and variables, actions with their
// fields, values and outputs). They are pinned in
// test/fixtures/discovery.baseline.json.
//
// Never rewrite the baseline to make this test pass: a change here breaks the
// devices, scenes and widgets of the users. A deliberate change needs a
// migration note in the PR, then `UPDATE_BASELINE=1 npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { buildDevice } from '../src/devices.js';
import { normalizeDevice } from '../src/overkiz/model.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const baselineUrl = new URL('./fixtures/discovery.baseline.json', import.meta.url);
const gladys = {
  externalIds: (type, id) => ({
    device: `ext:selector:${type}:${id}`,
    feature: (key) => `ext:selector:${type}:${id}:${key}`,
  }),
};

function snapshot() {
  const setup = read('./fixtures/setup.json');
  const manifest = read('../gladys-assistant-integration.json');
  const devices = setup.devices
    .map((raw) => buildDevice(gladys, normalizeDevice(raw), 'en'))
    .filter(Boolean)
    .map((device) => ({
      external_id: device.external_id,
      params: device.params.map((param) => param.name),
      features: device.features.map(({ external_id: id, category, type, unit, min, max }) => ({
        external_id: id,
        category,
        type,
        unit: unit ?? null,
        min,
        max,
      })),
    }));
  const keysOf = (list) =>
    (list ?? []).map((item) => ({
      key: item.key,
      type: item.type,
      ...(item.options ? { values: item.options.map((option) => option.value) } : {}),
      ...(item.source ? { source: item.source } : {}),
    }));
  return {
    devices,
    config: keysOf(manifest.config_schema),
    actions: manifest.actions.map((action) => action.key),
    widgets: manifest.widgets.map((widget) => ({
      key: widget.key,
      settings: keysOf(widget.settings),
    })),
    scene_triggers: manifest.scene_triggers.map((trigger) => ({
      key: trigger.key,
      fields: keysOf(trigger.fields),
      variables: keysOf(trigger.variables),
    })),
    scene_actions: manifest.scene_actions.map((action) => ({
      key: action.key,
      fields: keysOf(action.fields),
      outputs: keysOf(action.outputs),
    })),
  };
}

test('external ids, feature fields and manifest keys match the baseline', () => {
  const current = snapshot();
  if (process.env.UPDATE_BASELINE === '1') {
    writeFileSync(baselineUrl, `${JSON.stringify(current, null, 2)}\n`);
  }
  assert.deepEqual(current, JSON.parse(readFileSync(baselineUrl, 'utf8')));
});
