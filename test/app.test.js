// The whole integration against the fake Gladys of the SDK and the fake
// Somfy cloud and TaHoma box (test/helpers/fake-overkiz.js): discovery,
// channels and fallback, pushed states, commands, scene triggers and
// actions, widgets, configuration buttons. Nothing leaves 127.0.0.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { SCENE_TRIGGER_DATA } from '../src/scenes.js';
import { memoryStorage } from '../src/storage.js';
import {
  BOTH_CONFIG,
  CLOUD_CONFIG,
  device,
  deviceOf,
  DOOR,
  featureOf,
  KITCHEN,
  LAMP,
  lastTransport,
  LIVING,
  LOCAL_CONFIG,
  LOCAL_TOKEN,
  ok,
  PIN,
  PLUG,
  SCREEN,
  setup,
  setValue,
  settle,
  THERMO,
  until,
} from './helpers.js';
import { startFakeOverkiz } from './helpers/fake-overkiz.js';

const outputs = (ack) => ok(ack).outputs;
const message = (ack) => ok(ack).message;
const widget = (ack) => ok(ack).content;
const keys = (item) => item.features.map((feature) => feature.external_id.split(':').pop());
const executions = (server, kind) =>
  server.installation.executions.filter((item) => !kind || item.kind === kind);
const stateEvent = (url, states) => ({
  name: 'DeviceStateChangedEvent',
  deviceURL: url,
  deviceStates: states,
});

test('discovery: every device Gladys can show, ids from the deviceURL, never polled', async () => {
  const { fake, stop } = await setup({ create: false });
  try {
    const names = fake.discoveredDevices.map((item) => item.name).sort();
    assert.equal(names.length, 14);
    // The box itself, its radio stacks and the pod are never offered.
    for (const hidden of ['TaHoma', 'IO', 'Zigbee']) {
      assert.ok(!names.includes(hidden), hidden);
    }
    const living = deviceOf(fake, device(LIVING));
    assert.equal(living.external_id, 'ext:test-integration:device:io-1234-5678-9012-12184029');
    assert.equal(living.name, 'Volet séjour');
    assert.equal(living.should_poll, false);
    assert.equal(living.poll_frequency, undefined);
    assert.deepEqual(keys(living), ['state', 'position']);
    assert.equal(featureOf(living, 'state').name, 'Ouvrir / fermer');
    assert.deepEqual(living.params, [
      { name: 'TAHOMA_DEVICE_URL', value: LIVING },
      { name: 'TAHOMA_PIN', value: PIN },
    ]);
    // An RTS motor: one-way, no position, no feedback.
    const kitchen = deviceOf(fake, device(KITCHEN));
    assert.deepEqual(keys(kitchen), ['state']);
    assert.equal(featureOf(kitchen, 'state').has_feedback, false);
    assert.deepEqual(keys(deviceOf(fake, device(LAMP))), ['light', 'brightness']);
    assert.deepEqual(keys(deviceOf(fake, device(PLUG))), ['switch']);
    assert.deepEqual(keys(deviceOf(fake, device(DOOR))), ['contact']);
    assert.deepEqual(keys(deviceOf(fake, device(THERMO))), ['temperature']);
    // Every feature carries what the core requires to create it.
    for (const item of fake.discoveredDevices) {
      for (const feature of item.features) {
        for (const field of ['min', 'max', 'read_only', 'has_feedback', 'name']) {
          assert.notEqual(feature[field], undefined, `${item.name} ${field}`);
        }
      }
    }
    // Nothing created yet: no state reaches Gladys.
    assert.equal(fake.lastState(`${device(LIVING)}:position`), undefined);
  } finally {
    await stop();
  }
});

