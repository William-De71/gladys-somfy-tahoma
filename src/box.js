// -----------------------------------------------------------------------------
// The TaHoma box: which channel reaches it, its devices, its events.
//
// Channels: the local API (Developer Mode token + address of the box) and the
// Somfy cloud (TaHoma account). The preferred one (the "Prefer the local
// connection" toggle of Gladys, on by default) is tried first, the other one
// is the fallback. While on the fallback, the preferred channel is tried
// again every 5 minutes and taken back as soon as it answers.
//
// On the channel in use:
//   1. `GET /setup` -> the devices of the box (filtered on its PIN);
//   2. `POST /events/register` -> a listener, then `POST /events/<id>/fetch`
//      every 2 s on the local API (Somfy: "once every second at most"), every
//      30 s on the cloud, 2 s for a minute after a command (the same pace as
//      the Home Assistant integration: the cloud is shared and rate-limited);
//   3. `GET /setup` again every 10 min (local) / 30 min (cloud), and after a
//      device is added or removed: a missed event never lasts.
// An expired listener (the box rebooted, 10 min without a fetch) is
// registered again; any other failure drops the channel and reconnects,
// trying the other one.
//
// One box per integration: the PIN typed in the configuration, otherwise the
// one of the local token, the box found on the network, or the first box of
// the account.
// -----------------------------------------------------------------------------

import { createCloudClient, createLocalClient, PIN_PATTERN } from './overkiz/clients.js';
import { scanBoxes } from './overkiz/discovery.js';
import { ERROR_KINDS, OverkizError } from './overkiz/http.js';
import { applyStates, normalizeDevice, pinOf, STATES } from './overkiz/model.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const DEFAULT_TIMINGS = {
  localFetchMs: 2 * SECOND,
  cloudFetchMs: 30 * SECOND,
  fastFetchMs: 2 * SECOND,
  fastWindowMs: MINUTE,
  rateBackoffMs: MINUTE,
  localResyncMs: 10 * MINUTE,
  cloudResyncMs: 30 * MINUTE,
  retryMs: [30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE],
  credentialsRetryMs: 30 * MINUTE,
  preferredProbeMs: 5 * MINUTE,
  scanSpacingMs: 5 * MINUTE,
  scenariosMs: 60 * MINUTE,
};

export const TOKEN_LABEL = 'Gladys Assistant';

const RESYNC_EVENTS = new Set(['DeviceCreatedEvent', 'DeviceRemovedEvent', 'DeviceUpdatedEvent']);

/**
 * @description Create the box manager.
 * @param {object} options - Options.
 * @param {object} options.gladys - SDK client (mDNS scan).
 * @param {object} options.storage - src/storage.js storage.
 * @param {object} options.logger - Logger.
 * @param {Function} [options.now] - Clock (ms).
 * @param {object} [options.timings] - Overrides of DEFAULT_TIMINGS (tests).
 * @param {object} [options.factories] - `{ cloud(options), local(options) }` (tests).
 * @param {Function} [options.scan] - `() => Promise<{ boxes, error }>` (tests).
 * @param {Function} options.onUpdate - `(what, data)`: 'connection', 'setup',
 *   'states', 'availability', 'execution', 'scenarios', 'gateway'.
 * @returns {object} The box.
 */
