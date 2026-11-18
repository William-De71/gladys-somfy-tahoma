// -----------------------------------------------------------------------------
// Dashboard widgets.
//
//   cover      one cover (setting `device`): how open it is (a live gauge),
//              what it does, its slats and its "My" position, the buttons
//              open / stop / My / close. "My" is what Gladys has no button
//              for: the favourite position stored in the motor.
//   overview   the covers added to Gladys at a glance, and the box: channel
//              in use (local or cloud), firmware, devices that stopped
//              answering; a button reads every state again
//   scenarios  the TaHoma scenarios, and buttons to run them (setting
//              `names`: which ones, in which order)
//
// Pure: the build functions turn a snapshot into a content, so the tests and
// docs/illustrations/gen.mjs use the exact code Gladys gets. Every text is
// multi-language: Gladys caches the content per language.
// -----------------------------------------------------------------------------

import { t, truncate } from './i18n.js';

export const WIDGETS = { COVER: 'cover', OVERVIEW: 'overview', SCENARIOS: 'scenarios' };
export const WIDGET_ACTIONS = { MY: 'my', REFRESH: 'refresh', RUN: 'run' };
export const TTL_SECONDS = 60;
export const OVERVIEW_TTL_SECONDS = 120;
export const SCENARIOS_TTL_SECONDS = 600;

const MAX_CARDS = 8;
const MAX_BUTTONS = 4;

/**
 * @typedef {object} CoverView
 * @property {string} deviceId - Gladys external id.
 * @property {string} name - Device name in Gladys.
 * @property {boolean} reachable - The box answers and the device too.
 * @property {boolean} curtain - A curtain (else a shutter, blind, gate…).
 * @property {boolean} toggle - A one-button opener.
 * @property {number|null} state - Gladys cover state (1, 0, -1), null unknown.
 * @property {boolean} moving - It moves.
 * @property {number|null} position - How open, 0-100 (null: unknown).
 * @property {number|null} tilt - How open the slats are (null: no slats).
 * @property {number|null} myPosition - "My" position, how open (null: unknown).
 * @property {boolean} hasStop - A stop command exists.
 * @property {boolean} hasMy - A "My" command exists.
 * @property {object} features - `{ state, position }` feature external ids.
 */

// A scenario name is the same in every language.
const same = (value) => ({ en: value, fr: value, de: value, es: value });

const percent = (value) => `${Math.round(value)} %`;

/**
 * @description What a cover does, in words.
 * @param {CoverView} view - Cover.
 * @returns {{ text: object, color: string }} The text and its color.
 */
export function stateText(view) {
  if (!view.reachable) {
    return { text: t('stateUnreachable'), color: 'danger' };
  }
  if (view.moving) {
    return { text: t('stateMoving'), color: 'primary' };
  }
  if (view.state === 1) {
    return { text: t('stateOpen'), color: 'success' };
  }
  if (view.state === -1) {
    return { text: t('stateClosed'), color: 'neutral' };
  }
  if (Number.isFinite(view.position)) {
    return { text: t('stateOpenAt', { position: Math.round(view.position) }), color: 'warning' };
  }
  return view.state === 0
    ? { text: t('statePartly'), color: 'warning' }
    : { text: t('stateUnknown'), color: 'neutral' };
}

/**
 * @description The `cover` widget.
 * @param {CoverView|null} view - The cover, null when the setting points nowhere.
 * @returns {object} The widget content.
 */
