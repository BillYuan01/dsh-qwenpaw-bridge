/**
 * Inbound ACP gate.
 *
 * Most frames are passed through untouched. This gate owns only the additive
 * bridge surface:
 *   - remembers request ids whose responses need decoration;
 *   - answers `session/set_config_option(configId="permission_mode")` locally,
 *     so switching a preset never restarts a process;
 *   - answers the `qwenpaw/permission/*` and `qwenpaw/streaming/*` helpers;
 *   - lets `initialize._meta.qwenpaw.streaming === false` opt out of live
 *     deltas while keeping the standard committed projection.
 */

import {
  BRIDGE_METHODS,
  DROP,
  PERMISSION_ALIASES,
  compact,
  errorFrame,
  isRequest,
  resultFrame,
} from './protocol.js';
import {
  availablePresets,
  comparePresetSnapshot,
  decorateConfigOptions,
  presetCatalog,
  presetState,
  switchPreset,
} from './presets.js';
import { requestedPreset, requestedStreamingOff } from './outbound.js';

/**
 * Message used when `permissionPresets: false` disabled the bridge surface.
 * The switch is refused locally; it is never forwarded to the stock ACP
 * implementation, which could otherwise apply its own permission handling.
 */
const PRESETS_DISABLED = 'permission preset switching is disabled by this profile';

/** Whether this bridge is allowed to expose or change permission presets. */
function presetsEnabled(state) {
  return state.config?.permissionPresets !== false;
}

/** Wrap the parsed client stream, consuming only bridge-owned frames. */
export function createInboundGate(readable, state) {
  const reader = readable.getReader();
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done === true) {
          controller.close();
          return;
        }
        let forward = value;
        try {
          forward = await handleInbound(state, value);
        } catch (error) {
          state.diag(`inbound handling failed (forwarding original): ${String(error)}`);
          forward = value;
        }
        if (forward === DROP) continue;
        controller.enqueue(forward);
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function handleInbound(state, frame) {
  if (!isRequest(frame)) return frame;
  const method = frame.method;
  const id = frame.id;
  const params = frame.params;

  if (method === 'initialize') {
    if (requestedStreamingOff(params)) {
      state.streaming = false;
      state.diag('client requested committed mode; live deltas disabled for this connection');
    }
    state.pending.set(id, { method, params });
    return frame;
  }

  if (method === 'session/new' || method === 'session/resume' || method === 'session/close') {
    state.pending.set(id, { method, params });
    return frame;
  }

  if (method === 'session/set_config_option') {
    if (!PERMISSION_ALIASES.includes(params?.configId)) {
      state.pending.set(id, { method, params });
      return frame;
    }
    return answerPermissionSwitch(state, id, params);
  }

  // ACP extension methods carry a leading underscore on the wire (the SDK
  // adds it); accept both spellings so raw clients and SDK clients agree.
  const normalized = typeof method === 'string' && method.startsWith('_') ? method.slice(1) : method;

  if (normalized === BRIDGE_METHODS.permissionSet) {
    return answerPermissionSet(state, id, params);
  }
  if (normalized === BRIDGE_METHODS.permissionGet) {
    return answerPermissionGet(state, id, params);
  }
  if (normalized === BRIDGE_METHODS.streamingSet) {
    state.streaming = params?.enabled !== false;
    await state.send(resultFrame(id, { streaming: state.streaming }));
    return DROP;
  }

  if (typeof normalized === 'string' && normalized.startsWith('qwenpaw/')) {
    await state.send(errorFrame(id, -32601, `unsupported qwenpaw method: ${normalized}`));
    return DROP;
  }

  return frame;
}

