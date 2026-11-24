// -----------------------------------------------------------------------------
// Overkiz JSON -> plain objects, and what a device is able to do.
//
// A device of `GET /setup` (cloud and local alike):
//   { deviceURL: 'io://1234-5678-9012/12184029', label, controllableName,
//     available, enabled, attributes: [{ name, value }],
//     definition: { uiClass, widgetName, commands: [{ commandName, nparams }],
//                   states: [{ qualifiedName }] (local: [{ name }]) },
//     states: [{ name, type, value }] }
// The deviceURL holds the PIN of the box: `<protocol>://<pin>/<address>[#n]`.
// A sub-device (`#2`, `#3`) is another physical part (a sensor of the
// same product): it is a device of its own.
//
// State types (pyoverkiz DataType): 1 integer, 2 float, 3 string, 6 boolean,
// 10 JSON array, 11 JSON object. The cloud sends the values of the events as
// strings (`{"type": 1, "value": "23247220"}`): cast them by their type.
// -----------------------------------------------------------------------------

export const STATES = {
  CLOSURE: 'core:ClosureState',
  DEPLOYMENT: 'core:DeploymentState',
  SLATE_ORIENTATION: 'core:SlateOrientationState',
  OPEN_CLOSED: 'core:OpenClosedState',
  OPEN_CLOSED_PEDESTRIAN: 'core:OpenClosedPedestrianState',
  OPEN_CLOSED_UNKNOWN: 'core:OpenClosedUnknownState',
  OPEN_CLOSED_PARTIAL: 'core:OpenClosedPartialState',
  MOVING: 'core:MovingState',
  MEMORIZED_1: 'core:Memorized1PositionState',
  STATUS: 'core:StatusState',
  ON_OFF: 'core:OnOffState',
  LIGHT_INTENSITY: 'core:LightIntensityState',
  TEMPERATURE: 'core:TemperatureState',
  LUMINANCE: 'core:LuminanceState',
  HUMIDITY: 'core:RelativeHumidityState',
  CONTACT: 'core:ContactState',
  OCCUPANCY: 'core:OccupancyState',
  SMOKE: 'core:SmokeState',
  WATER_DETECTION: 'core:WaterDetectionState',
  BATTERY_LEVEL: 'core:BatteryLevelState',
  BATTERY_DISCRETE_LEVEL: 'core:BatteryDiscreteLevelState',
  BATTERY: 'core:BatteryState',
  CO2: 'core:CO2ConcentrationState',
  POWER: 'core:ElectricPowerConsumptionState',
  ENERGY: 'core:ElectricEnergyConsumptionState',
};

// Positions the motors report when they do not know (HA overkiz, cover.py).
const POSITION_MY = 108;
const POSITION_UNKNOWN = 124;

/**
 * @description The value of an Overkiz state, cast by its type.
 * @param {{ type?: number, value?: * }} state - Raw state.
 * @returns {*} Number, boolean, string, object, or null.
 */
export function castState({ type, value } = {}) {
  if (value === null || value === undefined) {
    return null;
  }
  switch (Number(type)) {
    case 1: {
      const number = Number.parseInt(value, 10);
      return Number.isFinite(number) ? number : null;
    }
    case 2: {
      const number = Number.parseFloat(value);
      return Number.isFinite(number) ? number : null;
    }
    case 6:
      return value === true || value === 'true';
    case 10:
    case 11:
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value;
    default:
      return value;
  }
}

/**
 * @description The PIN of the box a deviceURL belongs to.
 * @param {string} url - deviceURL.
 * @returns {string|null} `1234-5678-9012`, null when absent.
 */
export function pinOf(url) {
  return /^[a-z0-9]+:\/\/(\d{4}-\d{4}-\d{4})\//i.exec(String(url ?? ''))?.[1] ?? null;
}

/**
 * @description The platform id of a device, for its external ids: the
 * deviceURL with only letters, digits and dashes, lowercased.
 * `io://1234-5678-9012/12184029#2` -> `io-1234-5678-9012-12184029-2`.
 * @param {string} url - deviceURL.
 * @returns {string} The platform id.
 */
