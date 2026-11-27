// -----------------------------------------------------------------------------
// The integration: every Gladys handler, registered before connect().
//
//   discovery   every device of the box that Gladys can show (src/devices.js),
//               published after each read of the setup
//   states      pushed by the event listener of the box (src/box.js); only
//               the devices the user created are published
//   transport   the channel in use, per device: local, cloud, or unreachable;
//               degraded (orange dot) when it is not the preferred one
//   commands    Gladys features, scene actions, widget buttons -> one
//               execution on the box (`exec/apply`)
//   scenes      failed commands, devices lost and found, box lost and found
//               -> scene events; TaHoma scenarios and named commands as
//               scene actions
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { createBox } from './box.js';
import { diffConfig, normalizeConfig } from './config.js';
import {
  buildDevice,
  commandsFor,
  deviceValues,
  DEVICE_TYPE,
  FEATURE_KEYS,
  namedCommand,
} from './devices.js';
import { t, text, truncate, truncateAll, LANGUAGES } from './i18n.js';
import { ERROR_KINDS } from './overkiz/http.js';
import {
  coverOf,
  coverStateOf,
  isMoving,
  opennessOf,
  platformIdOf,
  STATES,
} from './overkiz/model.js';
import { failuresOf, SCENE_ACTIONS, SCENE_TRIGGERS } from './scenes.js';
import { createStatePublisher } from './states.js';
import { createStorage } from './storage.js';
import {
  buildCoverWidget,
  buildOverviewWidget,
  buildScenariosWidget,
  chooseScenarios,
  WIDGET_ACTIONS,
  WIDGETS,
} from './widgets.js';

export const ACTIONS = { TEST: 'test_connection', ENABLE_LOCAL: 'enable_local' };

const OFFLINE_AFTER_MS = 60 * 1000;
const WIDGET_REFRESH_SPACING_MS = 11 * 1000;
// A plug reports its power at every small variation: Gladys flags a feature
// storing a state every 10 s on average as "very chatty".
const POWER_SPACING_MS = 30 * 1000;
const EXECUTION_LABEL = 'Gladys Assistant';
const MAX_MESSAGE = 1800;
const MAX_TRACKED = 200;

/**
 * @description The reason of a channel failure, in words.
 * @param {object|null} error - OverkizError.
 * @param {'local'|'cloud'} kind - Channel.
 * @returns {object} Multi-language reason.
 */
export function reasonOf(error, kind) {
  if (!error) {
    return t('reasonUnknown');
  }
  if (error.code === 'NO_HOST') {
    return t('reasonNoHost');
  }
  switch (error.kind) {
    case ERROR_KINDS.CREDENTIALS:
      return t(kind === 'local' ? 'reasonToken' : 'reasonPassword');
    case ERROR_KINDS.RATE:
      return t('reasonRate');
    case ERROR_KINDS.MAINTENANCE:
      return t('reasonMaintenance');
    case ERROR_KINDS.TLS:
      return t('reasonTls');
    case ERROR_KINDS.NETWORK:
    case ERROR_KINDS.SESSION:
      return t('reasonNetwork');
    default:
      return t('reasonOther', { message: truncate(error.message, 80) });
  }
}

/**
 * @description Wire the integration.
 * @param {object} gladys - SDK client (or the fake one of the tests).
 * @param {object} [deps] - Dependencies.
 * @param {object} [deps.storage] - src/storage.js storage.
 * @param {object} [deps.logger] - Logger.
 * @param {Function} [deps.now] - Clock (ms).
 * @param {object} [deps.timings] - Box timings and `offlineAfterMs` (tests).
 * @param {object} [deps.factories] - Client factories (tests).
 * @param {Function} [deps.scan] - mDNS scan (tests).
 * @returns {object} `{ start, stop, box, … }`.
 */
