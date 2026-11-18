// -----------------------------------------------------------------------------
// Integration configuration: the `config_schema` values of the manifest,
// normalized so the rest of the code never deals with strings from a form or
// `undefined`.
//
// `GLADYS_PREFER_LOCAL` is not in the schema: both transports are declared,
// so Gladys shows its standard "Prefer the local connection" toggle and sends
// the choice under this reserved key (true by default).
// -----------------------------------------------------------------------------

import { REGIONS, PIN_PATTERN } from './overkiz/clients.js';
import { parseHost } from './overkiz/discovery.js';

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
export const REGION_KEYS = Object.keys(REGIONS);

// Defaults: they MUST stay consistent with the `default` values of the
// manifest `config_schema` (test/manifest.test.js checks it).
export const DEFAULTS = {
  region: 'europe',
  username: '',
  local_host: '',
  gateway_pin: '',
  language: 'en',
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @description Normalize the raw configuration.
 * @param {object} raw - `gladys.config` or the `onConfigUpdated` payload.
 * @returns {object} `{ region, username, password, localHost ({ host, port }
 *   or null), localToken,
 *   pin, language, preferLocal, cloudConfigured }`.
 */
export function normalizeConfig(raw = {}) {
  const username = text(raw.username);
  const password = typeof raw.password === 'string' ? raw.password : '';
  const pin = text(raw.gateway_pin);
  return {
    region: REGION_KEYS.includes(raw.region) ? raw.region : DEFAULTS.region,
    username,
    password,
    localHost: parseHost(raw.local_host),
    localToken: text(raw.local_token),
    pin: PIN_PATTERN.test(pin) ? pin : null,
    language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULTS.language,
    preferLocal: raw.GLADYS_PREFER_LOCAL !== false && raw.GLADYS_PREFER_LOCAL !== 'false',
    cloudConfigured: Boolean(username && password),
  };
}

/**
 * @description What changed between two configurations, for the reconnection.
 * @param {object} before - normalizeConfig() result.
 * @param {object} after - normalizeConfig() result.
 * @returns {{ cloud: boolean, local: boolean, preference: boolean, language: boolean }} Changes.
 */
export function diffConfig(before, after) {
  return {
    cloud:
      before.username !== after.username ||
      before.password !== after.password ||
      before.region !== after.region,
    local:
      JSON.stringify(before.localHost) !== JSON.stringify(after.localHost) ||
      before.localToken !== after.localToken ||
      before.pin !== after.pin,
    preference: before.preferLocal !== after.preferLocal,
    language: before.language !== after.language,
  };
}