test('local first: mDNS finds the box, states and badges once created', async () => {
  const { fake, app, server, stop } = await setup();
  try {
    await settle(app);
    assert.equal(fake.connectionStatus.connected, true);
    assert.match(fake.connectionStatus.message.fr, /réseau local, 14 appareil/);
    assert.equal(fake.lastState(`${device(LIVING)}:position`), 0);
    assert.equal(fake.lastState(`${device(LIVING)}:state`), -1);
    assert.equal(fake.lastState(`${device(LAMP)}:brightness`), 56);
    assert.equal(fake.lastState(`${device(THERMO)}:temperature`), 24.1);
    assert.equal(fake.lastState(`${device(DOOR)}:contact`), 1);
    assert.deepEqual(lastTransport(fake, device(LIVING)), {
      device_external_id: device(LIVING),
      transport: 'local',
    });
    // Everything went to the box; the cloud only for the scenarios.
    const cloudCalls = server.installation.calls.filter((call) => call.kind === 'cloud');
    assert.deepEqual(
      cloudCalls.map((call) => call.path),
      ['actionGroups'],
    );
  } finally {
    await stop();
  }
});

test('events: positions as Gladys counts them, cloud strings cast, availability', async () => {
  const { fake, app, server, stop } = await setup();
  try {
    // A cloud-style value: a string with its type.
    server.push(stateEvent(LIVING, [{ name: 'core:ClosureState', type: 1, value: '30' }]));
    await until(() => fake.lastState(`${device(LIVING)}:position`) === 70);
    await settle(app);
    assert.equal(fake.lastState(`${device(LIVING)}:state`), 0);
    // An event of another box of the account is ignored.
    server.push(
      stateEvent('io://9999-8888-7777/12184029', [
        { name: 'core:ClosureState', type: 1, value: 0 },
      ]),
    );
    server.push(stateEvent(LIVING, [{ name: 'core:StatusState', type: 3, value: 'unavailable' }]));
    await until(() =>
      fake.sceneEvents.some((event) => event.key === 'device_availability_changed'),
    );
    const event = fake.sceneEvents.find((item) => item.key === 'device_availability_changed');
    assert.deepEqual(event.data, {
      device: device(LIVING),
      device_name: 'Volet séjour',
      state: 'unavailable',
    });
    assert.deepEqual(Object.keys(event.data).sort(), [...SCENE_TRIGGER_DATA[event.key]].sort());
    server.push({ name: 'DeviceAvailableEvent', deviceURL: LIVING });
    await until(
      () =>
        fake.sceneEvents.filter((item) => item.key === 'device_availability_changed').length === 2,
    );
  } finally {
    await stop();
  }
});

test('commands: one execution on the box, positions inverted for the motor', async () => {
  const { fake, server, stop } = await setup();
  try {
    ok(await setValue(fake, device(LIVING), 'position', 25));
    ok(await setValue(fake, device(LAMP), 'brightness', 40));
    ok(await setValue(fake, device(PLUG), 'switch', 1));
    ok(await setValue(fake, device(KITCHEN), 'state', -1));
    ok(await setValue(fake, device(LIVING), 'state', 0));
    const sent = executions(server, 'local').map((item) => [
      item.label,
      item.actions[0].deviceURL,
      item.actions[0].commands,
    ]);
    assert.deepEqual(sent, [
      ['Gladys Assistant', LIVING, [{ name: 'setClosure', parameters: [75] }]],
      ['Gladys Assistant', LAMP, [{ name: 'setIntensity', parameters: [40] }]],
      ['Gladys Assistant', PLUG, [{ name: 'on', parameters: [] }]],
      ['Gladys Assistant', KITCHEN, [{ name: 'close', parameters: [] }]],
      ['Gladys Assistant', LIVING, [{ name: 'stop', parameters: [] }]],
    ]);
    const refused = await setValue(fake, device(LIVING), 'position', 140);
    assert.equal(refused.success, false);
    assert.match(refused.error, /hors limites/);
  } finally {
    await stop();
  }
});

test('cloud only: no token, the Somfy cloud, scenarios run by their id', async () => {
  const { fake, app, server, stop } = await setup({ config: CLOUD_CONFIG, mdns: false });
  try {
    await settle(app);
    assert.match(fake.connectionStatus.message.en, /through the Somfy cloud, 14 device/);
    assert.equal(lastTransport(fake, device(LIVING)).transport, 'cloud');
    assert.equal(lastTransport(fake, device(LIVING)).degraded, undefined);
    const output = outputs(await fake.sceneAction('run_scenario', { scenario: 'je pars' }));
    assert.deepEqual(Object.keys(output), ['exec_id', 'scenario', 'transport']);
    assert.equal(output.scenario, 'Je pars');
    assert.equal(output.transport, 'cloud');
    assert.equal(
      executions(server, 'cloud').at(-1).scenario,
      'd1b689e1-4087-473d-b726-d3b24770856f',
    );
    // One login for the whole session.
    assert.equal(server.installation.logins, 1);
    const unknown = await fake.sceneAction('run_scenario', { scenario: 'Nope' });
    assert.equal(unknown.success, false);
    assert.match(unknown.error, /Aucun scénario TaHoma/);
  } finally {
    await stop();
  }
});

