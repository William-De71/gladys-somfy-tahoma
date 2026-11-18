// A fake Somfy cloud and a fake TaHoma box, on 127.0.0.1 only.
//
// Their answers copy the real ones recorded by pyoverkiz (MIT,
// tests/fixtures: setups, action groups, error bodies) and the OpenAPI of
// the Developer Mode (github.com/Somfy-Developer/Somfy-TaHoma-Developer-Mode):
//   - token: `POST /token` (form), password and refresh_token grants; a wrong
//     password answers `{"message":"error.invalid.grant"}`;
//   - cloud API under /enduser-mobile-web/enduserAPI/, Bearer of the token;
//     an unknown token: 401 RESOURCE_ACCESS_DENIED "Not authenticated";
//   - box: HTTPS with a certificate of the test authority (CN
//     gateway-<pin>.local), API under /enduser-mobile-web/1/enduserAPI/,
//     Bearer of the local token; a wrong one: 401 "Not authenticated.";
//   - listener: `events/register` -> { id }, `events/<id>/fetch` -> the queued
//     events; an unknown id: 400 UNSPECIFIED_ERROR "No registered event
//     listener.";
//   - `exec/apply` -> { execId }; `exec/<oid>` (cloud) -> { execId }.

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const tlsFile = (name) => readFileSync(new URL(`../fixtures/tls/${name}`, import.meta.url), 'utf8');

export const PIN = '1234-5678-9012';
export const USERNAME = 'user@example.com';
export const PASSWORD = 'secret-password';
export const LOCAL_TOKEN = 'local-token-0123456789';
export const TEST_CA = tlsFile('ca.pem');

const send = (res, status, body) => {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(text);
};

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

/**
 * @description The shared Overkiz state of one installation, and the API
 * routes of a server (cloud or box).
 * @param {object} installation - Shared state.
 * @param {'cloud'|'local'} kind - Which server.
 * @returns {Function} Route handler `(req, res, path, body, token)`.
 */
function enduserRoutes(installation, kind) {
  return (req, res, path, body) => {
    const { method } = req;
    installation.calls.push({ kind, method, path, body });
    if (installation.down[kind]) {
      res.destroy();
      return;
    }
    if (installation.failNext[kind]) {
      const failure = installation.failNext[kind];
      installation.failNext[kind] = null;
      send(res, failure.status, failure.body);
      return;
    }
    if (method === 'GET' && path === 'setup') {
      send(res, 200, installation.setup);
      return;
    }
    if (method === 'GET' && path === 'apiVersion' && kind === 'local') {
      send(res, 200, { protocolVersion: '2026.4.4-3' });
      return;
    }
    if (method === 'POST' && path === 'events/register') {
      const id = randomUUID();
      installation.listeners.set(id, { kind, queue: [] });
      send(res, 200, { id });
      return;
    }
    let match = /^events\/([^/]+)\/fetch$/.exec(path);
    if (method === 'POST' && match) {
      const listener = installation.listeners.get(decodeURIComponent(match[1]));
      if (!listener || listener.kind !== kind) {
        send(res, 400, {
          error: '"No registered event listener."',
          errorCode: 'UNSPECIFIED_ERROR',
        });
        return;
      }
      const events = listener.queue.splice(0);
      send(res, 200, events);
      return;
    }
    match = /^events\/([^/]+)\/unregister$/.exec(path);
    if (method === 'POST' && match) {
      installation.listeners.delete(decodeURIComponent(match[1]));
      send(res, 200, []);
      return;
    }
    if (method === 'POST' && path === 'exec/apply') {
      const payload = JSON.parse(body || '{}');
      if (!Array.isArray(payload.actions) || payload.actions.length === 0) {
        send(res, 400, {
          error: 'Malformed "Malformed action group". (missing parameter)',
          errorCode: 'MISSING_PARAMETERS',
        });
        return;
      }
      for (const action of payload.actions) {
        if (!installation.setup.devices.some((device) => device.deviceURL === action.deviceURL)) {
          send(res, 400, {
            error: `No such device : "${action.deviceURL}"`,
            errorCode: 'NO_SUCH_DEVICE',
          });
          return;
        }
      }
      const execId = randomUUID();
      installation.executions.push({ kind, execId, ...payload });
      send(res, 200, { execId });
      return;
    }
    if (kind === 'cloud') {
      if (method === 'GET' && path === 'actionGroups') {
        send(res, 200, installation.actionGroups);
        return;
      }
      match = /^exec\/([0-9a-f-]{36})$/.exec(path);
      if (method === 'POST' && match) {
        const group = installation.actionGroups.find((item) => item.oid === match[1]);
        if (!group) {
          send(res, 400, { error: 'No such action group', errorCode: 'NO_SUCH_ACTION_GROUP' });
          return;
        }
        const execId = randomUUID();
        installation.executions.push({ kind, execId, scenario: group.oid });
        send(res, 200, { execId });
        return;
      }
      if (method === 'POST' && path === 'setup/devices/states/refresh') {
        send(res, 204);
        return;
      }
      match = /^setup\/gateways\/([^/]+)\/developerMode$/.exec(path);
      if (match) {
        if (method === 'GET') {
          send(res, 200, { active: installation.developerMode });
        } else {
          installation.developerMode = true;
          send(res, 200, {});
        }
        return;
      }
      match = /^config\/([^/]+)\/local\/tokens\/generate$/.exec(path);
      if (method === 'GET' && match) {
        send(res, 200, { token: 'generated-local-token-42' });
        return;
      }
      match = /^config\/([^/]+)\/local\/tokens$/.exec(path);
      if (method === 'POST' && match) {
        const payload = JSON.parse(body || '{}');
        installation.localTokens.push(payload);
        send(res, 200, { requestId: randomUUID() });
        return;
      }
    }
    send(res, 404, { error: 'No such resource', errorCode: 'INVALID_API_CALL' });
  };
}

