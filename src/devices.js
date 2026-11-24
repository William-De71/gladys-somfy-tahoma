// -----------------------------------------------------------------------------
// From a TaHoma device to a Gladys device, its values, and back to commands.
//
//   roller shutter, blind, screen, window, pergola, awning, garage door, gate
//                        -> shutter: state (open / stop / close), position
//                           when the motor reports one, slats when it has some
//   curtain              -> curtain: state, position
//   one-button opener    -> shutter: state only ("cycle")
//   light                -> light: on / off, intensity when dimmable
//   plug, relay, pool    -> switch: on / off
//   any device           -> its sensors: temperature, light, humidity,
//                           opening, motion, smoke, water, battery, low
//                           battery, CO2, power, energy index
//
// External ids: `gladys.externalIds('device', <deviceURL as letters, digits
// and dashes>)`, the same through the cloud and the local API (the deviceURL
// holds the PIN of the box). Feature keys are part of the external ids:
// permanent.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import {
  coverOf,
  coverStateOf,
  hasCommand,
  hasState,
  isMoving,
  isShown,
  isSwitch,
  lightOf,
  opennessOf,
  platformIdOf,
  STATES,
} from './overkiz/model.js';
import { text } from './i18n.js';

export const DEVICE_TYPE = 'device';

export const FEATURE_KEYS = {
  STATE: 'state',
  POSITION: 'position',
  TILT: 'tilt',
  LIGHT: 'light',
  BRIGHTNESS: 'brightness',
  SWITCH: 'switch',
};

export const COVER = { OPEN: 1, STOP: 0, CLOSE: -1 };

// Batteries: a few devices report a gauge (`core:BatteryLevelState`), most
// only a word. Solar Velux covers report `core:BatteryDiscreteLevelState`
// (good / medium / low / critical) and nothing else; sirens and other IO
// sensors `core:BatteryState` (full / normal / medium / low / verylow).
// Home Assistant shows the word, gladys-overkiz turns it into a low battery
// flag: nobody publishes a percentage for it. The Somfy app shows 100 % for
// "good" (home-assistant/core#141169), the other steps are our estimate, so
// that the battery widget and the Gladys low battery alert work for these
// devices too; `battery_low` carries the word itself.
const BATTERY_PERCENT = {
  full: 100,
  good: 100,
  normal: 75,
  medium: 50,
  low: 15,
  verylow: 5,
  critical: 5,
};
const BATTERY_LOW_WORDS = new Set(['low', 'verylow', 'critical']);

const batteryPercent = (raw) => {
  if (Number.isFinite(raw)) {
    return Math.min(100, Math.max(0, Math.round(raw)));
  }
  return typeof raw === 'string' ? (BATTERY_PERCENT[raw] ?? null) : null;
};

// An unknown word publishes nothing: "battery fine" would be the worse guess.
const batteryLow = (raw) =>
  typeof raw === 'string' && raw in BATTERY_PERCENT ? (BATTERY_LOW_WORDS.has(raw) ? 1 : 0) : null;

const binary = (category, onValue) => ({
  category,
  type: TYPES.SENSOR.BINARY,
  min: 0,
  max: 1,
  value: (raw) => (typeof raw === 'string' ? (raw === onValue ? 1 : 0) : null),
});

/**
 * Sensors read on any device, by Overkiz state. `states` lists several
 * sources of the same value, the first one holding a value wins.
 */
