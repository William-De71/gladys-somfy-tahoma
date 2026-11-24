// The pure parts: Overkiz states and errors, covers, Gladys values and
// commands, configuration, mDNS results. The bodies and fixtures are the ones
// recorded by pyoverkiz (MIT) and the Developer Mode documentation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { diffConfig, normalizeConfig } from '../src/config.js';
import { buildDevice, commandsFor, deviceValues, namedCommand } from '../src/devices.js';
import { boxIdentityCheck } from '../src/overkiz/clients.js';
import { parseHost, scanBoxes } from '../src/overkiz/discovery.js';
import { ERROR_KINDS, errorOf } from '../src/overkiz/http.js';
import {
  applyStates,
  castState,
  coverOf,
  normalizeDevice,
  opennessOf,
  pinOf,
  platformIdOf,
} from '../src/overkiz/model.js';
import { failuresOf } from '../src/scenes.js';

const setup = JSON.parse(readFileSync(new URL('./fixtures/setup.json', import.meta.url), 'utf8'));
const raw = (url) => setup.devices.find((item) => item.deviceURL === url);
const deviceAt = (url) => normalizeDevice(raw(url));
const gladys = {
  externalIds: (type, id) => ({
    device: `ext:t:${type}:${id}`,
    feature: (key) => `ext:t:${type}:${id}:${key}`,
  }),
};

test('state types: the cloud strings cast like the local values', () => {
  assert.equal(castState({ type: 1, value: '23247220' }), 23247220);
  assert.equal(castState({ type: 1, value: 100 }), 100);
  assert.equal(castState({ type: 2, value: '21.5' }), 21.5);
  assert.equal(castState({ type: 6, value: 'true' }), true);
  assert.equal(castState({ type: 6, value: false }), false);
  assert.deepEqual(castState({ type: 11, value: '{"current_position":0}' }), {
    current_position: 0,
  });
  assert.deepEqual(castState({ type: 10, value: ['a'] }), ['a']);
  assert.equal(castState({ type: 3, value: 'closed' }), 'closed');
  assert.equal(castState({ type: 1, value: null }), null);
  assert.equal(castState({ type: 1, value: 'abc' }), null);
});

test('ids: PIN from the deviceURL, platform id with letters, digits and dashes', () => {
  assert.equal(pinOf('io://1234-5678-9012/12184029#2'), '1234-5678-9012');
  assert.equal(pinOf('internal://1234-5678-9012/pod/0'), '1234-5678-9012');
  assert.equal(pinOf('nope'), null);
  assert.equal(platformIdOf('io://1234-5678-9012/12184029#2'), 'io-1234-5678-9012-12184029-2');
  assert.equal(platformIdOf('rts://1234-5678-9012/16730022'), 'rts-1234-5678-9012-16730022');
});

test('errors: the bodies recorded by pyoverkiz end in the right kind', () => {
  const cases = [
    [401, { errorCode: 'RESOURCE_ACCESS_DENIED', error: 'Not authenticated' }, 'session'],
    [400, { errorCode: 'AUTHENTICATION_ERROR', error: 'Bad credentials' }, 'credentials'],
    [
      400,
      {
        errorCode: 'AUTHENTICATION_ERROR',
        error: 'Too many requests, try again later : login with xxx@xxx.tld',
      },
      'rate',
    ],
    [400, { errorCode: 'UNSPECIFIED_ERROR', error: '"No registered event listener."' }, 'listener'],
    [400, { errorCode: 'UNSPECIFIED_ERROR', error: 'Invalid event listener id : abc' }, 'listener'],
    [
      400,
      {
        errorCode: 'RESOURCE_ACCESS_DENIED',
        error: 'Server busy, please try again later. (Too many executions)',
      },
      'rate',
    ],
    [400, { errorCode: 'UNSPECIFIED_ERROR', error: 'Invalid token : abc-123-def' }, 'credentials'],
    [400, { errorCode: 'NO_SUCH_DEVICE', error: 'No such device : "io://1/2"' }, 'refused'],
    [503, '<html><body>Maintenance</body></html>', 'maintenance'],
    [502, '<html>Bad gateway</html>', 'server'],
  ];
  for (const [status, body, kind] of cases) {
    assert.equal(errorOf(status, body).kind, kind, JSON.stringify(body));
  }
  assert.equal(errorOf(503, '<h1>Down</h1>').message, 'Down');
  assert.equal(ERROR_KINDS.TLS, 'tls');
});

