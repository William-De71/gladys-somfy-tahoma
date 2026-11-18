// The manifest and the code agree: every declared action, widget, trigger and
// configuration key has its code, every version says the same thing, and the
// manifest respects what the store and the Gladys core expect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ACTIONS } from '../src/app.js';
import { DEFAULTS, LANGUAGES, normalizeConfig, REGION_KEYS } from '../src/config.js';
import { MDNS_SERVICE } from '../src/overkiz/discovery.js';
import {
  AVAILABILITY_STATES,
  BOX_STATES,
  SCENE_ACTION_OUTPUTS,
  SCENE_ACTIONS,
  SCENE_TRIGGER_DATA,
  SCENE_TRIGGERS,
  SEND_COMMAND_VALUES,
} from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const byKey = (list) => Object.fromEntries(list.map((item) => [item.key, item]));
const values = (field) => field.options.map((option) => option.value);

test('one version everywhere, image of this repository', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-somfy-tahoma:${pkg.version}`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/William-De71\/gladys-somfy-tahoma\/main\/cover\.jpg$/,
  );
  assert.ok(Buffer.byteLength(read('gladys-assistant-integration.json')) < 100 * 1024);
});

test('store rules: type, Gladys version, transports, discovery, permissions', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Somfy TaHoma');
  // keywords and the "Prefer the local connection" toggle: 5.3.0.
  assert.equal(manifest.gladys_version, '>=5.3.0');
  // Both channels: local API (Developer Mode) and Somfy cloud.
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.deepEqual(manifest.categories, ['lighting', 'protocols']);
  // The mDNS service of the Developer Mode, a name the store accepts.
  assert.match(MDNS_SERVICE, /^_[a-z0-9-]+\._(tcp|udp)$/);
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: MDNS_SERVICE }]);
  for (const key of ['location', 'containers', 'webhooks', 'network_wake', 'countries']) {
    assert.equal(manifest[key], undefined, key);
  }
});

test('configuration: keys, defaults and choices of the code, secrets typed as such', () => {
  const fields = byKey(manifest.config_schema);
  assert.deepEqual(values(fields.language), LANGUAGES);
  assert.deepEqual(values(fields.region), REGION_KEYS);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.local_token.type, 'secret');
  // `text` / `password` are refused by the store.
  for (const field of manifest.config_schema) {
    assert.ok(['string', 'secret', 'select', 'section'].includes(field.type), field.key);
    assert.notEqual(field.required, true, `${field.key}: cloud, local or both`);
  }
  // Reserved: Gladys renders the toggle itself.
  assert.equal(fields.GLADYS_PREFER_LOCAL, undefined);
  // The defaults of the manifest give the defaults of the code.
  const config = normalizeConfig({});
  assert.equal(config.preferLocal, true);
  assert.equal(config.region, 'europe');
  assert.equal(config.cloudConfigured, false);
});

test('configuration buttons: the keys of the code', () => {
  assert.deepEqual(
    manifest.actions.map((action) => action.key).sort(),
    Object.values(ACTIONS).sort(),
  );
});

test('scene triggers: keys, filters and variables of the code', () => {
  const triggers = byKey(manifest.scene_triggers);
  assert.deepEqual(Object.keys(triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
  for (const trigger of manifest.scene_triggers) {
    const declared = [
      ...(trigger.fields ?? []).map((field) => field.key),
      ...(trigger.variables ?? []).map((variable) => variable.key),
    ];
    assert.deepEqual(declared.sort(), [...SCENE_TRIGGER_DATA[trigger.key]].sort(), trigger.key);
    const device = byKey(trigger.fields ?? []).device;
    if (device) {
      assert.equal(device.source, 'devices');
      assert.notEqual(device.required, true, 'empty: any device');
    }
  }
  const availability = byKey(triggers.device_availability_changed.fields);
  assert.deepEqual(values(availability.state).sort(), [...AVAILABILITY_STATES].sort());
  const box = byKey(triggers.box_connection_changed.fields);
  assert.deepEqual(values(box.state).sort(), [...BOX_STATES].sort());
});

test('scene actions: keys, fields, options and outputs of the code', () => {
  const actions = byKey(manifest.scene_actions);
  assert.deepEqual(Object.keys(actions).sort(), Object.values(SCENE_ACTIONS).sort());
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
    assert.deepEqual(
      (action.outputs ?? []).map((output) => output.key),
      SCENE_ACTION_OUTPUTS[action.key],
      action.key,
    );
  }
  const send = byKey(actions.send_command.fields);
  assert.equal(send.device.source, 'devices');
  assert.equal(send.device.required, true);
  assert.deepEqual(values(send.command), SEND_COMMAND_VALUES);
  assert.equal(byKey(actions.run_scenario.fields).scenario.type, 'string');
});

test('widgets: the keys of the code, settings without secrets', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  assert.equal(byKey(byKey(manifest.widgets).cover.settings).device.source, 'devices');
  for (const item of manifest.widgets) {
    for (const setting of item.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
});

test('catalog fields of Gladys 5.3: search keywords', () => {
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10, '1 to 10 keywords');
  for (const keyword of manifest.keywords) {
    assert.ok(keyword.trim().length >= 2 && keyword.trim().length <= 30, keyword);
  }
  const normalized = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'keywords are unique');
  assert.ok(!normalized.includes(manifest.name.toLowerCase()), 'the name is already searched');
});
