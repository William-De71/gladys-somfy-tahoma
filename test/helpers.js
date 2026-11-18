// Test helpers: the whole integration wired to the fake Gladys of the SDK and
// to the fake Somfy cloud and box of test/helpers/fake-overkiz.js, through
// its real HTTP and TLS code. Nothing leaves 127.0.0.1.

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

import { createApp } from '../src/app.js';
import { createCloudClient, createLocalClient } from '../src/overkiz/clients.js';
import { memoryStorage } from '../src/storage.js';
import {
  LOCAL_TOKEN,
  PASSWORD,
  PIN,
  startFakeOverkiz,
  TEST_CA,
  USERNAME,
} from './helpers/fake-overkiz.js';

export { LOCAL_TOKEN, PASSWORD, PIN, USERNAME };

export const CLOUD_CONFIG = { username: USERNAME, password: PASSWORD, language: 'fr' };
export const BOTH_CONFIG = { ...CLOUD_CONFIG, local_token: LOCAL_TOKEN };
export const LOCAL_CONFIG = { local_token: LOCAL_TOKEN, language: 'fr' };

export const device = (address) =>
  `ext:test-integration:device:${address.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export const LIVING = 'io://1234-5678-9012/12184029'; // roller shutter, position, My
export const KITCHEN = 'rts://1234-5678-9012/16730022'; // RTS roller shutter
export const LAMP = 'io://1234-5678-9012/1170079'; // dimmable light
export const PLUG = 'io://1234-5678-9012/10042836'; // on / off
export const DOOR = 'rtds://1234-5678-9012/347675'; // contact sensor
export const SCREEN = 'io://1234-5678-9012/3904805'; // exterior screen
export const THERMO = 'io://1234-5678-9012/1292684#2'; // temperature sensor

export const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * @description Wait until a condition holds (real sockets take a few ms).
 * @param {Function} condition - `() => boolean`.
 * @param {number} [timeoutMs] - Give up after.
 * @returns {Promise<void>} Resolves when true, rejects on timeout.
 */
export async function until(condition, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > end) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export const FAST_TIMINGS = {
  localFetchMs: 20,
  cloudFetchMs: 60,
  fastFetchMs: 20,
  fastWindowMs: 1000,
  rateBackoffMs: 50,
  localResyncMs: 60000,
  cloudResyncMs: 60000,
  retryMs: [60],
  credentialsRetryMs: 300,
  preferredProbeMs: 150,
  scanSpacingMs: 0,
  scenariosMs: 60000,
  offlineAfterMs: 150,
};

/**
 * @description An integration wired to the fake Gladys and the fake Overkiz.
 * @param {object} [options] - Options.
 * @param {object} [options.config] - Integration configuration.
 * @param {boolean} [options.create] - Create every discovered device.
 * @param {object} [options.storage] - Storage (memory by default).
 * @param {string} [options.boxCert] - Certificate of the fake box.
 * @param {boolean} [options.mdns] - The box answers the mDNS scan.
 * @param {object} [options.server] - A running fake Overkiz (restarts).
 * @param {Function} [options.before] - `(server) => void` before the start.
 * @returns {Promise<object>} `{ gladys, fake, app, server, logs, storage, stop }`.
 */
export async function setup({
  config = BOTH_CONFIG,
  create = true,
  storage = memoryStorage(),
  boxCert,
  mdns = true,
  server: running,
  before,
  devices,
} = {}) {
  const server = running ?? (await startFakeOverkiz({ boxCert }));
  before?.(server);
  const scanResults = {
    mdns: mdns
      ? [
          {
            name: `gateway-${PIN}`,
            host: `gateway-${PIN}.local`,
            addresses: ['127.0.0.1'],
            port: server.localPort,
            txt: [`gateway_pin=${PIN}`, 'api_version=1', 'fw_version=2026.4.4-3'],
          },
        ]
      : [],
  };
  const gladys = createFakeGladys({ config: structuredClone(config), scanResults, devices });
  const logs = [];
  const log = (line) => logs.push(String(line));
  const app = createApp(gladys, {
    storage,
    logger: { debug: log, info: log, warn: log, error: log },
    timings: FAST_TIMINGS,
    factories: {
      cloud: (options) => createCloudClient({ ...options, urls: server.cloudUrls }),
      local: (options) => createLocalClient({ ...options, ca: TEST_CA }),
    },
  });
  await gladys.connect();
  await app.start();
  if (create) {
    for (const item of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(structuredClone(item));
    }
    await app.flushStates();
  }
  const stop = async ({ keepServer = false } = {}) => {
    await app.stop();
    await gladys.disconnect?.();
    if (!keepServer) {
      await server.close();
    }
  };
  return { gladys, fake: gladys.fake, app, server, logs, storage, stop };
}

export const ok = (ack) => {
  if (!ack.success) {
    throw new Error(`ack failed: ${ack.error}`);
  }
  return ack.data;
};

export const deviceOf = (fake, externalId) =>
  structuredClone(fake.discoveredDevices.find((item) => item.external_id === externalId));

export const featureOf = (item, key) =>
  item.features.find((feature) => feature.external_id.endsWith(`:${key}`));

export const setValue = (fake, externalId, key, value) => {
  const item = deviceOf(fake, externalId);
  return fake.setValue(item, featureOf(item, key), value);
};

export const settle = async (app, ms = 80) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await app.flushStates();
};

export const lastTransport = (fake, externalId) =>
  fake.transports.filter((entry) => entry.device_external_id === externalId).at(-1);