test('covers: commands and states chosen like the Home Assistant integration', () => {
  const living = coverOf(deviceAt('io://1234-5678-9012/12184029'));
  assert.deepEqual(
    { open: living.open, close: living.close, stop: living.stop, my: living.my },
    { open: 'open', close: 'close', stop: 'stop', my: 'my' },
  );
  assert.equal(living.position.command, 'setClosure');
  assert.equal(living.feedback, true);
  const rts = coverOf(deviceAt('rts://1234-5678-9012/16730022'));
  assert.equal(rts.position, null);
  assert.equal(rts.feedback, false);
  assert.equal(coverOf(deviceAt('io://1234-5678-9012/1170079')), null, 'a light');
  // An awning: deploy / undeploy, position = how far out.
  const awning = normalizeDevice({
    deviceURL: 'io://1234-5678-9012/77',
    definition: {
      uiClass: 'Awning',
      commands: ['deploy', 'undeploy', 'stop', 'setDeployment', 'open', 'close'].map((name) => ({
        commandName: name,
      })),
    },
    states: [{ name: 'core:DeploymentState', type: 1, value: 80 }],
  });
  const spec = coverOf(awning);
  assert.equal(spec.open, 'deploy');
  assert.equal(opennessOf(awning, spec.position), 80);
  // A one-button opener.
  const gate = normalizeDevice({
    deviceURL: 'io://1234-5678-9012/78',
    definition: { uiClass: 'Gate', commands: [{ commandName: 'cycle' }] },
  });
  assert.equal(coverOf(gate).toggle, true);
  assert.deepEqual(commandsFor(gate, 'state', 1), [{ name: 'cycle', parameters: [] }]);
});

test('positions: 108 ("My") and 124 (unknown) are not positions', () => {
  const living = deviceAt('io://1234-5678-9012/12184029');
  const cover = coverOf(living);
  for (const [value, expected] of [
    [0, 100],
    [100, 0],
    [108, null],
    [124, null],
  ]) {
    applyStates(living, [{ name: 'core:ClosureState', type: 1, value }]);
    assert.equal(opennessOf(living, cover.position), expected, String(value));
  }
  // Unknown position: the state comes from core:OpenClosedState.
  applyStates(living, [{ name: 'core:OpenClosedState', type: 3, value: 'open' }]);
  assert.deepEqual(
    deviceValues(living).find(([key]) => key === 'state'),
    ['state', 1],
  );
});

test('commands: stop or "My" only while moving, values checked', () => {
  const curtain = deviceAt('rts://1234-5678-9012/16757362');
  const cover = coverOf(curtain);
  if (!cover.stop) {
    assert.deepEqual(commandsFor(curtain, 'state', 0), []);
  }
  const living = deviceAt('io://1234-5678-9012/12184029');
  assert.deepEqual(commandsFor(living, 'tilt', 50), [], 'no slats');
  assert.throws(() => commandsFor(living, 'position', -1), RangeError);
  assert.throws(() => commandsFor(living, 'state', 2), RangeError);
  const lamp = deviceAt('io://1234-5678-9012/1170079');
  assert.deepEqual(commandsFor(lamp, 'brightness', 0), [{ name: 'off', parameters: [] }]);
  assert.deepEqual(commandsFor(lamp, 'light', 1), [{ name: 'on', parameters: [] }]);
  assert.deepEqual(namedCommand(living, 'identify'), [{ name: 'identify', parameters: [] }]);
  assert.equal(namedCommand(deviceAt('rtds://1234-5678-9012/347675'), 'my'), null);
});

test('devices: energy in kWh, sensors read-only, a device without features is left out', () => {
  const meter = normalizeDevice({
    deviceURL: 'io://1234-5678-9012/90#1',
    label: 'Compteur',
    definition: { uiClass: 'ElectricitySensor' },
    states: [
      { name: 'core:ElectricEnergyConsumptionState', type: 1, value: '23247220' },
      { name: 'core:ElectricPowerConsumptionState', type: 2, value: '512.5' },
    ],
  });
  const built = buildDevice(gladys, meter, 'en');
  assert.deepEqual(
    built.features.map((feature) => [feature.category, feature.type, feature.unit]),
    [
      ['energy-sensor', 'power', 'watt'],
      ['energy-sensor', 'index', 'kilowatt-hour'],
    ],
  );
  assert.ok(built.features.every((feature) => feature.read_only));
  assert.deepEqual(Object.fromEntries(deviceValues(meter)), { energy: 23247.22, power: 512.5 });
  assert.equal(buildDevice(gladys, deviceAt('internal://1234-5678-9012/pod/0'), 'en'), null);
});

