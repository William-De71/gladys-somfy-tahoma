// -----------------------------------------------------------------------------
// HTTP(S) requests to Somfy and to the box, and the errors they end in.
//
// node:https rather than fetch: the local API needs a per-request trust store
// (the Overkiz root CA) and a server name check, which fetch cannot take
// without an extra dependency.
//
// Overkiz answers its errors in JSON `{ errorCode, error }`; the mapping below
// follows the one of pyoverkiz (MIT, iMicknl/python-overkiz-api,
// response_handler.py): the error code first, then a piece of the message.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

export const ERROR_KINDS = {
  CREDENTIALS: 'credentials', // wrong password or token: retrying is useless
  SESSION: 'session', // token expired or dropped: log in again
  RATE: 'rate', // too many requests, executions, a ban: wait
  LISTENER: 'listener', // event listener expired: register again
  MAINTENANCE: 'maintenance', // Somfy servers in maintenance (503)
  NETWORK: 'network', // no answer, refused, timeout
  TLS: 'tls', // the certificate is not one of the Overkiz authority
  REFUSED: 'refused', // any other refusal (unknown device, bad command)
  SERVER: 'server', // 5xx
};

export class OverkizError extends Error {
  /**
   * @param {string} kind - One of ERROR_KINDS.
   * @param {string} message - Message (never a secret).
   * @param {object} [details] - `{ status, code }`.
   */
  constructor(kind, message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'OverkizError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const BY_CODE_AND_MESSAGE = [
  ['AUTHENTICATION_ERROR', 'too many requests', ERROR_KINDS.RATE],
  ['AUTHENTICATION_ERROR', 'bad credentials', ERROR_KINDS.CREDENTIALS],
  ['AUTHENTICATION_ERROR', 'no such user', ERROR_KINDS.CREDENTIALS],
  ['RESOURCE_ACCESS_DENIED', 'not authenticated', ERROR_KINDS.SESSION],
  ['RESOURCE_ACCESS_DENIED', 'missing authorization token', ERROR_KINDS.SESSION],
  ['RESOURCE_ACCESS_DENIED', 'too many concurrent requests', ERROR_KINDS.RATE],
  ['RESOURCE_ACCESS_DENIED', 'too many executions', ERROR_KINDS.RATE],
  ['UNSPECIFIED_ERROR', 'invalid event listener id', ERROR_KINDS.LISTENER],
  ['UNSPECIFIED_ERROR', 'no registered event listener', ERROR_KINDS.LISTENER],
];

const BY_CODE = {
  QUOTA_EXCEEDED: ERROR_KINDS.RATE,
  EXEC_QUEUE_FULL: ERROR_KINDS.RATE,
  AUTHENTICATION_ERROR: ERROR_KINDS.CREDENTIALS,
};

const BY_MESSAGE = [
  ['too many attempts with an invalid token', ERROR_KINDS.RATE],
  ['invalid token', ERROR_KINDS.CREDENTIALS],
  ['too many executions', ERROR_KINDS.RATE],
  ['too many requests', ERROR_KINDS.RATE],
  ['bad credentials', ERROR_KINDS.CREDENTIALS],
  ['not authenticated', ERROR_KINDS.SESSION],
  ['invalid event listener id', ERROR_KINDS.LISTENER],
  ['no registered event listener', ERROR_KINDS.LISTENER],
];

/**
 * @description The error of an Overkiz answer that is not a success.
 * @param {number} status - HTTP status.
 * @param {*} body - Parsed body (object, text or null).
 * @returns {OverkizError} The error.
 */
export function errorOf(status, body) {
  const code = typeof body?.errorCode === 'string' ? body.errorCode : null;
  const raw =
    typeof body?.error === 'string'
      ? body.error
      : typeof body === 'string'
        ? body.replace(/<[^>]*>/g, ' ').trim()
        : '';
  const message = raw.replace(/\s+/g, ' ').slice(0, 200) || `HTTP ${status}`;
  const lower = message.toLowerCase();
  let kind;
  if (code) {
    kind = BY_CODE_AND_MESSAGE.find(([c, part]) => c === code && lower.includes(part))?.[2];
    kind ??= BY_MESSAGE.find(([part]) => lower.includes(part))?.[1];
    kind ??= BY_CODE[code];
  } else {
    kind = BY_MESSAGE.find(([part]) => lower.includes(part))?.[1];
  }
  if (!kind) {
    if (status === 503) {
      kind = ERROR_KINDS.MAINTENANCE;
    } else if (status === 429) {
      kind = ERROR_KINDS.RATE;
    } else if (status === 401) {
      kind = ERROR_KINDS.SESSION;
    } else if (status >= 500) {
      kind = ERROR_KINDS.SERVER;
    } else {
      kind = ERROR_KINDS.REFUSED;
    }
  }
  return new OverkizError(kind, message, { status, code });
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_SIGNATURE_FAILURE',
]);

/**
 * @description One HTTP request; resolves with the parsed body of a 2xx,
 * rejects with an OverkizError otherwise.
 * @param {string} url - Absolute URL (http: only in the tests).
 * @param {object} [options] - Request options.
 * @param {string} [options.method] - HTTP method.
 * @param {object} [options.headers] - Headers.
 * @param {object|string} [options.json] - JSON body.
 * @param {object} [options.form] - x-www-form-urlencoded body.
 * @param {object} [options.tls] - `{ ca, servername, checkServerIdentity }`.
 * @param {number} [options.timeoutMs] - Whole request timeout.
 * @returns {Promise<*>} Parsed JSON body, text, or null when empty.
 */
export function request(
  url,
  { method = 'GET', headers = {}, json, form, tls, timeoutMs = 15000 } = {},
) {
  const target = new URL(url);
  const client = target.protocol === 'http:' ? http : https;
  let body = null;
  const allHeaders = { Accept: 'application/json', ...headers };
  if (json !== undefined) {
    body = JSON.stringify(json);
    allHeaders['Content-Type'] = 'application/json';
  } else if (form) {
    body = new URLSearchParams(form).toString();
    allHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (body !== null) {
    allHeaders['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      {
        method,
        headers: allHeaders,
        ...(tls && target.protocol === 'https:' ? tls : {}),
        // No connection reuse: the box closes idle sockets on its side.
        agent: false,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          // A setup with a few hundred devices weighs a few MB at most.
          if (size > 32 * 1024 * 1024) {
            req.destroy(new Error('answer too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          if (raw.trim()) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = raw;
            }
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(errorOf(res.statusCode, parsed));
          }
        });
        res.on('error', (error) => reject(new OverkizError(ERROR_KINDS.NETWORK, error.message)));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    req.on('error', (error) => {
      const kind =
        TLS_CODES.has(error.code) || error.reason ? ERROR_KINDS.TLS : ERROR_KINDS.NETWORK;
      reject(new OverkizError(kind, error.message));
    });
    if (body !== null) {
      req.write(body);
    }
    req.end();
  });
}