async function answerPermissionSwitch(state, id, params) {
  if (!presetsEnabled(state)) {
    await state.send(errorFrame(id, -32602, PRESETS_DISABLED));
    return DROP;
  }
  const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : undefined;
  const value = params?.value;
  if (sessionId === undefined) {
    await state.send(errorFrame(id, -32602, 'permission switch requires sessionId'));
    return DROP;
  }
  const catalog = presetCatalog(state.ctx);
  if (catalog === undefined) {
    await state.send(errorFrame(id, -32602, 'permission presets are not available in this profile'));
    return DROP;
  }
  const allowed = availablePresets(catalog);
  if (typeof value !== 'string' || !allowed.has(value)) {
    await state.send(errorFrame(id, -32602, `unknown permission preset: ${String(value)}`));
    return DROP;
  }
  const switched = switchPreset(state.ctx, sessionId, value);
  if (!switched.ok) {
    await state.send(errorFrame(id, -32602, switched.error));
    return DROP;
  }
  const confirmed = confirmSwitch(state.ctx, sessionId, value);
  if (!confirmed.ok) {
    await state.send(errorFrame(id, -32602, confirmed.message, confirmed.data));
    return DROP;
  }
  const configOptions = decorateConfigOptions(
    state.ctx,
    state.configOptions.get(sessionId),
    sessionId,
    catalog,
  );
  state.configOptions.set(sessionId, configOptions);
  await state.send(resultFrame(id, { configOptions }));
  return DROP;
}

async function answerPermissionSet(state, id, params) {
  if (!presetsEnabled(state)) {
    await state.send(errorFrame(id, -32601, `${PRESETS_DISABLED}: qwenpaw/permission/set`));
    return DROP;
  }
  const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : undefined;
  const preset = params?.preset ?? params?.permission_preset ?? params?.permissionPreset;
  if (sessionId === undefined) {
    await state.send(errorFrame(id, -32602, 'qwenpaw/permission/set requires sessionId'));
    return DROP;
  }
  if (typeof preset !== 'string') {
    await state.send(errorFrame(id, -32602, 'qwenpaw/permission/set requires preset'));
    return DROP;
  }
  const switched = switchPreset(state.ctx, sessionId, preset);
  if (!switched.ok) {
    await state.send(errorFrame(id, -32602, switched.error));
    return DROP;
  }
  const confirmed = confirmSwitch(state.ctx, sessionId, preset);
  if (!confirmed.ok) {
    await state.send(errorFrame(id, -32602, confirmed.message, confirmed.data));
    return DROP;
  }
  const catalog = presetCatalog(state.ctx);
  const configOptions = decorateConfigOptions(
    state.ctx,
    state.configOptions.get(sessionId),
    sessionId,
    catalog,
  );
  state.configOptions.set(sessionId, configOptions);
  await state.send(resultFrame(id, compact({
    permission_preset: confirmed.value,
    permission_preset_known: true,
    permission_presets: catalog?.options,
    default_permission_preset: catalog?.default,
    configOptions,
  })));
  return DROP;
}

async function answerPermissionGet(state, id, params) {
  if (!presetsEnabled(state)) {
    await state.send(errorFrame(id, -32601, `${PRESETS_DISABLED}: qwenpaw/permission/get`));
    return DROP;
  }
  const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : undefined;
  const catalog = presetCatalog(state.ctx);
  const configOptions = decorateConfigOptions(
    state.ctx,
    sessionId === undefined ? undefined : state.configOptions.get(sessionId),
    sessionId,
    catalog,
  );
  const actual = presetState(state.ctx, sessionId);
  await state.send(resultFrame(id, compact({
    permission_preset: actual.known ? actual.value : undefined,
    permission_preset_known: actual.known,
    permission_preset_reason: actual.known ? undefined : actual.reason,
    permission_presets: catalog?.options,
    default_permission_preset: catalog?.default,
    configOptions,
  })));
  return DROP;
}

/**
 * Verify a write by reading the session back. A successful `set` only proves
 * the call did not throw; it does not prove the session now runs that preset.
 * An unverifiable write is reported as an error so the client stops instead of
 * trusting a preset it cannot confirm.
 */
function confirmSwitch(ctx, sessionId, expected) {
  const actual = comparePresetSnapshot(presetState(ctx, sessionId), expected);
  if (!actual.confirmed) {
    if (!actual.known) {
      return {
        ok: false,
        message: `permission preset ${JSON.stringify(expected)} was written but could not be confirmed (${actual.reason}); stop and re-read the permission state before continuing`,
        data: {
          permission_preset_written: true,
          permission_preset_confirmed: false,
          permission_preset_reason: actual.reason,
        },
      };
    }
    return {
      ok: false,
      message: `permission preset ${JSON.stringify(expected)} was written but the session reports ${JSON.stringify(actual.actual)}; stop and re-read the permission state before continuing`,
      data: {
        permission_preset_written: true,
        permission_preset_confirmed: false,
        permission_preset_actual: actual.actual,
      },
    };
  }
  return { ok: true, value: actual.actual };
}