export function createBox({
  gladys,
  storage,
  logger,
  now = Date.now,
  timings: overrides = {},
  factories = {},
  scan,
  onUpdate,
}) {
  const timings = { ...DEFAULT_TIMINGS, ...overrides };
  const makeCloud = factories.cloud ?? createCloudClient;
  const makeLocal = factories.local ?? createLocalClient;
  const scanNetwork = scan ?? (() => scanBoxes(gladys, { logger }));

  let config = null;
  let stopped = true;
  let cloud = null; // cloud client, kept for its tokens
  let channel = null; // client in use
  let listenerId = null;
  let timer = null;
  let resyncAt = 0;
  let probeAt = 0;
  let fastUntil = 0;
  let retryIndex = 0;
  let connecting = null;
  let lastScanAt = -Infinity;
  let scanError = null;
  let scenariosAt = -Infinity;
  let scenariosLoading = null;

  const box = {
    pin: null,
    firmware: '',
    gatewayAlive: null,
    devices: new Map(), // deviceURL -> normalized device
    scenarios: [], // [{ oid, label, actions }]
    transport: null, // 'local' | 'cloud' | null (unreachable)
    preferred: null, // 'local' | 'cloud' | null when nothing is configured
    failures: { local: null, cloud: null }, // last error of each channel
    local: { host: '', port: 8443, token: '', source: '' },
    lastEventAt: null,
  };

  const notify = (what, data) => {
    try {
      onUpdate?.(what, data);
    } catch (error) {
      logger.warn(`TaHoma: update handler failed: ${error?.message ?? error}`);
    }
  };

  const describe = (error) => `${error?.kind ?? 'error'}: ${error?.message ?? error}`;

  // --- Persistence -----------------------------------------------------------------

  let saved = { box: {}, token: {} };

  const persist = async () => {
    try {
      await storage.write('box.json', {
        pin: box.pin,
        host: box.local.source === 'typed' ? saved.box.host : box.local.host || saved.box.host,
        port: box.local.port,
      });
    } catch (error) {
      logger.warn(`TaHoma: saving the box failed: ${error.message}`);
    }
  };

  // --- Channels --------------------------------------------------------------------

  const localToken = () =>
    config.localToken ||
    (saved.token?.token && (!box.pin || saved.token.pin === box.pin) ? saved.token.token : '');

  const localConfigured = () => Boolean(localToken());
  const cloudConfigured = () => config.cloudConfigured;

  const cloudClient = () => {
    cloud ??= makeCloud({
      username: config.username,
      password: config.password,
      region: config.region,
      now,
    });
    return cloud;
  };

  /** Where the box is on the network: typed, found by mDNS, or remembered. */
  const resolveLocalHost = async (force = false) => {
    if (config.localHost) {
      Object.assign(box.local, { ...config.localHost, source: 'typed' });
      return box.local.host;
    }
    if (force || !box.local.host || now() - lastScanAt >= timings.scanSpacingMs) {
      if (now() - lastScanAt >= timings.scanSpacingMs || force) {
        lastScanAt = now();
        const result = await scanNetwork();
        scanError = result.error;
        const wanted = box.pin ?? config.pin ?? saved.token?.pin ?? null;
        const found =
          result.boxes.find((item) => item.pin === wanted) ??
          (!wanted && result.boxes.length === 1 ? result.boxes[0] : null);
        if (found) {
          Object.assign(box.local, { host: found.host, port: found.port, source: 'mdns' });
          box.pin ??= found.pin;
          box.firmware ||= found.firmware;
          return found.host;
        }
      }
    }
    if (!box.local.host && saved.box.host) {
      Object.assign(box.local, {
        host: saved.box.host,
        port: Number(saved.box.port) || 8443,
        source: 'saved',
      });
    }
    return box.local.host;
  };

  const openChannel = async (kind) => {
    if (kind === 'cloud') {
      return cloudClient();
    }
    const host = await resolveLocalHost();
    if (!host) {
      throw new OverkizError(
        ERROR_KINDS.NETWORK,
        scanError === 'forbidden'
          ? 'Gladys refused the network search and no address is typed'
          : 'the box was not found on the local network',
        { code: 'NO_HOST' },
      );
    }
    box.local.token = localToken();
    return makeLocal({
      host,
      port: box.local.port,
      token: box.local.token,
      pin: box.pin ?? config.pin,
    });
  };

  /** The PIN of the box, from the setup when not known yet. */
  const choosePin = (setup) => {
    const gateways = (setup?.gateways ?? [])
      .map((gateway) => String(gateway?.gatewayId ?? ''))
      .filter((pin) => PIN_PATTERN.test(pin));
    const wanted = config.pin ?? box.pin ?? saved.box.pin ?? saved.token?.pin;
    if (wanted && (gateways.includes(wanted) || gateways.length === 0)) {
      return wanted;
    }
    if (wanted && !config.pin) {
      // The remembered box is not on this account any more: take the first.
      return gateways[0] ?? wanted;
    }
    return wanted ?? gateways[0] ?? null;
  };

  /** Load a setup: devices of the box, its gateway. */
  const loadSetup = (setup) => {
    box.pin = choosePin(setup);
    const gateway = (setup?.gateways ?? []).find((item) => item?.gatewayId === box.pin);
    if (gateway) {
      box.firmware = String(gateway.connectivity?.protocolVersion ?? box.firmware ?? '');
      box.gatewayAlive =
        gateway.alive === false || gateway.connectivity?.status === 'NOT_CONNECTED' ? false : true;
    }
    const devices = new Map();
    for (const raw of setup?.devices ?? []) {
      const device = normalizeDevice(raw);
      if (device && (!box.pin || device.pin === box.pin)) {
        devices.set(device.url, device);
      }
    }
    box.devices = devices;
    resyncAt = now() + (box.transport === 'local' ? timings.localResyncMs : timings.cloudResyncMs);
    notify('setup', { devices: [...devices.values()] });
  };

  const setTransport = (transport, before) => {
    box.transport = transport;
    if (before !== transport) {
      logger.info(
        `TaHoma: ${transport ? `connected through the ${transport === 'local' ? 'local API' : 'Somfy cloud'}` : 'box unreachable'}`,
      );
    }
    notify('connection', { before, transport });
  };

  const order = () => {
    const kinds = config.preferLocal ? ['local', 'cloud'] : ['cloud', 'local'];
    return kinds.filter((kind) => (kind === 'local' ? localConfigured() : cloudConfigured()));
  };

  const tryChannel = async (kind) => {
    const client = await openChannel(kind);
    const setup = await client.getSetup();
    box.transport = kind; // resync spacing of loadSetup
    loadSetup(setup);
    listenerId = await client.registerListener();
    channel = client;
    box.failures[kind] = null;
    return client;
  };

  const connectOnce = async () => {
    const kinds = order();
    const before = box.transport;
    box.preferred = kinds[0] ?? null;
    channel = null;
    listenerId = null;
    for (const kind of kinds) {
      if (stopped) {
        return;
      }
      try {
        await tryChannel(kind);
        retryIndex = 0;
        probeAt = now() + timings.preferredProbeMs;
        setTransport(kind, before);
        await persist();
        refreshScenarios().catch(() => {});
        schedule(kind === 'local' ? timings.localFetchMs : timings.fastFetchMs);
        return;
      } catch (error) {
        box.failures[kind] = error;
        logger.warn(`TaHoma: ${kind} channel failed (${describe(error)})`);
        if (kind === 'local' && !config.localHost && error.kind === ERROR_KINDS.NETWORK) {
          // The box may have a new address: look for it at the next try.
          box.local.host = '';
          lastScanAt = -Infinity;
        }
      }
    }
    setTransport(null, before);
    if (kinds.length > 0) {
      const onlyCredentials = kinds.every(
        (kind) => box.failures[kind]?.kind === ERROR_KINDS.CREDENTIALS,
      );
      const delay = onlyCredentials
        ? timings.credentialsRetryMs
        : timings.retryMs[Math.min(retryIndex, timings.retryMs.length - 1)];
      retryIndex += 1;
      schedule(delay, () => connect());
    }
  };

  /** Connect (or reconnect), or join the connection under way. */
  const connect = () => {
    clearTimeout(timer);
    timer = null;
    connecting ??= connectOnce().finally(() => {
      connecting = null;
    });
    return connecting;
  };

  // --- Event loop ----------------------------------------------------------------

  function schedule(delay, task = tick) {
    clearTimeout(timer);
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      task().catch((error) => logger.warn(`TaHoma: loop failed: ${error?.message ?? error}`));
    }, delay);
    timer.unref?.();
  }

  const nextFetchDelay = () => {
    if (box.transport === 'local') {
      return timings.localFetchMs;
    }
    return now() < fastUntil ? timings.fastFetchMs : timings.cloudFetchMs;
  };

  const handleEvent = (event) => {
    const name = event?.name;
    const url = event?.deviceURL;
    if (url && box.pin && pinOf(url) !== box.pin) {
      return false;
    }
    if (event?.gatewayId && box.pin && event.gatewayId !== box.pin) {
      return false;
    }
    switch (name) {
      case 'DeviceStateChangedEvent': {
        const device = box.devices.get(url);
        if (!device) {
          return false;
        }
        const wasAvailable = device.states.get(STATES.STATUS);
        const changed = applyStates(device, event.deviceStates);
        if (changed.length > 0) {
          notify('states', { device, changed });
        }
        if (changed.includes(STATES.STATUS)) {
          const status = device.states.get(STATES.STATUS);
          if (wasAvailable !== undefined && (status === 'available' || status === 'unavailable')) {
            device.available = status === 'available';
            notify('availability', { device, available: device.available });
          }
        }
        return false;
      }
      case 'DeviceAvailableEvent':
      case 'DeviceUnavailableEvent': {
        const device = box.devices.get(url);
        const available = name === 'DeviceAvailableEvent';
        if (device && device.available !== available) {
          device.available = available;
          notify('availability', { device, available });
        }
        return false;
      }
      case 'ExecutionRegisteredEvent':
      case 'ExecutionStateChangedEvent':
      case 'CommandExecutionStateChangedEvent':
        notify('execution', event);
        return false;
      case 'GatewayAliveEvent':
      case 'GatewayDownEvent': {
        const alive = name === 'GatewayAliveEvent';
        if (box.gatewayAlive !== alive) {
          box.gatewayAlive = alive;
          notify('gateway', { alive });
        }
        return false;
      }
      default:
        return RESYNC_EVENTS.has(name);
    }
  };

  const resync = async () => {
    const setup = await channel.getSetup();
    loadSetup(setup);
  };

  /** While on the fallback, try the preferred channel again. */
  const probePreferred = async () => {
    probeAt = now() + timings.preferredProbeMs;
    const preferred = order()[0];
    if (!preferred || preferred === box.transport) {
      return false;
    }
    try {
      const client = await openChannel(preferred);
      await client.getSetup();
    } catch (error) {
      box.failures[preferred] = error;
      return false;
    }
    logger.info(`TaHoma: the ${preferred} channel answers again, switching back`);
    const previous = channel;
    previous?.unregisterListener?.(listenerId)?.catch?.(() => {});
    await connect();
    return true;
  };

  async function tick() {
    if (stopped || !channel) {
      return;
    }
    let delay;
    try {
      const events = await channel.fetchEvents(listenerId);
      let needResync = false;
      for (const event of events) {
        needResync = handleEvent(event) || needResync;
      }
      if (events.length > 0) {
        box.lastEventAt = now();
      }
      if (needResync || now() >= resyncAt) {
        await resync();
      }
      if (box.transport !== order()[0] && now() >= probeAt && (await probePreferred())) {
        return;
      }
      delay = nextFetchDelay();
    } catch (caught) {
      let error = caught;
      if (error.kind === ERROR_KINDS.LISTENER) {
        logger.info('TaHoma: event listener expired, registering again');
        try {
          await resync();
          listenerId = await channel.registerListener();
          schedule(nextFetchDelay());
          return;
        } catch (again) {
          error = again;
        }
      }
      if (error.kind === ERROR_KINDS.RATE) {
        logger.warn(`TaHoma: ${box.transport} rate limit (${error.message}), waiting`);
        schedule(timings.rateBackoffMs);
        return;
      }
      box.failures[box.transport] = error;
      logger.warn(`TaHoma: ${box.transport} channel lost (${describe(error)}), reconnecting`);
      channel = null;
      listenerId = null;
      await connect();
      return;
    }
    schedule(delay);
  }

  // --- Scenarios -------------------------------------------------------------------

  /**
   * @description Read the TaHoma scenarios from the cloud (the local API has
   * none) and keep them in /data, to replay them locally.
   * A read under way is shared: a widget asked during the first read waits
   * for it instead of showing an empty list.
   * @param {boolean} [force] - Even if read less than an hour ago.
   * @returns {Promise<object[]>} The scenarios.
   */
  function refreshScenarios(force = false) {
    if (scenariosLoading) {
      return scenariosLoading;
    }
    if (!cloudConfigured() || (!force && now() - scenariosAt < timings.scenariosMs)) {
      return Promise.resolve(box.scenarios);
    }
    scenariosAt = now();
    scenariosLoading = loadScenarios().finally(() => {
      scenariosLoading = null;
    });
    return scenariosLoading;
  }

  async function loadScenarios() {
    const groups = await cloudClient().getScenarios();
    box.scenarios = groups
      .filter((group) => group?.oid && Array.isArray(group.actions))
      .filter((group) =>
        group.actions.every((action) => !box.pin || pinOf(action?.deviceURL) === box.pin),
      )
      .map((group) => ({
        oid: String(group.oid),
        label: String(group.label ?? '').trim() || String(group.oid),
        actions: group.actions.map((action) => ({
          deviceURL: action.deviceURL,
          commands: (action.commands ?? []).map((item) => ({
            name: item.name,
            parameters: item.parameters ?? [],
          })),
        })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    await storage
      .write('scenarios.json', { pin: box.pin, scenarios: box.scenarios })
      .catch(() => {});
    notify('scenarios', { scenarios: box.scenarios });
    return box.scenarios;
  }

  // --- Public API ------------------------------------------------------------------

  const requireChannel = () => {
    if (!channel) {
      throw new OverkizError(ERROR_KINDS.NETWORK, 'the box is unreachable', { code: 'NO_CHANNEL' });
    }
    return channel;
  };

  /** Run something on the channel; a lost channel reconnects. */
  const onChannel = async (task) => {
    const client = requireChannel();
    if (client.transport === 'cloud') {
      fastUntil = now() + timings.fastWindowMs;
      if (timer && !connecting) {
        schedule(timings.fastFetchMs);
      }
    }
    try {
      return await task(client);
    } catch (error) {
      if ([ERROR_KINDS.NETWORK, ERROR_KINDS.TLS, ERROR_KINDS.SERVER].includes(error.kind)) {
        box.failures[client.transport] = error;
        channel = null;
        connect().catch(() => {});
      }
      throw error;
    }
  };

  return {
    state: box,

    /** Load what /data remembers, then connect. */
    async start(newConfig) {
      config = newConfig;
      stopped = false;
      saved = {
        box: (await storage.read('box.json')) ?? {},
        token: (await storage.read('local-token.json')) ?? {},
      };
      const scenarios = await storage.read('scenarios.json');
      box.pin = config.pin ?? (PIN_PATTERN.test(saved.box.pin ?? '') ? saved.box.pin : null);
      if (Array.isArray(scenarios?.scenarios) && (!box.pin || scenarios.pin === box.pin)) {
        box.scenarios = scenarios.scenarios;
      }
      await connect();
    },

    /** New configuration: drop the clients that depend on it and reconnect. */
    async reconfigure(newConfig, changes) {
      config = newConfig;
      if (changes.cloud) {
        cloud = null;
        scenariosAt = -Infinity;
        box.failures.cloud = null;
      }
      if (changes.local) {
        box.local.host = '';
        box.failures.local = null;
        lastScanAt = -Infinity;
        if (newConfig.pin) {
          box.pin = newConfig.pin;
        }
      }
      if (changes.cloud || changes.local || changes.preference) {
        retryIndex = 0;
        channel = null;
        await connect();
      }
    },

    connect,

    /**
     * @description Send commands to devices of the box.
     * @param {object[]} actions - `[{ deviceURL, commands }]`.
     * @param {string} label - Label of the execution (TaHoma history).
     * @returns {Promise<string>} The execution id.
     */
    execute: (actions, label) => onChannel((client) => client.apply(actions, label)),

    /**
     * @description Run a TaHoma scenario: on the cloud by its id, on the local
     * API by replaying its actions.
     * @param {object} scenario - `{ oid, label, actions }`.
     * @returns {Promise<string>} The execution id.
     */
    runScenario: (scenario) =>
      onChannel((client) =>
        client.transport === 'cloud'
          ? client.runScenario(scenario.oid)
          : client.apply(scenario.actions, scenario.label),
      ),

    refreshScenarios,

    /** Ask the box to read the states again (cloud), or read the setup again. */
    async refresh() {
      await onChannel(async (client) => {
        if (client.transport === 'cloud') {
          await client.refreshStates().catch(() => {});
        }
        loadSetup(await client.getSetup());
      });
    },

    /**
     * @description Turn the Developer Mode on and create a local token,
     * through the cloud account.
     * @returns {Promise<{ pin: string, created: boolean }>} The box.
     */
    async enableLocal() {
      if (!cloudConfigured()) {
        throw new OverkizError(ERROR_KINDS.CREDENTIALS, 'no TaHoma account', {
          code: 'NO_ACCOUNT',
        });
      }
      const client = cloudClient();
      if (!box.pin) {
        loadSetup(await client.getSetup());
      }
      if (!box.pin) {
        throw new OverkizError(ERROR_KINDS.REFUSED, 'no box on this account', { code: 'NO_BOX' });
      }
      const active = await client.developerMode(box.pin).catch(() => false);
      if (!active) {
        await client.activateDeveloperMode(box.pin);
      }
      const token = await client.createLocalToken(box.pin, TOKEN_LABEL);
      saved.token = { pin: box.pin, token };
      await storage.write('local-token.json', saved.token);
      box.failures.local = null;
      lastScanAt = -Infinity;
      retryIndex = 0;
      channel = null;
      await connect();
      return { pin: box.pin, created: true };
    },

    /** Look for the box on the network now (configuration button). */
    async locate() {
      lastScanAt = -Infinity;
      return resolveLocalHost(true);
    },

    localConfigured,
    cloudConfigured,
    get scanError() {
      return scanError;
    },

    async stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      const client = channel;
      channel = null;
      if (client && listenerId) {
        await client.unregisterListener(listenerId).catch(() => {});
      }
      await Promise.allSettled([connecting]);
    },
  };
}