export const SENSORS = [
  {
    key: 'temperature',
    state: STATES.TEMPERATURE,
    category: CATEGORIES.TEMPERATURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.CELSIUS,
    min: -50,
    max: 100,
    value: (raw) => (Number.isFinite(raw) ? Math.round(raw * 10) / 10 : null),
  },
  {
    key: 'luminance',
    state: STATES.LUMINANCE,
    category: CATEGORIES.LIGHT_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.LUX,
    min: 0,
    max: 200000,
    value: (raw) => (Number.isFinite(raw) ? Math.round(raw) : null),
  },
  {
    key: 'humidity',
    state: STATES.HUMIDITY,
    category: CATEGORIES.HUMIDITY_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
    value: (raw) => (Number.isFinite(raw) ? Math.round(raw * 10) / 10 : null),
  },
  // Gladys opening sensor: 1 closed, 0 open.
  { key: 'contact', state: STATES.CONTACT, ...binary(CATEGORIES.OPENING_SENSOR, 'closed') },
  { key: 'motion', state: STATES.OCCUPANCY, ...binary(CATEGORIES.MOTION_SENSOR, 'personInside') },
  { key: 'smoke', state: STATES.SMOKE, ...binary(CATEGORIES.SMOKE_SENSOR, 'detected') },
  { key: 'leak', state: STATES.WATER_DETECTION, ...binary(CATEGORIES.LEAK_SENSOR, 'detected') },
  {
    key: 'battery',
    states: [STATES.BATTERY_LEVEL, STATES.BATTERY_DISCRETE_LEVEL, STATES.BATTERY],
    category: CATEGORIES.BATTERY,
    type: TYPES.BATTERY.INTEGER,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
    value: batteryPercent,
  },
  {
    // Only for the devices that report a word: Gladys already alerts on a
    // gauge below its threshold.
    key: 'battery_low',
    states: [STATES.BATTERY_DISCRETE_LEVEL, STATES.BATTERY],
    category: CATEGORIES.BATTERY_LOW,
    type: TYPES.BATTERY_LOW.BINARY,
    min: 0,
    max: 1,
    value: batteryLow,
  },
  {
    key: 'co2',
    state: STATES.CO2,
    category: CATEGORIES.CO2_SENSOR,
    type: TYPES.SENSOR.INTEGER,
    unit: UNITS.PPM,
    min: 0,
    max: 10000,
    value: (raw) => (Number.isFinite(raw) ? Math.round(raw) : null),
  },
  {
    key: 'power',
    state: STATES.POWER,
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.POWER,
    unit: UNITS.WATT,
    min: 0,
    max: 100000,
    value: (raw) => (Number.isFinite(raw) ? raw : null),
  },
  {
    // Overkiz counts Wh; the Gladys energy index is in kWh.
    key: 'energy',
    state: STATES.ENERGY,
    category: CATEGORIES.ENERGY_SENSOR,
    type: TYPES.ENERGY_SENSOR.INDEX,
    unit: UNITS.KILOWATT_HOUR,
    min: 0,
    max: 100000000,
    value: (raw) => (Number.isFinite(raw) && raw >= 0 ? Math.round(raw) / 1000 : null),
  },
];

const sourcesOf = (sensor) => sensor.states ?? [sensor.state];

// Wired Velux covers declare `core:BatteryDiscreteLevelState` too but never
// fill it: like Home Assistant and Matterbridge, a battery word counts only
// when the box reports a value.
const REPORTED_ONLY = new Set([STATES.BATTERY_DISCRETE_LEVEL, STATES.BATTERY]);

const offers = (device, name) =>
  REPORTED_ONLY.has(name) ? device.states.has(name) : hasState(device, name);

const feature = (key, language, spec) => ({
  key,
  name: text(`feature_${key}`, language),
  keep_history: true,
  ...spec,
});

const coverFeatures = (cover, language) => {
  const category = cover.curtain ? CATEGORIES.CURTAIN : CATEGORIES.SHUTTER;
  const list = [
    feature(FEATURE_KEYS.STATE, language, {
      category,
      type: TYPES.SHUTTER.STATE,
      min: -1,
      max: 1,
      read_only: false,
      has_feedback: cover.feedback,
      keep_history: false,
    }),
  ];
  if (cover.position) {
    list.push(
      feature(FEATURE_KEYS.POSITION, language, {
        category,
        type: TYPES.SHUTTER.POSITION,
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: true,
      }),
    );
  }
  if (cover.tilt) {
    list.push(
      feature(FEATURE_KEYS.TILT, language, {
        category,
        type: TYPES.SHUTTER.POSITION,
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: true,
      }),
    );
  }
  return list;
};