export function platformIdOf(url) {
  return String(url)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @description A device of the setup, normalized.
 * @param {object} raw - Device of `GET /setup`.
 * @returns {object|null} The device, null when it has no deviceURL.
 */
export function normalizeDevice(raw) {
  if (!raw || typeof raw.deviceURL !== 'string') {
    return null;
  }
  const definition = raw.definition ?? {};
  const commands = new Map();
  for (const command of definition.commands ?? []) {
    if (command?.commandName) {
      commands.set(command.commandName, Number(command.nparams ?? 0));
    }
  }
  const states = new Map();
  for (const state of raw.states ?? []) {
    if (state?.name) {
      states.set(state.name, castState(state));
    }
  }
  // The cloud names a declared state `qualifiedName`, the local API `name`.
  const declared = new Set(
    (definition.states ?? []).map((state) => state?.qualifiedName ?? state?.name).filter(Boolean),
  );
  const attribute = (name) => raw.attributes?.find?.((item) => item?.name === name)?.value;
  return {
    url: raw.deviceURL,
    pin: pinOf(raw.deviceURL),
    protocol: raw.deviceURL.split(':')[0].toLowerCase(),
    label: String(raw.label ?? '').trim() || raw.deviceURL,
    uiClass: String(definition.uiClass ?? raw.uiClass ?? ''),
    widget: String(definition.widgetName ?? raw.widget ?? ''),
    controllable: String(raw.controllableName ?? ''),
    available: raw.available !== false,
    enabled: raw.enabled !== false,
    manufacturer:
      typeof attribute('core:Manufacturer') === 'string' ? attribute('core:Manufacturer') : '',
    commands,
    declared,
    states,
  };
}

/**
 * @description Apply the states of a DeviceStateChangedEvent.
 * @param {object} device - Normalized device.
 * @param {object[]} deviceStates - `[{ name, type, value }]`.
 * @returns {string[]} Names of the states whose value changed.
 */
export function applyStates(device, deviceStates = []) {
  const changed = [];
  for (const state of deviceStates) {
    if (!state?.name) {
      continue;
    }
    const value = castState(state);
    const before = device.states.get(state.name);
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      changed.push(state.name);
    }
    device.states.set(state.name, value);
    device.declared.add(state.name);
  }
  return changed;
}

/** The device knows the state (in its definition or its values). */
export const hasState = (device, name) => device.declared.has(name) || device.states.has(name);

/** The device takes the command. */
export const hasCommand = (device, name) => device.commands.has(name);

// --- Covers -------------------------------------------------------------------------

const COVER_CLASSES = new Set([
  'RollerShutter',
  'Shutter',
  'SwingingShutter',
  'ExteriorScreen',
  'Screen',
  'Window',
  'Pergola',
  'Awning',
  'VenetianBlind',
  'ExteriorVenetianBlind',
  'AdjustableSlatsRollerShutter',
  'GarageDoor',
  'Gate',
  'Curtain',
]);

// Somfy RTS motors without a class of their own (HA: RTSGeneric).
const COVER_WIDGETS = new Set(['RTSGeneric']);

const DIRECTION_PAIRS = [
  ['open', 'close'],
  ['up', 'down'],
  ['deploy', 'undeploy'],
];

/**
 * @description How a cover is driven, from its commands and states
 * (the same choices as the Home Assistant overkiz integration).
 * @param {object} device - Normalized device.
 * @returns {object|null} `{ curtain, open, close, stop, my, toggle, position,
 *   tilt, feedback }`, null when the device is not a cover.
 */
