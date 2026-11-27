// -----------------------------------------------------------------------------
// State publication, within the limits of the Gladys host API.
//
// Gladys accepts 300 states a minute per integration (a refused batch still
// counts). A few shades pushing their changes stay far below it, but still:
//
//   - only the devices the user created are published (a state of a device
//     not created yet is accepted, then thrown away, and still counts);
//   - the states wait one second in a queue where a newer value of the same
//     feature replaces the older one;
//   - `publishChangedStates` of the SDK drops the unchanged values (with an
//     hourly heartbeat, so a steady sensor still shows it is alive);
//   - a token bucket keeps the integration under 240 states a minute, and a
//     refused batch (429) pauses the queue for 30 s;
//   - a few features (the power of a plug) change at every small variation:
//     they are published at most once per `throttled` interval, the latest
//     value waiting in the queue. Gladys flags a feature storing 8 640 states
//     a day (one every 10 s) as "very chatty"; 30 s stays well below.
//
// A value is a number (a `{ text }` object is published as a text state).
// The last value of every feature is kept, published or not: a device the
// user just created gets them at once (republish).
// -----------------------------------------------------------------------------

const FLUSH_MS = 1000;
const PER_MINUTE = 240;
const BURST = 100;
const PAUSE_MS = 30 * 1000;
const HEARTBEAT_MS = 60 * 60 * 1000;

/**
 * @description Create the state publisher.
 * @param {object} gladys - SDK client.
 * @param {object} deps - Dependencies.
 * @param {object} deps.logger - Logger.
 * @param {Function} [deps.now] - Clock (ms).
 * @param {Function} [deps.isCreated] - `(deviceExternalId) => boolean`.
 * @param {Function} [deps.throttled] - `(featureExternalId) => ms`: the
 *   shortest interval between two publications of the feature (0: none).
 * @returns {object} The publisher.
 */
export function createStatePublisher(
  gladys,
  { logger, now = Date.now, isCreated, throttled = () => 0 },
) {
  const pending = new Map();
  const last = new Map();
  const sentAt = new Map(); // throttled feature external id -> last publication
  let tokens = BURST;
  let refilledAt = now();
  let pausedUntil = 0;
  let timer = null;
  let flushing = null;

  const deviceOf = (featureId) => featureId.slice(0, featureId.lastIndexOf(':'));

  const refill = () => {
    const current = now();
    tokens = Math.min(BURST, tokens + ((current - refilledAt) / 60000) * PER_MINUTE);
    refilledAt = current;
  };

  const ready = (featureId) => {
    const interval = throttled(featureId);
    return !(interval > 0 && sentAt.has(featureId) && now() - sentAt.get(featureId) < interval);
  };

  const schedule = () => {
    if (!timer && pending.size > 0) {
      timer = setTimeout(() => {
        timer = null;
        publisher.flush().catch(() => {});
      }, FLUSH_MS);
      timer.unref?.();
    }
  };

  const publisher = {
    /**
     * @description Queue a feature value.
     * @param {string} featureId - Feature external id.
     * @param {number|{text: string}} value - Gladys value.
     */
    push(featureId, value) {
      last.set(featureId, value);
      if (isCreated && !isCreated(deviceOf(featureId))) {
        return;
      }
      pending.set(featureId, value);
      schedule();
    },

    /** @returns {Map<string, number|object>} Last value of every feature. */
    lastValues: () => last,

    /**
     * @description Publish now what the rate limit allows.
     * @returns {Promise<number>} Number of states Gladys received.
     */
    async flush() {
      if (flushing) {
        return flushing;
      }
      flushing = (async () => {
        refill();
        if (pending.size === 0 || now() < pausedUntil || tokens < 1) {
          return 0;
        }
        // A throttled feature published too recently waits in the queue
        // (a newer value still replaces it).
        const size = Math.min(BURST, Math.floor(tokens));
        const batch = [...pending.entries()]
          .filter(([featureId]) => ready(featureId))
          .slice(0, size);
        if (batch.length === 0) {
          return 0;
        }
        batch.forEach(([featureId]) => pending.delete(featureId));
        batch.forEach(([featureId]) => {
          if (throttled(featureId) > 0) {
            sentAt.set(featureId, now());
          }
        });
        try {
          const result = await gladys.publishChangedStates(
            batch.map(([featureId, value]) =>
              typeof value === 'object'
                ? { device_feature_external_id: featureId, text: value.text }
                : { device_feature_external_id: featureId, state: value },
            ),
            { heartbeat: HEARTBEAT_MS },
          );
          tokens -= result?.count ?? batch.length;
          return result?.count ?? 0;
        } catch (error) {
          // Put back what was not superseded meanwhile.
          batch.forEach(([featureId, state]) => {
            if (!pending.has(featureId)) {
              pending.set(featureId, state);
            }
          });
          tokens -= batch.length;
          if (error?.status === 429) {
            pausedUntil = now() + PAUSE_MS;
            logger.warn('TaHoma: Gladys refused states (300 a minute at most), pausing 30 s');
          } else {
            logger.warn(`TaHoma: publishing states failed: ${error.message}`);
          }
          return 0;
        }
      })();
      try {
        return await flushing;
      } finally {
        flushing = null;
        schedule();
      }
    },

    /**
     * @description Forget what was published for a device or a feature (a
     * device created or updated in Gladys, a command sent without feedback),
     * so the next value is published even if unchanged.
     * @param {string} externalId - Device or feature external id.
     */
    forget(externalId) {
      gladys.forgetPublishedStates(externalId);
    },

    /**
     * @description Publish again the known values of a device (just created).
     * @param {string} deviceExternalId - Device external id.
     */
    republish(deviceExternalId) {
      gladys.forgetPublishedStates(deviceExternalId);
      for (const [featureId, value] of last) {
        if (deviceOf(featureId) === deviceExternalId) {
          sentAt.delete(featureId);
          pending.set(featureId, value);
        }
      }
      schedule();
    },

    stop() {
      clearTimeout(timer);
      timer = null;
    },

    /** For the tests. */
    pendingCount: () => pending.size,
  };
  return publisher;
}
