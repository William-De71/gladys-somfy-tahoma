// -----------------------------------------------------------------------------
// The two ways to reach a TaHoma box: the Somfy cloud and the local API of the
// Developer Mode. Both speak the same Overkiz "enduser" API (setup, event
// listener, executions); each adds what only it can do.
//
// Cloud (TaHoma app account)
//   1. `POST https://accounts.somfy.com/oauth/oauth/v2/token/jwt`, password
//      grant with the client id and secret of the TaHoma app (public by
//      design: they ship in the app; values from pyoverkiz, MIT);
//   2. every call: `Authorization: Bearer <access token>` on
//      `https://ha<region>-1.overkiz.com/enduser-mobile-web/enduserAPI/`;
//   3. the refresh token renews the access token; a full login happens only
//      at start or when the refresh is refused (Somfy bans accounts that log
//      in too often).
//   The tokens stay in memory: never written, never logged.
//
// Local (Developer Mode, github.com/Somfy-Developer/Somfy-TaHoma-Developer-Mode)
//   `https://<box address>:8443/enduser-mobile-web/1/enduserAPI/`, the token
//   of the Developer Mode as a Bearer, a certificate signed by the Overkiz
//   root CA (src/overkiz/overkiz-root-ca-2048.pem, from ca.overkiz.com).
//   The box is reached by IP (no mDNS resolver in the container): the chain
//   is checked against that CA only, and the certificate name, when it
//   carries a PIN (`gateway-1234-5678-9012`), must be the PIN of the box.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { ERROR_KINDS, OverkizError, request as httpRequest } from './http.js';

export const REGIONS = {
  europe: 'https://ha101-1.overkiz.com/enduser-mobile-web/enduserAPI/',
  north_america: 'https://ha401-1.overkiz.com/enduser-mobile-web/enduserAPI/',
  oceania: 'https://ha201-1.overkiz.com/enduser-mobile-web/enduserAPI/',
};

export const SOMFY_TOKEN_URL = 'https://accounts.somfy.com/oauth/oauth/v2/token/jwt';
const SOMFY_CLIENT_ID =
  '0d8e920c-1478-11e7-a377-02dd59bd3041_1ewvaqmclfogo4kcsoo0c8k4kso884owg08sg8c40sk4go4ksg';
const SOMFY_CLIENT_SECRET = '12k73w1n540g8o4cokg0cw84cog840k84cwggscwg884004kgk';

export const LOCAL_PORT = 8443;
export const LOCAL_PATH = '/enduser-mobile-web/1/enduserAPI/';
export const OVERKIZ_CA = readFileSync(
  new URL('./overkiz-root-ca-2048.pem', import.meta.url),
  'utf8',
);

const USER_AGENT = 'gladys-somfy-tahoma';
const EXPIRY_MARGIN_MS = 60 * 1000;
export const PIN_PATTERN = /^\d{4}-\d{4}-\d{4}$/;

/** The calls both APIs share, on top of `call(method, path, json)`. */
const enduserApi = (call) => ({
  /** `{ gateways, devices, … }` of the whole installation. */
  getSetup: () => call('GET', 'setup'),
  /** @returns {Promise<string>} The id of a new event listener. */
  async registerListener() {
    const answer = await call('POST', 'events/register');
    if (!answer?.id) {
      throw new OverkizError(ERROR_KINDS.REFUSED, 'no listener id in the answer');
    }
    return answer.id;
  },
  /** @returns {Promise<object[]>} The events since the last fetch. */
  async fetchEvents(listenerId) {
    const events = await call('POST', `events/${encodeURIComponent(listenerId)}/fetch`);
    return Array.isArray(events) ? events : [];
  },
  unregisterListener: (listenerId) =>
    call('POST', `events/${encodeURIComponent(listenerId)}/unregister`),
  /**
   * @param {object[]} actions - `[{ deviceURL, commands: [{ name, parameters }] }]`.
   * @param {string} label - Shown in the history of the TaHoma app.
   * @returns {Promise<string>} The execution id.
   */
  async apply(actions, label) {
    const answer = await call('POST', 'exec/apply', { label, actions });
    return String(answer?.execId ?? '');
  },
});