export function coverOf(device) {
  if (!COVER_CLASSES.has(device.uiClass) && !COVER_WIDGETS.has(device.widget)) {
    return null;
  }
  const deploys =
    device.uiClass === 'Awning' ||
    (hasState(device, STATES.DEPLOYMENT) && !hasState(device, STATES.CLOSURE));
  const pairs = deploys ? [DIRECTION_PAIRS[2], ...DIRECTION_PAIRS.slice(0, 2)] : DIRECTION_PAIRS;
  const pair = pairs.find(([open, close]) => hasCommand(device, open) && hasCommand(device, close));
  const toggle = !pair && hasCommand(device, 'cycle');
  if (!pair && !toggle) {
    return null;
  }
  let position = null;
  if (hasState(device, STATES.CLOSURE) && hasCommand(device, 'setClosure') && !deploys) {
    position = { state: STATES.CLOSURE, command: 'setClosure', inverted: true };
  } else if (hasState(device, STATES.DEPLOYMENT) && hasCommand(device, 'setDeployment')) {
    position = { state: STATES.DEPLOYMENT, command: 'setDeployment', inverted: false };
  }
  const tilt =
    hasState(device, STATES.SLATE_ORIENTATION) && hasCommand(device, 'setOrientation')
      ? { state: STATES.SLATE_ORIENTATION, command: 'setOrientation', inverted: true }
      : null;
  const openClosed = [
    STATES.OPEN_CLOSED,
    STATES.OPEN_CLOSED_PEDESTRIAN,
    STATES.OPEN_CLOSED_UNKNOWN,
    STATES.OPEN_CLOSED_PARTIAL,
  ].find((name) => hasState(device, name));
  return {
    curtain: device.uiClass === 'Curtain',
    open: pair?.[0] ?? 'cycle',
    close: pair?.[1] ?? 'cycle',
    stop: hasCommand(device, 'stop') ? 'stop' : null,
    my: hasCommand(device, 'my') ? 'my' : null,
    toggle,
    position,
    tilt,
    openClosed: openClosed ?? null,
    // RTS motors are one-way: nothing comes back.
    feedback: Boolean(position || openClosed),
  };
}

/**
 * @description How open a position state is, 0 (closed) to 100 (open).
 * @param {object} device - Normalized device.
 * @param {{ state: string, inverted: boolean }|null} spec - Position or tilt.
 * @returns {number|null} The openness, null when unknown.
 */
export function opennessOf(device, spec) {
  if (!spec) {
    return null;
  }
  const raw = device.states.get(spec.state);
  if (
    !Number.isFinite(raw) ||
    raw === POSITION_MY ||
    raw === POSITION_UNKNOWN ||
    raw < 0 ||
    raw > 100
  ) {
    return null;
  }
  return spec.inverted ? 100 - raw : raw;
}

/**
 * @description The Gladys shutter state of a cover: 1 open, -1 closed,
 * 0 partly open or stopped half-way.
 * @param {object} device - Normalized device.
 * @param {object} cover - coverOf(device).
 * @returns {number|null} The state, null when unknown.
 */
export function coverStateOf(device, cover) {
  const openness = opennessOf(device, cover.position);
  if (openness !== null) {
    if (openness >= 100) {
      return 1;
    }
    return openness <= 0 ? -1 : 0;
  }
  const value = cover.openClosed ? device.states.get(cover.openClosed) : null;
  if (value === 'open') {
    return 1;
  }
  if (value === 'closed') {
    return -1;
  }
  return value === 'pedestrian' || value === 'partial' ? 0 : null;
}

/** The cover moves (core:MovingState). */
export const isMoving = (device) => device.states.get(STATES.MOVING) === true;

// --- Lights and plugs ---------------------------------------------------------------------

/**
 * @description A light: on / off, and its intensity when it has one.
 * @param {object} device - Normalized device.
 * @returns {{ dimmable: boolean }|null} The light, null otherwise.
 */
export function lightOf(device) {
  if (device.uiClass !== 'Light' || !hasCommand(device, 'on') || !hasCommand(device, 'off')) {
    return null;
  }
  return {
    dimmable: hasCommand(device, 'setIntensity') && hasState(device, STATES.LIGHT_INTENSITY),
  };
}

const SWITCH_CLASSES = new Set(['OnOff', 'SwimmingPool']);

/** A plug or a relay switched on and off. */
export const isSwitch = (device) =>
  SWITCH_CLASSES.has(device.uiClass) && hasCommand(device, 'on') && hasCommand(device, 'off');

// Never shown: the box itself, its radio stacks, the internal "pod".
const HIDDEN_CLASSES = new Set(['ProtocolGateway', 'Pod']);

/** The device can be offered to Gladys. */
export const isShown = (device) => device.enabled && !HIDDEN_CLASSES.has(device.uiClass);
