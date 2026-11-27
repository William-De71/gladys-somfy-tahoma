// The state publisher on its own: a fake SDK client and a fake clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createStatePublisher } from '../src/states.js';

const fakeGladys = () => {
  const sent = [];
  return {
    sent,
    publishChangedStates: async (states) => {
      sent.push(...states);
      return { count: states.length };
    },
    forgetPublishedStates: () => {},
  };
};

const silent = { warn: () => {}, info: () => {} };

test('throttled feature: the latest value at most once per interval, the others at once', async () => {
  const gladys = fakeGladys();
  let clock = 0;
  const publisher = createStatePublisher(gladys, {
    logger: silent,
    now: () => clock,
    throttled: (id) => (id.endsWith(':power') ? 30000 : 0),
  });
  try {
    const sent = () => gladys.sent.map((item) => [item.device_feature_external_id, item.state]);
    publisher.push('plug:power', 10);
    await publisher.flush();
    assert.deepEqual(sent(), [['plug:power', 10]]);
    // 10 s later: the power waits, the energy index goes through.
    clock = 10000;
    publisher.push('plug:power', 12);
    publisher.push('plug:power', 13);
    publisher.push('plug:energy', 4.2);
    await publisher.flush();
    assert.deepEqual(sent().slice(1), [['plug:energy', 4.2]]);
    assert.equal(publisher.pendingCount(), 1);
    // 30 s after the first one: the latest power value only.
    clock = 30000;
    await publisher.flush();
    assert.deepEqual(sent().slice(2), [['plug:power', 13]]);
    // A device just created (or updated) gets its values at once.
    clock = 31000;
    publisher.republish('plug');
    await publisher.flush();
    assert.deepEqual(sent().slice(3), [
      ['plug:power', 13],
      ['plug:energy', 4.2],
    ]);
  } finally {
    publisher.stop();
  }
});