export function createApp(
  gladys,
  {
    storage = createStorage(),
    logger = sdkLogger,
    now = Date.now,
    timings = {},
    factories,
    scan,
  } = {},
) {
  const offlineAfterMs = timings.offlineAfterMs ?? OFFLINE_AFTER_MS;
  let config = normalizeConfig(gladys.config ?? {});
  let statusKey = '';
  let discoveredKey = '';
  let discoveredCount = 0;
  let offlineTimer = null;
  let offlineFired = false;
  const created = new Set(); // device external ids
  const gladysNames = new Map(); // device external id -> name in Gladys
  const urlsById = new Map(); // device external id -> deviceURL
  const transports = new Map(); // device external id -> published key
  const widgetRefresh = new Map();
  const fromScenes = new Set(); // execution ids started by scene actions
  const labels = new Map(); // execution id -> label

  const states = createStatePublisher(gladys, {
    logger,
    now,
    isCreated: (externalId) => created.has(externalId),
    throttled: (featureId) => (featureId.endsWith(':power') ? POWER_SPACING_MS : 0),
  });

  const safely = (task, what) =>
    Promise.resolve()
      .then(task)
      .catch((error) => logger.warn(`TaHoma: ${what} failed: ${error?.message ?? error}`));

  const remember = (set, value) => {
    set.add(value);
    if (set.size > MAX_TRACKED) {
      set.delete(set.values().next().value);
    }
  };

  const box = createBox({
    gladys,
    storage,
    logger,
    now,
    timings,
    factories,
    scan,
    onUpdate: (what, data) => onBoxUpdate(what, data),
  });
  const view = box.state;

  // --- Ids ---------------------------------------------------------------------------------

  const idsOf = (device) => gladys.externalIds(DEVICE_TYPE, platformIdOf(device.url));
  const deviceIdOf = (device) => idsOf(device).device;
  const nameOf = (device) => gladysNames.get(deviceIdOf(device)) || device.label;

  const indexDevices = () => {
    for (const device of view.devices.values()) {
      urlsById.set(deviceIdOf(device), device.url);
    }
  };

  // --- Widgets, transports, status -------------------------------------------------------

  const refreshWidget = (key) => {
    const slot = widgetRefresh.get(key) ?? { at: -Infinity, timer: null };
    widgetRefresh.set(key, slot);
    const wait = slot.at + WIDGET_REFRESH_SPACING_MS - now();
    if (wait <= 0) {
      slot.at = now();
      safely(() => gladys.requestWidgetRefresh(key), 'widget refresh');
    } else if (!slot.timer) {
      slot.timer = setTimeout(() => {
        slot.timer = null;
        refreshWidget(key);
      }, wait);
      slot.timer.unref?.();
    }
  };
  const refreshWidgets = (keys = Object.values(WIDGETS)) => keys.forEach(refreshWidget);

  const configured = () => box.localConfigured() || box.cloudConfigured();
  const degraded = () =>
    Boolean(view.transport && view.preferred && view.transport !== view.preferred);

  /** The transport badge of every created device of the box. */
  const transportEntry = (externalId) => {
    if (!view.transport) {
      return { external_id: externalId, transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const entry = { external_id: externalId, transport: view.transport };
    if (degraded()) {
      entry.degraded = true;
      entry.message = truncateAll(
        t(view.transport === 'cloud' ? 'degradedCloud' : 'degradedLocal', {
          reason: reasonOf(view.failures[view.preferred], view.preferred),
        }),
        200,
      );
    }
    return entry;
  };

  const publishTransports = (force = false) => {
    const list = [];
    for (const externalId of created) {
      if (!urlsById.has(externalId)) {
        continue;
      }
      const entry = transportEntry(externalId);
      const key = JSON.stringify(entry);
      if (force || transports.get(externalId) !== key) {
        transports.set(externalId, key);
        list.push(entry);
      }
    }
    for (let index = 0; index < list.length; index += 100) {
      const batch = list.slice(index, index + 100);
      safely(() => gladys.publishTransports(batch), 'transport badges');
    }
  };

  /** The connection status, as shown in the configuration screen. */
  const statusOf = () => {
    if (!configured()) {
      return { key: 'none', connected: false, message: t('statusNotConfigured') };
    }
    const devices = discoveredCount;
    const pin = view.pin ?? '?';
    if (!view.transport) {
      const parts = ['local', 'cloud']
        .filter((kind) => (kind === 'local' ? box.localConfigured() : box.cloudConfigured()))
        .map((kind) => ({ kind, reason: reasonOf(view.failures[kind], kind) }));
      const message = {};
      for (const language of LANGUAGES) {
        const reasons = parts
          .map(({ kind, reason }) =>
            text('reasonLine', language, {
              channel: text(`channel_${kind}`, language),
              reason: reason[language],
            }),
          )
          .join(' ; ');
        message[language] = text('statusUnreachable', language, { reasons });
      }
      return {
        key: `off:${JSON.stringify(message.en)}`,
        connected: false,
        message,
      };
    }
    if (degraded()) {
      const key = view.transport === 'cloud' ? 'statusCloudFallback' : 'statusLocalFallback';
      return {
        key: `${key}:${pin}:${devices}:${view.failures[view.preferred]?.message}`,
        connected: true,
        message: t(key, {
          pin,
          devices,
          reason: reasonOf(view.failures[view.preferred], view.preferred),
        }),
      };
    }
    const key = view.transport === 'local' ? 'statusLocal' : 'statusCloud';
    return { key: `${key}:${pin}:${devices}`, connected: true, message: t(key, { pin, devices }) };
  };

  const publishStatus = (force = false) => {
    const status = statusOf();
    if (force || status.key !== statusKey) {
      statusKey = status.key;
      safely(
        () => gladys.setConnectionStatus(status.connected, truncateAll(status.message, 500)),
        'status',
      );
    }
  };

  // --- Scene events -------------------------------------------------------------------------

  const fire = (key, data) =>
    safely(() => gladys.publishSceneEvent(key, data), `scene event ${key}`);

  const online = () => Boolean(view.transport) && view.gatewayAlive !== false;

  const watchOnline = () => {
    const data = () => ({
      transport: view.transport ?? 'none',
      pin: view.pin ?? '',
    });
    if (online()) {
      clearTimeout(offlineTimer);
      offlineTimer = null;
      if (offlineFired) {
        offlineFired = false;
        fire(SCENE_TRIGGERS.BOX_CONNECTION_CHANGED, { state: 'online', ...data() });
      }
      return;
    }
    if (!offlineFired && !offlineTimer && configured()) {
      offlineTimer = setTimeout(() => {
        offlineTimer = null;
        if (!online() && !offlineFired) {
          offlineFired = true;
          fire(SCENE_TRIGGERS.BOX_CONNECTION_CHANGED, { state: 'offline', ...data() });
        }
      }, offlineAfterMs);
      offlineTimer.unref?.();
    }
  };

  const onExecution = (event) => {
    const execId = String(event.execId ?? '');
    if (event.name === 'ExecutionRegisteredEvent' && execId) {
      labels.set(execId, String(event.label ?? ''));
    }
    const failures = failuresOf(event);
    if (!failures || fromScenes.has(execId)) {
      return;
    }
    for (const { url, failure } of failures) {
      const device = url ? view.devices.get(url) : null;
      const deviceId = device ? deviceIdOf(device) : '';
      if (device && !created.has(deviceId)) {
        continue;
      }
      fire(SCENE_TRIGGERS.COMMAND_FAILED, {
        device: deviceId,
        device_name: device ? truncate(nameOf(device), 200) : '',
        failure_type: truncate(failure, 100),
        label: truncate(labels.get(execId) ?? '', 200),
      });
    }
  };

  // --- Box updates ----------------------------------------------------------------------------

  const pushDevice = (device) => {
    const ids = idsOf(device);
    for (const [key, value] of deviceValues(device)) {
      states.push(ids.feature(key), value);
    }
  };

  const publishDiscovered = () => {
    const devices = [...view.devices.values()]
      .map((device) => buildDevice(gladys, device, config.language))
      .filter(Boolean);
    discoveredCount = devices.length;
    const key = JSON.stringify(devices);
    if (key === discoveredKey) {
      return Promise.resolve();
    }
    discoveredKey = key;
    return safely(() => gladys.publishDiscoveredDevices(devices), 'discovery');
  };

  function onBoxUpdate(what, data) {
    switch (what) {
      case 'connection':
        publishTransports();
        publishStatus();
        watchOnline();
        refreshWidgets();
        break;
      case 'setup':
        indexDevices();
        publishDiscovered();
        view.devices.forEach(pushDevice);
        publishTransports();
        publishStatus();
        refreshWidgets([WIDGETS.COVER, WIDGETS.OVERVIEW]);
        break;
      case 'states':
        pushDevice(data.device);
        if (coverOf(data.device)) {
          refreshWidgets([WIDGETS.COVER, WIDGETS.OVERVIEW]);
        }
        break;
      case 'availability': {
        const deviceId = deviceIdOf(data.device);
        if (created.has(deviceId)) {
          fire(SCENE_TRIGGERS.AVAILABILITY_CHANGED, {
            device: deviceId,
            device_name: truncate(nameOf(data.device), 200),
            state: data.available ? 'available' : 'unavailable',
          });
        }
        refreshWidgets([WIDGETS.COVER, WIDGETS.OVERVIEW]);
        break;
      }
      case 'execution':
        onExecution(data);
        break;
      case 'gateway':
        watchOnline();
        refreshWidgets([WIDGETS.OVERVIEW]);
        break;
      case 'scenarios':
        refreshWidgets([WIDGETS.SCENARIOS]);
        break;
      default:
        break;
    }
  }

  // --- Commands ---------------------------------------------------------------------------------

  const userError = (key, vars = {}) => new Error(text(key, config.language, vars));

  const deviceOfId = (externalId) => {
    const deviceId = String(externalId ?? '')
      .split(':')
      .slice(0, 4)
      .join(':');
    const url = urlsById.get(deviceId);
    const device = url ? view.devices.get(url) : null;
    if (!device) {
      throw userError(view.transport ? 'errorUnknownDevice' : 'errorUnreachable', {
        name: gladysNames.get(deviceId) ?? deviceId,
      });
    }
    return device;
  };

  /** Send commands to one device, mapping the errors to user texts. */
  const send = async (device, commands) => {
    if (!commands || commands.length === 0) {
      return '';
    }
    try {
      return await box.execute([{ deviceURL: device.url, commands }], EXECUTION_LABEL);
    } catch (error) {
      throw userError(error.code === 'NO_CHANNEL' ? 'errorUnreachable' : 'errorRefused', {
        name: nameOf(device),
        error: truncate(error?.message ?? error, 200),
      });
    }
  };

  gladys.onSetValue(async (gladysDevice, feature, value) => {
    const device = deviceOfId(gladysDevice.external_id);
    const key = String(feature.external_id).split(':').pop();
    let commands;
    try {
      commands = commandsFor(device, key, value);
    } catch (error) {
      if (error instanceof RangeError) {
        throw userError('errorValue', { value: truncate(error.message, 60) });
      }
      throw error;
    }
    await send(device, commands);
    if (key === FEATURE_KEYS.STATE && !coverOf(device)?.feedback) {
      // RTS: nothing comes back, the next press must reach Gladys even if equal.
      states.forget(feature.external_id);
    }
  });

  // --- Device events -------------------------------------------------------------------------

  const track = (device) => {
    if (!device?.external_id || !String(device.external_id).includes(`:${DEVICE_TYPE}:`)) {
      return false;
    }
    created.add(device.external_id);
    gladysNames.set(device.external_id, device.name ?? '');
    const url = device.params?.find?.((param) => param.name === 'TAHOMA_DEVICE_URL')?.value;
    if (url && !urlsById.has(device.external_id)) {
      urlsById.set(device.external_id, url);
    }
    return true;
  };

  gladys.onDeviceCreated(async (device) => {
    if (track(device)) {
      // States published before the creation were thrown away by Gladys.
      states.republish(device.external_id);
      const url = urlsById.get(device.external_id);
      const known = url ? view.devices.get(url) : null;
      if (known) {
        pushDevice(known);
      }
      publishTransports(true);
    }
    refreshWidgets();
  });

  gladys.onDeviceUpdated?.(async (device) => {
    if (track(device)) {
      states.republish(device.external_id);
      // The "Update" of the Discovery screen saves the device as published,
      // which drops the GLADYS_TRANSPORT params the core keeps for the
      // badge: send it again.
      transports.delete(device.external_id);
      publishTransports();
    }
    refreshWidgets();
  });

  gladys.onDeviceDeleted?.(async (device) => {
    if (device?.external_id) {
      created.delete(device.external_id);
      transports.delete(device.external_id);
      gladysNames.delete(device.external_id);
      states.forget(device.external_id);
    }
    refreshWidgets();
  });

  gladys.onScanRequest(async () => {
    discoveredKey = '';
    if (view.transport) {
      await box.refresh().catch(() => {});
    } else {
      await box.connect();
    }
    await publishDiscovered();
  });

  gladys.onConfigUpdated(async (raw) => {
    const previous = config;
    config = normalizeConfig(raw ?? {});
    const changes = diffConfig(previous, config);
    if (changes.language) {
      discoveredKey = '';
      await publishDiscovered();
    }
    await box.reconfigure(config, changes);
    publishStatus(true);
    publishTransports(true);
  });

  // --- Configuration buttons ------------------------------------------------------------------

  gladys.onAction(ACTIONS.TEST, async () => {
    if (!configured()) {
      return t('statusNotConfigured');
    }
    await box.connect();
    if (box.cloudConfigured()) {
      await box.refreshScenarios(true).catch(() => {});
    }
    const status = statusOf();
    publishStatus(true);
    const message = {};
    for (const language of LANGUAGES) {
      const extra = box.cloudConfigured()
        ? ` ${text('testScenarios', language, { count: view.scenarios.length })}`
        : '';
      message[language] = `${status.message[language]}${extra}`;
    }
    return truncateAll(message, MAX_MESSAGE);
  });

  gladys.onAction(ACTIONS.ENABLE_LOCAL, async () => {
    try {
      const { pin } = await box.enableLocal();
      publishStatus(true);
      return view.transport === 'local'
        ? t('enableLocalOk', { pin })
        : t('enableLocalPending', {
            pin,
            reason: reasonOf(view.failures.local, 'local'),
          });
    } catch (error) {
      if (error.code === 'NO_ACCOUNT') {
        return t('enableLocalNoAccount');
      }
      if (error.code === 'NO_BOX') {
        return t('enableLocalNoBox');
      }
      return t('enableLocalFailed', { reason: reasonOf(error, 'cloud') });
    }
  });

  // --- Scene actions --------------------------------------------------------------------------

  const findScenario = (name) => {
    const wanted = String(name ?? '').trim();
    const lower = wanted.toLowerCase();
    return (
      view.scenarios.find((scenario) => scenario.oid === wanted) ??
      view.scenarios.find((scenario) => scenario.label.toLowerCase() === lower) ??
      null
    );
  };

  const runScenario = async (scenario) => {
    try {
      return await box.runScenario(scenario);
    } catch (error) {
      throw userError(error.code === 'NO_CHANNEL' ? 'errorBoxUnreachable' : 'errorScenario', {
        name: scenario.label,
        error: truncate(error?.message ?? error, 200),
      });
    }
  };

  gladys.onSceneAction(SCENE_ACTIONS.RUN_SCENARIO, async (fields = {}) => {
    let scenario = findScenario(fields.scenario);
    if (!scenario && box.cloudConfigured()) {
      await box.refreshScenarios(true).catch(() => {});
      scenario = findScenario(fields.scenario);
    }
    if (!scenario) {
      throw userError(box.cloudConfigured() ? 'errorNoScenario' : 'errorScenariosNeedCloud', {
        name: truncate(fields.scenario, 80),
      });
    }
    const execId = await runScenario(scenario);
    remember(fromScenes, execId);
    return {
      exec_id: execId,
      scenario: scenario.label,
      transport: view.transport ?? 'none',
    };
  });

  gladys.onSceneAction(SCENE_ACTIONS.SEND_COMMAND, async (fields = {}) => {
    const device = deviceOfId(fields.device);
    const name = String(fields.command ?? '');
    const commands = namedCommand(device, name);
    if (!commands) {
      throw userError('errorCommand', { name: nameOf(device), command: truncate(name, 30) });
    }
    const execId = await send(device, commands);
    remember(fromScenes, execId);
    return { exec_id: execId, transport: view.transport ?? 'none' };
  });

  // --- Widgets ------------------------------------------------------------------------------

  /** Snapshot of a cover for the widgets. */
  const coverView = (device) => {
    const cover = coverOf(device);
    const ids = idsOf(device);
    const memorized = device.states.get(STATES.MEMORIZED_1);
    const values = Object.fromEntries(deviceValues(device));
    return {
      deviceId: ids.device,
      name: nameOf(device),
      reachable: Boolean(view.transport) && device.available,
      curtain: cover.curtain,
      toggle: cover.toggle,
      state: cover.feedback ? coverStateOf(device, cover) : null,
      moving: isMoving(device),
      position: opennessOf(device, cover.position),
      tilt: opennessOf(device, cover.tilt),
      myPosition:
        cover.position && Number.isFinite(memorized) && memorized >= 0 && memorized <= 100
          ? cover.position.inverted
            ? 100 - memorized
            : memorized
          : null,
      hasStop: Boolean(cover.stop || cover.my),
      hasMy: Boolean(cover.my),
      battery: values.battery ?? null,
      batteryLow: values.battery_low === 1 || (values.battery ?? 100) <= 15,
      features: {
        state: ids.feature(FEATURE_KEYS.STATE),
        position: cover.position ? ids.feature(FEATURE_KEYS.POSITION) : null,
      },
    };
  };

  const createdCovers = () =>
    [...view.devices.values()]
      .filter((device) => coverOf(device) && created.has(deviceIdOf(device)))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  gladys.onWidgetGet(WIDGETS.COVER, async ({ settings } = {}) => {
    const url = urlsById.get(settings?.device);
    const device = url ? view.devices.get(url) : null;
    return buildCoverWidget(device && coverOf(device) ? coverView(device) : null);
  });

  gladys.onWidgetGet(WIDGETS.OVERVIEW, async ({ settings } = {}) =>
    buildOverviewWidget({
      covers: createdCovers().map(coverView),
      names: settings?.names,
      box: {
        pin: view.pin,
        transport: view.transport,
        degraded: degraded(),
        configured: configured(),
        firmware: view.firmware,
        devices: [...view.devices.values()].filter((device) => created.has(deviceIdOf(device)))
          .length,
        unavailable: [...view.devices.values()]
          .filter((device) => created.has(deviceIdOf(device)) && !device.available)
          .map(nameOf),
      },
    }),
  );

  gladys.onWidgetGet(WIDGETS.SCENARIOS, async ({ settings } = {}) => {
    if (box.cloudConfigured()) {
      await box.refreshScenarios().catch(() => {});
    }
    return buildScenariosWidget({
      scenarios: chooseScenarios(view.scenarios, settings?.names),
      reachable: Boolean(view.transport),
      cloud: box.cloudConfigured(),
    });
  });

  const toast = (error) => {
    const message = truncate(error?.message ?? error, 200);
    return { en: message, fr: message, de: message, es: message };
  };

  gladys.onWidgetAction(WIDGETS.COVER, async (actionKey, params = {}, { settings } = {}) => {
    if (actionKey !== WIDGET_ACTIONS.MY) {
      return undefined;
    }
    try {
      const device = deviceOfId(settings?.device ?? params.device);
      const commands = namedCommand(device, 'my');
      if (!commands) {
        throw userError('errorCommand', { name: nameOf(device), command: 'my' });
      }
      await send(device, commands);
      return truncateAll(t('widgetDone', { name: nameOf(device) }), 200);
    } catch (error) {
      return toast(error);
    }
  });

  gladys.onWidgetAction(WIDGETS.OVERVIEW, async (actionKey) => {
    if (actionKey !== WIDGET_ACTIONS.REFRESH) {
      return undefined;
    }
    try {
      await box.refresh();
      refreshWidgets();
      return t('widgetRefreshed');
    } catch (error) {
      return truncateAll(
        t('widgetRefreshFailed', { reason: reasonOf(error, view.transport) }),
        200,
      );
    }
  });

  gladys.onWidgetAction(WIDGETS.SCENARIOS, async (actionKey, params = {}) => {
    if (!String(actionKey).startsWith(`${WIDGET_ACTIONS.RUN}_`)) {
      return undefined;
    }
    const scenario = view.scenarios.find((item) => item.oid === params.oid);
    if (!scenario) {
      return t('widgetScenarioGone');
    }
    try {
      await runScenario(scenario);
      return truncateAll(t('widgetScenarioRun', { name: scenario.label }), 200);
    } catch (error) {
      return toast(error);
    }
  });

  // --- Lifecycle ---------------------------------------------------------------------------------

  return {
    /** Remember the created devices, then connect to the box. */
    async start() {
      config = normalizeConfig(gladys.config ?? {});
      created.clear();
      (gladys.devices ?? []).forEach(track);
      await box.start(config);
      publishStatus();
    },

    async stop() {
      clearTimeout(offlineTimer);
      widgetRefresh.forEach((slot) => clearTimeout(slot.timer));
      await box.stop();
      states.stop();
    },

    box,
    flushStates: () => states.flush(),
    statusOf,
  };
}