export function buildCoverWidget(view) {
  if (!view) {
    return {
      version: 1,
      ttl_seconds: TTL_SECONDS,
      components: [{ type: 'text', text: t('widgetChooseDevice'), variant: 'caption' }],
    };
  }
  const components = [{ type: 'text', text: truncate(view.name, 40), variant: 'heading' }];
  if (view.reachable && view.features.position && Number.isFinite(view.position)) {
    components.push({
      type: 'gauge',
      device_feature: view.features.position,
      // The unit comes from the feature (percent): the core drops a unit here.
      min: 0,
      max: 100,
      label: t(view.curtain ? 'widgetOpenCurtain' : 'widgetOpen'),
      color: 'primary',
    });
  }
  const state = stateText(view);
  const items = [{ label: t('widgetState'), value: state.text, color: state.color }];
  if (view.reachable && Number.isFinite(view.tilt)) {
    items.push({ label: t('widgetTilt'), value: percent(view.tilt), color: 'info' });
  }
  if (view.reachable && view.hasMy && Number.isFinite(view.myPosition)) {
    items.push({ label: t('widgetMy'), value: percent(view.myPosition), color: 'info' });
  }
  components.push({ type: 'status', items });
  if (!view.reachable) {
    components.push({ type: 'text', text: t('widgetOffline'), variant: 'caption' });
    return { version: 1, ttl_seconds: TTL_SECONDS, components };
  }
  const { features } = view;
  if (view.toggle) {
    components.push({
      type: 'button',
      label: t('widgetToggle'),
      icon: 'repeat',
      style: 'primary',
      device_feature: features.state,
      value: view.state === 1 ? -1 : 1,
    });
    return { version: 1, ttl_seconds: TTL_SECONDS, components };
  }
  components.push({
    type: 'button',
    label: t('widgetOpenButton'),
    icon: 'arrow-up',
    style: 'secondary',
    device_feature: features.state,
    value: 1,
  });
  if (view.hasStop) {
    components.push({
      type: 'button',
      label: t('widgetStop'),
      icon: 'square',
      style: 'secondary',
      device_feature: features.state,
      value: 0,
    });
  }
  if (view.hasMy) {
    components.push({
      type: 'button',
      label: t('widgetMyButton'),
      icon: 'star',
      style: 'primary',
      action: { key: WIDGET_ACTIONS.MY, params: { device: view.deviceId } },
    });
  }
  components.push({
    type: 'button',
    label: t('widgetClose'),
    icon: 'arrow-down',
    style: 'secondary',
    device_feature: features.state,
    value: -1,
  });
  return { version: 1, ttl_seconds: TTL_SECONDS, components };
}

/**
 * @typedef {object} BoxView
 * @property {string|null} pin - PIN of the box.
 * @property {'local'|'cloud'|null} transport - Channel in use.
 * @property {boolean} degraded - Not the preferred channel.
 * @property {boolean} configured - An account or a token is set.
 * @property {string} firmware - Firmware of the box.
 * @property {number} devices - Devices of the box.
 * @property {string[]} unavailable - Names of the devices that stopped answering.
 */

const channelRow = (box) => {
  if (!box.configured) {
    return { label: t('widgetBox'), value: t('widgetNotConfigured'), color: 'warning' };
  }
  if (!box.transport) {
    return { label: t('widgetBox'), value: t('widgetUnreachable'), color: 'danger' };
  }
  return {
    label: t('widgetBox'),
    value: t(box.transport === 'local' ? 'widgetLocal' : 'widgetCloud'),
    color: box.degraded ? 'warning' : 'success',
  };
};

/**
 * @description The `overview` widget.
 * @param {{ covers: CoverView[], box: BoxView }} view - Snapshot.
 * @returns {object} The widget content.
 */