/**
 * @description Client of the Somfy cloud.
 * @param {object} options - Options.
 * @param {string} options.username - TaHoma account e-mail.
 * @param {string} options.password - Its password.
 * @param {string} [options.region] - Key of REGIONS.
 * @param {object} [options.urls] - `{ token, api }` (tests).
 * @param {Function} [options.now] - Clock (ms).
 * @param {Function} [options.request] - src/overkiz/http.js request (tests).
 * @returns {object} The client.
 */
export function createCloudClient({
  username,
  password,
  region = 'europe',
  urls = {},
  now = Date.now,
  request = httpRequest,
}) {
  const tokenUrl = urls.token ?? SOMFY_TOKEN_URL;
  const api = urls.api ?? REGIONS[region] ?? REGIONS.europe;
  const session = { access: null, refresh: null, expiresAt: 0 };
  let renewing = null;

  const grant = async (form) => {
    let answer;
    try {
      answer = await request(tokenUrl, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT },
        form: { client_id: SOMFY_CLIENT_ID, client_secret: SOMFY_CLIENT_SECRET, ...form },
      });
    } catch (error) {
      // Somfy answers a wrong password in 400/401 with `error.invalid.grant`.
      const text = `${error.message}`.toLowerCase();
      if (error.kind === ERROR_KINDS.REFUSED || text.includes('invalid')) {
        throw new OverkizError(ERROR_KINDS.CREDENTIALS, 'Somfy refused the e-mail or password', {
          status: error.status,
        });
      }
      throw error;
    }
    if (answer?.message === 'error.invalid.grant' || answer?.error === 'invalid_grant') {
      throw new OverkizError(ERROR_KINDS.CREDENTIALS, 'Somfy refused the e-mail or password');
    }
    if (!answer?.access_token) {
      throw new OverkizError(ERROR_KINDS.SERVER, 'Somfy gave no access token');
    }
    session.access = answer.access_token;
    session.refresh = answer.refresh_token ?? session.refresh;
    const lifetime = Number(answer.expires_in);
    session.expiresAt = now() + (Number.isFinite(lifetime) ? lifetime * 1000 : 3600 * 1000);
  };

  const login = () => grant({ grant_type: 'password', username, password });

  const ensureToken = () => {
    if (session.access && now() < session.expiresAt - EXPIRY_MARGIN_MS) {
      return null;
    }
    renewing ??= (async () => {
      if (session.refresh) {
        try {
          await grant({ grant_type: 'refresh_token', refresh_token: session.refresh });
          return;
        } catch (error) {
          if (error.kind !== ERROR_KINDS.CREDENTIALS) {
            throw error;
          }
          session.refresh = null;
        }
      }
      await login();
    })().finally(() => {
      renewing = null;
    });
    return renewing;
  };

  const call = async (method, path, json, retried = false) => {
    await ensureToken();
    try {
      return await request(`${api}${path}`, {
        method,
        json,
        headers: { Authorization: `Bearer ${session.access}`, 'User-Agent': USER_AGENT },
      });
    } catch (error) {
      if (error.kind === ERROR_KINDS.SESSION && !retried) {
        session.access = null;
        return call(method, path, json, true);
      }
      throw error;
    }
  };

  return {
    transport: 'cloud',
    ...enduserApi(call),
    /** Log in now (configuration check). */
    async login() {
      session.access = null;
      session.refresh = null;
      await login();
    },
    /** The TaHoma scenarios: `[{ oid, label, actions }]`. */
    async getScenarios() {
      const groups = await call('GET', 'actionGroups');
      return Array.isArray(groups) ? groups : [];
    },
    /** @returns {Promise<string>} The execution id of the scenario. */
    async runScenario(oid) {
      const answer = await call('POST', `exec/${encodeURIComponent(oid)}`);
      return String(answer?.execId ?? '');
    },
    /** Ask the box to read again the states of its devices (cloud only). */
    refreshStates: () => call('POST', 'setup/devices/states/refresh'),
    /** @returns {Promise<boolean>} Developer Mode on for the box. */
    async developerMode(pin) {
      const answer = await call('GET', `setup/gateways/${encodeURIComponent(pin)}/developerMode`);
      return answer?.active === true;
    },
    activateDeveloperMode: (pin) =>
      call('POST', `setup/gateways/${encodeURIComponent(pin)}/developerMode`),
    /**
     * @description Create and activate a token of the local API.
     * @param {string} pin - PIN of the box.
     * @param {string} label - Name of the token in the TaHoma app.
     * @returns {Promise<string>} The token.
     */
    async createLocalToken(pin, label) {
      const answer = await call('GET', `config/${encodeURIComponent(pin)}/local/tokens/generate`);
      const token = answer?.token;
      if (!token) {
        throw new OverkizError(ERROR_KINDS.REFUSED, 'Somfy gave no local token');
      }
      await call('POST', `config/${encodeURIComponent(pin)}/local/tokens`, {
        label,
        token,
        scope: 'devmode',
      });
      return token;
    },
    /** For the tests. */
    session,
  };
}

