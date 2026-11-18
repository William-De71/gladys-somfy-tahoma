// -----------------------------------------------------------------------------
// Scene triggers and actions: keys, data, values. Every key and value here is
// stored in the scenes of the users: permanent.
//
//   command_failed               a command did not reach its device or the
//                                motor refused it (obstacle, blocked, out of
//                                range): `failure_type` is the Overkiz code
//   device_availability_changed  a device stopped answering the box, or came
//                                back (battery, power cut, radio range)
//   box_connection_changed       the box became unreachable (no channel, or
//                                the cloud says it is down) for a minute, or
//                                came back
//
//   run_scenario                 run a TaHoma scenario by its name
//   send_command                 open, close, stop, "My" position, identify
// -----------------------------------------------------------------------------

import { SEND_COMMANDS } from './devices.js';

export const SCENE_TRIGGERS = {
  COMMAND_FAILED: 'command_failed',
  AVAILABILITY_CHANGED: 'device_availability_changed',
  BOX_CONNECTION_CHANGED: 'box_connection_changed',
};

export const SCENE_ACTIONS = {
  RUN_SCENARIO: 'run_scenario',
  SEND_COMMAND: 'send_command',
};

export const AVAILABILITY_STATES = ['available', 'unavailable'];
export const BOX_STATES = ['online', 'offline'];
export const TRANSPORT_VALUES = ['local', 'cloud', 'none'];
export const SEND_COMMAND_VALUES = SEND_COMMANDS;

/** Keys of the data of each trigger (its fields and variables). */
export const SCENE_TRIGGER_DATA = {
  [SCENE_TRIGGERS.COMMAND_FAILED]: ['device', 'device_name', 'failure_type', 'label'],
  [SCENE_TRIGGERS.AVAILABILITY_CHANGED]: ['device', 'device_name', 'state'],
  [SCENE_TRIGGERS.BOX_CONNECTION_CHANGED]: ['state', 'transport', 'pin'],
};

/** Outputs of each action, in the manifest order. */
export const SCENE_ACTION_OUTPUTS = {
  [SCENE_ACTIONS.RUN_SCENARIO]: ['exec_id', 'scenario', 'transport'],
  [SCENE_ACTIONS.SEND_COMMAND]: ['exec_id', 'transport'],
};

/**
 * @description The failed devices of an execution event.
 * @param {object} event - ExecutionStateChangedEvent (cloud: `failedCommands`)
 *   or CommandExecutionStateChangedEvent (local: one device).
 * @returns {Array<{ url: string|null, failure: string }>|null} The failures,
 *   null when the event is not a failure.
 */
export function failuresOf(event) {
  if (event?.newState !== 'FAILED') {
    return null;
  }
  const failure = String(event.failureType ?? event.failureTypeCode ?? 'UNKNOWN');
  if (event.name === 'CommandExecutionStateChangedEvent') {
    return [{ url: event.deviceURL ?? null, failure }];
  }
  const commands = Array.isArray(event.failedCommands) ? event.failedCommands : [];
  const list = commands
    .filter((item) => item?.deviceURL)
    .map((item) => ({ url: item.deviceURL, failure: String(item.failureType ?? failure) }));
  return list.length > 0 ? list : [{ url: null, failure }];
}
