// -----------------------------------------------------------------------------
// Finding the box on the local network.
//
// With the Developer Mode on, a TaHoma box announces the mDNS service
// `_kizboxdev._tcp` with the TXT records `gateway_pin`, `api_version`,
// `fw_version`. Somfy warns that the host and service names do not identify
// a box: only `gateway_pin` does.
//
// The container cannot hear mDNS: the scan goes through Gladys
// (`scanNetwork('mdns')`, manifest `network_discovery`).
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { PIN_PATTERN } from './clients.js';

export const MDNS_SERVICE = '_kizboxdev._tcp';

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** The text is an IPv4 address. */
export const isIpv4 = (value) => IPV4.test(String(value ?? '').trim());

/**
 * @description A typed box address: an IPv4 address or a host name, with an
 * optional port (8443 by default), without scheme nor path.
 * @param {string} value - What the user typed.
 * @returns {{ host: string, port: number }|null} The address, null when not usable.
 */
export function parseHost(value) {
  const typed = String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  const match = /^([a-z0-9.-]{1,253})(?::(\d{1,5}))?$/i.exec(typed);
  if (!match) {
    return null;
  }
  const port = match[2] ? Number(match[2]) : 8443;
  return port >= 1 && port <= 65535 ? { host: match[1], port } : null;
}

/**
 * @description Scan for the boxes with the Developer Mode on.
 * @param {object} gladys - SDK client.
 * @param {object} [options] - Options.
 * @param {object} [options.logger] - Logger.
 * @returns {Promise<{ boxes: object[], error: string|null }>} `boxes`:
 *   `[{ pin, host, port, firmware }]`; `error`: 'forbidden' when Gladys
 *   refuses the scan, 'failed' for another failure.
 */
export async function scanBoxes(gladys, { logger } = {}) {
  let results;
  try {
    results = await gladys.scanNetwork('mdns', { timeoutSeconds: 5 });
  } catch (error) {
    logger?.info?.(`TaHoma: mDNS scan unavailable (${error?.message ?? error})`);
    return { boxes: [], error: error?.status === 403 ? 'forbidden' : 'failed' };
  }
  const boxes = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const txt = parseMdnsTxt(result?.txt ?? []);
    const pin = String(txt.gateway_pin ?? '').trim();
    const host = (result?.addresses ?? []).find(isIpv4);
    if (!PIN_PATTERN.test(pin) || !host || boxes.has(pin)) {
      continue;
    }
    boxes.set(pin, {
      pin,
      host,
      port: Number(result.port) || 8443,
      firmware: String(txt.fw_version ?? ''),
    });
  }
  return { boxes: [...boxes.values()], error: null };
}