export function buildOverviewWidget({ covers, box }) {
  const components = [];
  if (covers.length === 0) {
    components.push({ type: 'text', text: t('widgetNoCover'), variant: 'caption' });
  } else {
    const open = covers.filter((view) => view.reachable && view.state === 1).length;
    components.push({
      type: 'text',
      text: t('widgetSummary', { open, total: covers.length }),
      variant: 'caption',
    });
    components.push({
      type: 'card-list',
      display: 'list',
      items: covers.slice(0, MAX_CARDS).map((view) => {
        const state = stateText(view);
        const item = { title: truncate(view.name, 60), subtitle: state.text };
        if (view.reachable && Number.isFinite(view.position)) {
          item.badge = { text: percent(view.position), color: state.color };
          if (!view.moving && view.state === 0) {
            // The badge says how much: no need to repeat it.
            item.subtitle = t('statePartly');
          }
        }
        return item;
      }),
    });
  }
  const rows = [channelRow(box)];
  if (box.firmware) {
    rows.push({ label: t('widgetFirmware'), value: truncate(box.firmware, 24), color: 'neutral' });
  }
  if (box.unavailable.length > 0) {
    rows.push({
      label: t('widgetUnavailable'),
      value: truncate(box.unavailable.join(', '), 60),
      color: 'danger',
    });
  } else if (box.transport) {
    rows.push({
      label: t('widgetDevices'),
      value: t('widgetDevicesCount', { count: box.devices }),
      color: 'neutral',
    });
  }
  components.push({ type: 'status', items: rows });
  if (box.transport) {
    components.push({
      type: 'button',
      label: t('widgetRefresh'),
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: WIDGET_ACTIONS.REFRESH, params: {} },
    });
  }
  return { version: 1, ttl_seconds: OVERVIEW_TTL_SECONDS, components };
}

/**
 * @description The scenarios shown, from the `names` setting: the names
 * listed (comma-separated, any case), in that order; every scenario when empty.
 * @param {Array<{ oid: string, label: string }>} scenarios - TaHoma scenarios.
 * @param {string} [names] - Setting.
 * @returns {Array<{ oid: string, label: string }>} The scenarios to show.
 */
export function chooseScenarios(scenarios, names = '') {
  const wanted = String(names ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0) {
    return scenarios;
  }
  return wanted
    .map((name) => scenarios.find((scenario) => scenario.label.toLowerCase() === name))
    .filter(Boolean)
    .filter((scenario, index, list) => list.indexOf(scenario) === index);
}

/**
 * @description The `scenarios` widget.
 * @param {{ scenarios: object[], reachable: boolean, cloud: boolean }} view -
 *   The scenarios to show, the box answers, a TaHoma account is set.
 * @returns {object} The widget content.
 */
export function buildScenariosWidget({ scenarios, reachable, cloud }) {
  if (!cloud && scenarios.length === 0) {
    return {
      version: 1,
      ttl_seconds: SCENARIOS_TTL_SECONDS,
      components: [{ type: 'text', text: t('widgetScenariosNeedCloud'), variant: 'caption' }],
    };
  }
  if (scenarios.length === 0) {
    return {
      version: 1,
      ttl_seconds: SCENARIOS_TTL_SECONDS,
      components: [{ type: 'text', text: t('widgetNoScenario'), variant: 'caption' }],
    };
  }
  const components = [
    {
      type: 'card-list',
      display: 'list',
      items: scenarios.slice(0, MAX_CARDS).map((scenario) => ({
        title: truncate(scenario.label, 60),
        subtitle: t('widgetScenarioActions', { count: scenario.actions?.length ?? 0 }),
      })),
    },
  ];
  if (!reachable) {
    components.push({ type: 'text', text: t('widgetOffline'), variant: 'caption' });
    return { version: 1, ttl_seconds: SCENARIOS_TTL_SECONDS, components };
  }
  // Button action keys must be unique in a content (the core drops a
  // duplicate): one key per slot, the scenario id in the params.
  for (const [index, scenario] of scenarios.slice(0, MAX_BUTTONS).entries()) {
    components.push({
      type: 'button',
      label: same(truncate(scenario.label, 24)),
      icon: 'play',
      style: 'secondary',
      action: { key: `${WIDGET_ACTIONS.RUN}_${index + 1}`, params: { oid: scenario.oid } },
    });
  }
  return { version: 1, ttl_seconds: SCENARIOS_TTL_SECONDS, components };
}