test('batteries: a gauge first, then the words, a percentage and a low flag', () => {
  const battery = (states, definition = []) =>
    normalizeDevice({
      deviceURL: 'io://1234-5678-9012/91',
      label: 'Pile',
      definition: { uiClass: 'Siren', states: definition },
      states,
    });
  const word = (name, value) => ({ name, type: 3, value });
  const valuesOf = (device) => Object.fromEntries(deviceValues(device));
  const steps = {
    good: [100, 0],
    medium: [50, 0],
    low: [15, 1],
    critical: [5, 1],
  };
  for (const [value, [percent, low]] of Object.entries(steps)) {
    assert.deepEqual(valuesOf(battery([word('core:BatteryDiscreteLevelState', value)])), {
      battery: percent,
      battery_low: low,
    });
  }
  for (const [value, [percent, low]] of Object.entries({
    full: [100, 0],
    normal: [75, 0],
    verylow: [5, 1],
  })) {
    assert.deepEqual(valuesOf(battery([word('core:BatteryState', value)])), {
      battery: percent,
      battery_low: low,
    });
  }
  // The gauge wins over the word for the percentage.
  assert.deepEqual(
    valuesOf(
      battery([
        { name: 'core:BatteryLevelState', type: 2, value: '42.0' },
        word('core:BatteryState', 'normal'),
      ]),
    ),
    { battery: 42, battery_low: 0 },
  );
  // A gauge alone: no low flag, Gladys alerts on its threshold.
  const gauge = battery([{ name: 'core:BatteryLevelState', type: 1, value: 80 }]);
  assert.deepEqual(
    buildDevice(gladys, gauge, 'en').features.map((feature) =>
      feature.external_id.split(':').pop(),
    ),
    ['battery'],
  );
  // Declared without a value (a wired Velux): no battery at all. The local
  // API names the declared states `name`, the cloud `qualifiedName`.
  for (const declared of [
    { name: 'core:BatteryDiscreteLevelState' },
    { qualifiedName: 'core:BatteryDiscreteLevelState' },
  ]) {
    assert.equal(buildDevice(gladys, battery([], [declared]), 'en'), null);
  }
  assert.ok(battery([], [{ name: 'core:TemperatureState' }]).declared.has('core:TemperatureState'));
});

test('failures: per device on the cloud, one device on the local API', () => {
  assert.equal(failuresOf({ name: 'ExecutionStateChangedEvent', newState: 'COMPLETED' }), null);
  assert.deepEqual(
    failuresOf({
      name: 'ExecutionStateChangedEvent',
      newState: 'FAILED',
      failureType: 'CMDCANCELLED',
      failedCommands: [],
    }),
    [{ url: null, failure: 'CMDCANCELLED' }],
  );
  assert.deepEqual(
    failuresOf({
      name: 'CommandExecutionStateChangedEvent',
      newState: 'FAILED',
      deviceURL: 'io://1/2',
      failureType: 'NONEXEC_BLOCKED_BY_HAZARD',
    }),
    [{ url: 'io://1/2', failure: 'NONEXEC_BLOCKED_BY_HAZARD' }],
  );
});

test('TLS identity: a certificate naming another box is refused', () => {
  const check = boxIdentityCheck('1234-5678-9012');
  assert.equal(check('10.0.0.2', { subject: { CN: 'gateway-1234-5678-9012.local' } }), undefined);
  assert.ok(
    check('10.0.0.2', { subject: { CN: 'gateway-9999-8888-7777.local' } }) instanceof Error,
  );
  // A certificate without a PIN: only the chain (Overkiz CA) decides.
  assert.equal(check('10.0.0.2', { subject: { CN: 'kizbox' } }), undefined);
  assert.equal(
    boxIdentityCheck(null)('h', { subject: { CN: 'gateway-9999-8888-7777' } }),
    undefined,
  );
});

test('configuration: typed address, PIN, preference, what changed', () => {
  assert.deepEqual(parseHost('192.168.1.30'), { host: '192.168.1.30', port: 8443 });
  assert.deepEqual(parseHost('https://192.168.1.30:8443/'), { host: '192.168.1.30', port: 8443 });
  assert.deepEqual(parseHost('box.lan:9443'), { host: 'box.lan', port: 9443 });
  assert.equal(parseHost('not an address'), null);
  assert.equal(parseHost(''), null);
  const config = normalizeConfig({
    username: ' me@example.com ',
    password: 'p',
    gateway_pin: '1234-5678-9012',
    GLADYS_PREFER_LOCAL: false,
    region: 'mars',
  });
  assert.equal(config.username, 'me@example.com');
  assert.equal(config.pin, '1234-5678-9012');
  assert.equal(config.preferLocal, false);
  assert.equal(config.region, 'europe');
  assert.equal(normalizeConfig({ gateway_pin: '12-34' }).pin, null);
  assert.deepEqual(diffConfig(config, { ...config, localToken: 'x' }), {
    cloud: false,
    local: true,
    preference: false,
    language: false,
  });
});

test('mDNS: only gateway_pin identifies a box, IPv4 only', async () => {
  const fake = {
    scanNetwork: async (type) => {
      assert.equal(type, 'mdns');
      return [
        {
          name: 'gateway-1234-5678-9012',
          addresses: ['fe80::1', '192.168.1.30'],
          port: 8443,
          txt: ['gateway_pin=1234-5678-9012', 'fw_version=2026.4.4-3'],
        },
        { name: 'gateway-x', addresses: ['192.168.1.31'], port: 8443, txt: ['api_version=1'] },
      ];
    },
  };
  assert.deepEqual(await scanBoxes(fake), {
    boxes: [{ pin: '1234-5678-9012', host: '192.168.1.30', port: 8443, firmware: '2026.4.4-3' }],
    error: null,
  });
  const refused = await scanBoxes({
    scanNetwork: async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 });
    },
  });
  assert.deepEqual(refused, { boxes: [], error: 'forbidden' });
});