/**
 * @description The features of a device, without their external ids.
 * @param {object} device - Normalized TaHoma device.
 * @param {string} language - Language of the names.
 * @returns {object[]} Feature specs (`key` + Gladys fields).
 */
export function featureSpecs(device, language) {
  if (!isShown(device)) {
    return [];
  }
  const list = [];
  const cover = coverOf(device);
  const light = cover ? null : lightOf(device);
  if (cover) {
    list.push(...coverFeatures(cover, language));
  } else if (light) {
    list.push(
      feature(FEATURE_KEYS.LIGHT, language, {
        category: CATEGORIES.LIGHT,
        type: TYPES.LIGHT.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: hasState(device, STATES.ON_OFF),
      }),
    );
    if (light.dimmable) {
      list.push(
        feature(FEATURE_KEYS.BRIGHTNESS, language, {
          category: CATEGORIES.LIGHT,
          type: TYPES.LIGHT.BRIGHTNESS,
          unit: UNITS.PERCENT,
          min: 0,
          max: 100,
          read_only: false,
          has_feedback: true,
        }),
      );
    }
  } else if (isSwitch(device)) {
    list.push(
      feature(FEATURE_KEYS.SWITCH, language, {
        category: CATEGORIES.SWITCH,
        type: TYPES.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: hasState(device, STATES.ON_OFF),
      }),
    );
  }
  for (const sensor of SENSORS) {
    if (sourcesOf(sensor).some((name) => offers(device, name))) {
      const { key, category, type, unit, min, max } = sensor;
      list.push(
        feature(key, language, {
          category,
          type,
          ...(unit ? { unit } : {}),
          min,
          max,
          read_only: true,
          has_feedback: false,
        }),
      );
    }
  }
  return list;
}

/**
 * @description The Gladys device of a TaHoma device.
 * @param {object} gladys - SDK client.
 * @param {object} device - Normalized TaHoma device.
 * @param {string} language - Language of the feature names.
 * @returns {object|null} The device, null when it has nothing for Gladys.
 */
export function buildDevice(gladys, device, language) {
  const specs = featureSpecs(device, language);
  if (specs.length === 0) {
    return null;
  }
  const ids = gladys.externalIds(DEVICE_TYPE, platformIdOf(device.url));
  return {
    name: device.label,
    external_id: ids.device,
    model: [device.manufacturer || 'Somfy', device.widget || device.uiClass]
      .filter(Boolean)
      .join(' '),
    // The box pushes the changes through the event listener: never polled.
    should_poll: false,
    params: [
      { name: 'TAHOMA_DEVICE_URL', value: device.url },
      { name: 'TAHOMA_PIN', value: device.pin ?? '' },
    ],
    features: specs.map(({ key, ...spec }) => ({ ...spec, external_id: ids.feature(key) })),
  };
}

const onOff = (device) => {
  const value = device.states.get(STATES.ON_OFF);
  return value === 'on' ? 1 : value === 'off' ? 0 : null;
};

/**
 * @description The current values of a device, by feature key.
 * @param {object} device - Normalized TaHoma device.
 * @returns {Array<[string, number]>} `[[key, value]]`, unknown values left out.
 */