test('local scenario: replayed from the actions read on the cloud', async () => {
  const { fake, server, stop } = await setup();
  try {
    const output = outputs(await fake.sceneAction('run_scenario', { scenario: 'Bonjour' }));
    assert.equal(output.transport, 'local');
    const last = executions(server, 'local').at(-1);
    assert.equal(last.label, 'Bonjour');
    assert.deepEqual(last.actions, [
      { deviceURL: KITCHEN, commands: [{ name: 'open', parameters: [] }] },
      { deviceURL: LIVING, commands: [{ name: 'setClosure', parameters: [30] }] },
    ]);
  } finally {
    await stop();
  }
});

test('fallback: a refused token goes to the cloud, degraded, then back to local', async () => {
  const { fake, app, server, stop } = await setup({
    before: (srv) => srv.installation.acceptedLocalTokens.delete(LOCAL_TOKEN),
  });
  try {
    await settle(app);
    const badge = lastTransport(fake, device(LIVING));
    assert.equal(badge.transport, 'cloud');
    assert.equal(badge.degraded, true);
    assert.match(badge.message.fr, /l’API locale ne répond pas \(la box a refusé le jeton local\)/);
    for (const text of Object.values(badge.message)) {
      assert.ok(text.length <= 200);
    }
    assert.match(fake.connectionStatus.message.en, /local API does not answer: the box refused/);
    // The token works again: the preferred channel is taken back.
    server.installation.acceptedLocalTokens.add(LOCAL_TOKEN);
    await until(() => lastTransport(fake, device(LIVING))?.transport === 'local');
    assert.equal(lastTransport(fake, device(LIVING)).degraded, undefined);
  } finally {
    await stop();
  }
});

test('preference: cloud first when Gladys says so, local as the fallback', async () => {
  const { fake, app, server, stop } = await setup({
    config: { ...BOTH_CONFIG, GLADYS_PREFER_LOCAL: false },
  });
  try {
    await settle(app);
    assert.equal(lastTransport(fake, device(LIVING)).transport, 'cloud');
    server.installation.down.cloud = true;
    server.push({ name: 'DeviceAvailableEvent', deviceURL: LIVING }, 'cloud');
    await until(() => lastTransport(fake, device(LIVING))?.transport === 'local');
    assert.equal(lastTransport(fake, device(LIVING)).degraded, true);
  } finally {
    await stop();
  }
});

test('box lost: unreachable badges, status, and the offline / online scene events', async () => {
  const { fake, app, server, stop } = await setup();
  try {
    await settle(app);
    server.installation.down.local = true;
    server.installation.down.cloud = true;
    await until(() => lastTransport(fake, device(LIVING))?.transport === 'unreachable');
    assert.equal(fake.connectionStatus.connected, false);
    assert.match(fake.connectionStatus.message.fr, /Box injoignable\. API locale : pas de réponse/);
    await until(() => fake.sceneEvents.some((event) => event.data.state === 'offline'));
    server.installation.down.local = false;
    server.installation.down.cloud = false;
    await until(() => fake.sceneEvents.some((event) => event.data.state === 'online'));
    const online = fake.sceneEvents.find((event) => event.data.state === 'online');
    assert.deepEqual(online, {
      key: 'box_connection_changed',
      data: { state: 'online', transport: 'local', pin: PIN },
    });
  } finally {
    await stop();
  }
});