/**
 * @description Start a fake cloud and a fake box sharing one installation.
 * @param {object} [options] - Options.
 * @param {string} [options.boxCert] - Certificate of the box (`box-<pin>` or `rogue`).
 * @returns {Promise<object>} `{ installation, cloudUrls, localPort, push, close }`.
 */
export async function startFakeOverkiz({ boxCert = `box-${PIN}` } = {}) {
  const installation = {
    setup: fixture('setup.json'),
    actionGroups: fixture('action-groups.json'),
    listeners: new Map(),
    executions: [],
    calls: [],
    tokens: new Map(), // access token -> true
    refreshTokens: new Set(),
    localTokens: [],
    acceptedLocalTokens: new Set([LOCAL_TOKEN, 'generated-local-token-42']),
    developerMode: false,
    logins: 0,
    down: { cloud: false, local: false },
    failNext: { cloud: null, local: null },
    tokenLifetime: 3600,
  };

  const cloud = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const body = await readBody(req);
    if (url.pathname === '/token' && req.method === 'POST') {
      if (installation.down.cloud) {
        res.destroy();
        return;
      }
      const form = new URLSearchParams(body);
      const issue = () => {
        const access = randomUUID();
        const refresh = randomUUID();
        installation.tokens.set(access, true);
        installation.refreshTokens.add(refresh);
        send(res, 200, {
          access_token: access,
          refresh_token: refresh,
          expires_in: installation.tokenLifetime,
          token_type: 'bearer',
        });
      };
      if (form.get('grant_type') === 'password') {
        installation.logins += 1;
        if (form.get('username') === USERNAME && form.get('password') === PASSWORD) {
          issue();
        } else {
          send(res, 400, { message: 'error.invalid.grant' });
        }
        return;
      }
      if (form.get('grant_type') === 'refresh_token') {
        if (installation.refreshTokens.delete(form.get('refresh_token'))) {
          issue();
        } else {
          send(res, 400, { message: 'error.invalid.grant' });
        }
        return;
      }
      send(res, 400, { message: 'error.invalid.grant' });
      return;
    }
    const prefix = '/enduser-mobile-web/enduserAPI/';
    if (url.pathname.startsWith(prefix)) {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (!installation.down.cloud && !installation.tokens.has(token)) {
        send(res, 401, { errorCode: 'RESOURCE_ACCESS_DENIED', error: 'Not authenticated' });
        return;
      }
      cloudRoutes(req, res, url.pathname.slice(prefix.length), body);
      return;
    }
    send(res, 404, {});
  });
  const cloudRoutes = enduserRoutes(installation, 'cloud');

  const box = https.createServer(
    { key: tlsFile(`${boxCert}.key`), cert: tlsFile(`${boxCert}.pem`) },
    async (req, res) => {
      const url = new URL(req.url, 'https://127.0.0.1');
      const body = await readBody(req);
      const prefix = '/enduser-mobile-web/1/enduserAPI/';
      if (!url.pathname.startsWith(prefix)) {
        send(res, 404, {});
        return;
      }
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (!installation.down.local && !installation.acceptedLocalTokens.has(token)) {
        send(res, 401, { error: 'Not authenticated.', errorCode: 'RESOURCE_ACCESS_DENIED' });
        return;
      }
      localRoutes(req, res, url.pathname.slice(prefix.length), body);
    },
  );
  const localRoutes = enduserRoutes(installation, 'local');

  await Promise.all([
    new Promise((resolve) => cloud.listen(0, '127.0.0.1', resolve)),
    new Promise((resolve) => box.listen(0, '127.0.0.1', resolve)),
  ]);
  const cloudPort = cloud.address().port;

  return {
    installation,
    cloudUrls: {
      token: `http://127.0.0.1:${cloudPort}/token`,
      api: `http://127.0.0.1:${cloudPort}/enduser-mobile-web/enduserAPI/`,
    },
    localPort: box.address().port,
    /** Queue an event for every listener (of one kind, or both). */
    push(event, kind = null) {
      for (const listener of installation.listeners.values()) {
        if (!kind || listener.kind === kind) {
          listener.queue.push(structuredClone(event));
        }
      }
    },
    async close() {
      cloud.closeAllConnections?.();
      box.closeAllConnections?.();
      await Promise.all([
        new Promise((resolve) => cloud.close(resolve)),
        new Promise((resolve) => box.close(resolve)),
      ]);
    },
  };
}