export function deviceValues(device) {
  const values = [];
  const add = (key, value) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      values.push([key, value]);
    }
  };
  if (!isShown(device)) {
    return values;
  }
  const cover = coverOf(device);
  if (cover) {
    if (cover.feedback) {
      add(FEATURE_KEYS.STATE, coverStateOf(device, cover));
    }
    add(FEATURE_KEYS.POSITION, opennessOf(device, cover.position));
    add(FEATURE_KEYS.TILT, opennessOf(device, cover.tilt));
  } else if (lightOf(device)) {
    add(FEATURE_KEYS.LIGHT, onOff(device));
    if (lightOf(device).dimmable) {
      const intensity = device.states.get(STATES.LIGHT_INTENSITY);
      add(FEATURE_KEYS.BRIGHTNESS, Number.isFinite(intensity) ? intensity : null);
    }
  } else if (isSwitch(device)) {
    add(FEATURE_KEYS.SWITCH, onOff(device));
  }
  for (const sensor of SENSORS) {
    for (const name of sourcesOf(sensor)) {
      const value = device.states.has(name) ? sensor.value(device.states.get(name)) : null;
      if (value !== null) {
        add(sensor.key, value);
        break;
      }
    }
  }
  return values;
}

const clampPercent = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new RangeError(String(value));
  }
  return Math.round(number);
};

const command = (name, parameters = []) => ({ name, parameters });

/**
 * @description The Overkiz commands for a value Gladys sets.
 * @param {object} device - Normalized TaHoma device.
 * @param {string} key - Feature key.
 * @param {number} value - Gladys value.
 * @returns {object[]} `[{ name, parameters }]`, empty when nothing is to send.
 * @throws {RangeError} When the value is out of range.
 */
export function commandsFor(device, key, value) {
  const cover = coverOf(device);
  if (cover && key === FEATURE_KEYS.STATE) {
    const number = Number(value);
    if (number === COVER.OPEN) {
      return [command(cover.open)];
    }
    if (number === COVER.CLOSE) {
      return [command(cover.close)];
    }
    if (number === COVER.STOP) {
      if (cover.stop) {
        return [command(cover.stop)];
      }
      // "My" stops a moving motor but sends a still one to its favourite
      // position: only while it moves.
      return cover.my && isMoving(device) ? [command(cover.my)] : [];
    }
    throw new RangeError(String(value));
  }
  if (cover && key === FEATURE_KEYS.POSITION && cover.position) {
    const open = clampPercent(value);
    return [command(cover.position.command, [cover.position.inverted ? 100 - open : open])];
  }
  if (cover && key === FEATURE_KEYS.TILT && cover.tilt) {
    const open = clampPercent(value);
    return [command(cover.tilt.command, [cover.tilt.inverted ? 100 - open : open])];
  }
  if ((key === FEATURE_KEYS.LIGHT || key === FEATURE_KEYS.SWITCH) && hasCommand(device, 'on')) {
    return [command(Number(value) > 0 ? 'on' : 'off')];
  }
  if (key === FEATURE_KEYS.BRIGHTNESS && lightOf(device)?.dimmable) {
    const level = clampPercent(value);
    return [level === 0 ? command('off') : command('setIntensity', [level])];
  }
  return [];
}

/** Commands of the `send_command` scene action and of the widget buttons. */
export const SEND_COMMANDS = ['open', 'close', 'stop', 'my', 'identify'];

/**
 * @description The Overkiz commands of a `send_command` value.
 * @param {object} device - Normalized TaHoma device.
 * @param {string} name - One of SEND_COMMANDS.
 * @returns {object[]|null} The commands, null when the device cannot.
 */
export function namedCommand(device, name) {
  const cover = coverOf(device);
  switch (name) {
    case 'open':
    case 'close':
      if (cover) {
        return [command(cover[name])];
      }
      if (hasCommand(device, 'on')) {
        return [command(name === 'open' ? 'on' : 'off')];
      }
      return null;
    case 'stop':
      if (cover?.stop) {
        return [command(cover.stop)];
      }
      return cover?.my && isMoving(device) ? [command(cover.my)] : null;
    case 'my':
      return hasCommand(device, 'my') ? [command('my')] : null;
    case 'identify':
      // `wink` takes a parameter whose meaning is not documented: not used.
      for (const candidate of ['identify', 'startIdentify']) {
        if (hasCommand(device, candidate)) {
          return [command(candidate)];
        }
      }
      return null;
    default:
      return null;
  }
}