test('listener: expired (box rebooted), registered again without dropping the channel', async () => {
  const { fake, app, server, stop } = await setup();
  try {
    await settle(app);
    server.installation.listeners.clear();
    await until(() => server.installation.listeners.size === 1);
    server.push(stateEvent(PLUG, [{ name: 'core:OnOffState', type: 3, value: 'on' }]));
    await until(() => fake.lastState(`${device(PLUG)}:switch`) === 1);
    assert.equal(lastTransport(fake, device(PLUG)).transport, 'local');
  } finally {
    await stop();
  }
});

test('command_failed: one event per failed device, never for a scene action', async () => {
  const { fake, server, stop } = await setup();
  try {
    server.push({
      name: 'ExecutionRegisteredEvent',
      execId: 'exec-1',
      label: 'Volet séjour - Fermer - TaHoma app',
    });
    server.push({
      name: 'ExecutionStateChangedEvent',
      execId: 'exec-1',
      newState: 'FAILED',
      oldState: 'IN_PROGRESS',
      failureType: 'CMDCANCELLED',
      failedCommands: [
        {
          deviceURL: LIVING,
          command: 'close',
          rank: 0,
          failureType: 'WHILEEXEC_BLOCKED_BY_HAZARD',
        },
      ],
    });
    await until(() => fake.sceneEvents.some((event) => event.key === 'command_failed'));
    assert.deepEqual(fake.sceneEvents.find((event) => event.key === 'command_failed').data, {
      device: device(LIVING),
      device_name: 'Volet séjour',
      failure_type: 'WHILEEXEC_BLOCKED_BY_HAZARD',
      label: 'Volet séjour - Fermer - TaHoma app',
    });
    const { exec_id: execId } = outputs(
      await fake.sceneAction('send_command', { device: device(LIVING), command: 'my' }),
    );
    server.push({
      name: 'ExecutionStateChangedEvent',
      execId,
      newState: 'FAILED',
      failedCommands: [{ deviceURL: LIVING, failureType: 'NONEXEC_OTHER' }],
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(fake.sceneEvents.filter((event) => event.key === 'command_failed').length, 1);
    assert.deepEqual(executions(server).at(-1).actions[0].commands, [
      { name: 'my', parameters: [] },
    ]);
    const refused = await fake.sceneAction('send_command', {
      device: device(DOOR),
      command: 'open',
    });
    assert.equal(refused.success, false);
    assert.match(refused.error, /n’accepte pas la commande/);
  } finally {
    await stop();
  }
});

test('enable_local: Developer Mode and token through the cloud, then local', async () => {
  const storage = memoryStorage();
  const { fake, app, server, stop } = await setup({ config: CLOUD_CONFIG, storage });
  try {
    await settle(app);
    assert.equal(lastTransport(fake, device(LIVING)).transport, 'cloud');
    const reply = message(await fake.action('enable_local'));
    assert.match(reply.fr, /Mode local activé : mode développeur allumé sur la box 1234-5678-9012/);
    assert.equal(server.installation.developerMode, true);
    assert.deepEqual(server.installation.localTokens, [
      { label: 'Gladys Assistant', token: 'generated-local-token-42', scope: 'devmode' },
    ]);
    assert.deepEqual(storage.files['local-token.json'], {
      pin: PIN,
      token: 'generated-local-token-42',
    });
    await until(() => lastTransport(fake, device(LIVING))?.transport === 'local');
  } finally {
    await stop();
  }
});

test('enable_local without an account: says what to do', async () => {
  const { fake, stop } = await setup({ config: LOCAL_CONFIG });
  try {
    const reply = message(await fake.action('enable_local'));
    assert.match(reply.en, /Enter and save your TaHoma account first/);
  } finally {
    await stop();
  }
});

test('TLS: a certificate outside the Overkiz authority is refused, cloud used', async () => {
  const { fake, app, stop } = await setup({ boxCert: 'rogue' });
  try {
    await settle(app);
    const badge = lastTransport(fake, device(LIVING));
    assert.equal(badge.transport, 'cloud');
    assert.match(badge.message.en, /certificate is not the one of a TaHoma box/);
  } finally {
    await stop();
  }
});

test('TLS: the certificate of another box is refused', async () => {
  const { fake, app, stop } = await setup({ boxCert: 'box-9999-8888-7777' });
  try {
    await settle(app);
    assert.equal(lastTransport(fake, device(LIVING)).transport, 'cloud');
  } finally {
    await stop();
  }
});

test('wrong password and no token: unreachable, says the password is refused', async () => {
  const { fake, stop } = await setup({
    config: { ...CLOUD_CONFIG, password: 'nope' },
    create: false,
  });
  try {
    assert.equal(fake.connectionStatus.connected, false);
    assert.match(
      fake.connectionStatus.message.fr,
      /cloud Somfy : Somfy a refusé l’e-mail ou le mot de passe/,
    );
  } finally {
    await stop();
  }
});

test('not configured: asks for an account or a token', async () => {
  const { fake, stop } = await setup({ config: { language: 'en' }, create: false });
  try {
    assert.equal(fake.connectionStatus.connected, false);
    assert.match(fake.connectionStatus.message.en, /Enter your TaHoma account, a local token/);
  } finally {
    await stop();
  }
});

test('restart without mDNS: the address remembered in /data', async () => {
  const storage = memoryStorage();
  const first = await setup({ storage });
  await settle(first.app);
  await first.stop({ keepServer: true });
  assert.equal(storage.files['box.json'].host, '127.0.0.1');
  const second = await setup({ storage, server: first.server, mdns: false });
  try {
    await settle(second.app);
    assert.equal(lastTransport(second.fake, device(LIVING)).transport, 'local');
  } finally {
    await second.stop();
  }
});

test('typed address with a port: no scan needed', async () => {
  const server = await startFakeOverkiz();
  const { fake, app, stop } = await setup({
    server,
    mdns: false,
    config: { ...LOCAL_CONFIG, local_host: `127.0.0.1:${server.localPort}` },
  });
  try {
    await settle(app);
    assert.equal(lastTransport(fake, device(LIVING)).transport, 'local');
    assert.match(fake.connectionStatus.message.en, /local network/);
  } finally {
    await stop();
  }
});

test('widgets: valid contents, My button, scenarios and refresh', async () => {
  const { fake, server, stop } = await setup();
  try {
    for (const [key, settings] of [
      ['cover', { device: device(LIVING) }],
      ['cover', { device: device(KITCHEN) }],
      ['cover', {}],
      ['overview', {}],
      ['scenarios', {}],
      ['scenarios', { names: 'Bonjour, Je pars' }],
    ]) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const { content } = ok(await fake.widgetGet(key, { settings, language }));
        assert.deepEqual(validateWidgetContent(content), [], `${key} ${language}`);
      }
    }
    const living = widget(await fake.widgetGet('cover', { settings: { device: device(LIVING) } }));
    assert.deepEqual(
      living.components.filter((item) => item.type === 'button').map((item) => item.label.en),
      ['Open', 'Stop', 'My', 'Close'],
    );
    const toast = message(
      await fake.widgetAction(
        'cover',
        'my',
        { device: device(LIVING) },
        {
          settings: { device: device(LIVING) },
        },
      ),
    );
    assert.match(toast.fr, /« My » envoyé à Volet séjour/);
    const scenarios = widget(await fake.widgetGet('scenarios', { settings: { names: 'Bonjour' } }));
    const button = scenarios.components.find((item) => item.type === 'button');
    assert.equal(button.label.fr, 'Bonjour');
    assert.equal(button.action.key, 'run_1');
    ok(await fake.widgetAction('scenarios', button.action.key, button.action.params));
    assert.equal(executions(server, 'local').at(-1).label, 'Bonjour');
    const refreshed = message(await fake.widgetAction('overview', 'refresh', {}));
    assert.match(refreshed.en, /States read again/);
    // The other box of the account: its scenario is never listed.
    const all = widget(await fake.widgetGet('scenarios', {}));
    const titles = all.components
      .find((item) => item.type === 'card-list')
      .items.map((item) => item.title);
    assert.deepEqual(titles, ['Bonjour', 'Je pars']);
  } finally {
    await stop();
  }
});

test('screen: closure wins over deployment, like the Home Assistant integration', async () => {
  const { fake, stop } = await setup({ create: false });
  try {
    const screen = deviceOf(fake, device(SCREEN));
    assert.deepEqual(keys(screen), ['state', 'position']);
  } finally {
    await stop();
  }
});