/**
 * @description The certificate check of the local API: the chain is checked
 * by Node against the Overkiz CA; this only refuses a certificate naming
 * another box.
 * @param {string|null} pin - Expected PIN, null when not known yet.
 * @returns {Function} `checkServerIdentity(host, cert)`.
 */
export function boxIdentityCheck(pin) {
  return (host, cert) => {
    const names = [
      cert?.subject?.CN,
      ...String(cert?.subjectaltname ?? '')
        .split(',')
        .map((name) => name.trim().replace(/^DNS:/, '')),
    ].filter(Boolean);
    const pins = names.map((name) => /(\d{4}-\d{4}-\d{4})/.exec(name)?.[1]).filter(Boolean);
    if (pin && pins.length > 0 && !pins.includes(pin)) {
      const error = new Error(`the certificate is the one of box ${pins[0]}, not ${pin}`);
      error.code = 'ERR_TLS_CERT_ALTNAME_INVALID';
      return error;
    }
    return undefined;
  };
}

/**
 * @description Client of the local API (Developer Mode).
 * @param {object} options - Options.
 * @param {string} options.host - IP address (or name) of the box.
 * @param {string} options.token - Token of the Developer Mode.
 * @param {string|null} [options.pin] - PIN of the box, when known.
 * @param {number} [options.port] - Port (8443).
 * @param {string} [options.ca] - Trusted CA (tests).
 * @param {string} [options.protocol] - `https` (`http` in some tests).
 * @param {Function} [options.request] - src/overkiz/http.js request (tests).
 * @returns {object} The client.
 */
export function createLocalClient({
  host,
  token,
  pin = null,
  port = LOCAL_PORT,
  ca = OVERKIZ_CA,
  protocol = 'https',
  request = httpRequest,
}) {
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const base = `${protocol}://${hostPart}:${port}${LOCAL_PATH}`;
  const tls = { ca, checkServerIdentity: boxIdentityCheck(pin) };
  const call = async (method, path, json) => {
    try {
      return await request(`${base}${path}`, {
        method,
        json,
        tls,
        timeoutMs: 10000,
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      // No session on the local API: "Not authenticated." means the token
      // itself is refused (revoked, from another box, Developer Mode off).
      if (error.kind === ERROR_KINDS.SESSION) {
        throw new OverkizError(ERROR_KINDS.CREDENTIALS, error.message, {
          status: error.status,
          code: error.code,
        });
      }
      throw error;
    }
  };
  return {
    transport: 'local',
    host,
    ...enduserApi(call),
    /** @returns {Promise<string>} Version of the local API. */
    async apiVersion() {
      const answer = await call('GET', 'apiVersion');
      return String(answer?.protocolVersion ?? '');
    },
  };
}
