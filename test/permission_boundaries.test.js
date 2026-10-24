/**
 * Security regression tests for the permission-preset surface (R04 + R09).
 *
 * R04: the catalog `default` is a default, not the session's actual preset.
 *      When the actual preset cannot be read, no output may present the
 *      default as `permission_preset` / `currentValue`.
 * R09: `permissionPresets: false` must disable every bridge-owned write entry
 *      point (standard `permission_mode` config option, its aliases, and the
 *      `qwenpaw/permission/{set,get}` extensions) without calling the service
 *      and without forwarding the frame to the stock ACP implementation.
 *
 * Offline only: fake ctx/service objects, no DSH process, no model, no
 * credentials. Run: node --test test/permission_boundaries.test.js
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createInboundGate } from '../lib/inbound.js';
import { createOutboundWritable } from '../lib/outbound.js';
import { decorateConfigOptions } from '../lib/presets.js';

// Raw shape returned by `ctx.permissionPresets.catalog()`.
const RAW_CATALOG = {
  options: [
    { value: 'read-only', name: 'read-only' },
    { value: 'workspace-write', name: 'workspace-write' },
    { value: 'danger-full-access', name: 'danger-full-access' },
  ],
  defaultPreset: 'read-only',
};

// Normalized shape (`{options: [{id}], default}`) accepted by
// `decorateConfigOptions`, as produced by the bridge's own catalog reader.
const CATALOG = {
  options: [
    { id: 'read-only', name: 'read-only' },
    { id: 'workspace-write', name: 'workspace-write' },
    { id: 'danger-full-access', name: 'danger-full-access' },
  ],
  default: 'read-only',
};

const MISSING = Symbol('missing-service');

function makeCtx({ service = MISSING, session } = {}) {
  const ctx = {
    get(name) {
      if (name === 'permissionPresets') {
        if (service === MISSING) throw new Error('permissionPresets is not mounted');
        return service;
      }
      return undefined;
    },
  };
  if (session !== 'absent') {
    ctx.sessions = {
      get(id) {
        if (session === 'missing') return undefined;
        return { id };
      },
    };
  }
  return ctx;
}

/**
 * @param {string|null|undefined} actual value returned by `current()`.
 * `null` -> the service has no `current` method; `undefined` -> nothing readable.
 */
function makeService(actual, { throwOnCurrent = false, withCurrent = true } = {}) {
  const calls = { set: [], current: 0, catalog: 0 };
  const service = {
    catalog() {
      calls.catalog += 1;
      return RAW_CATALOG;
    },
    set(session, name) {
      calls.set.push({ session: session?.id, name });
    },
  };
  if (withCurrent) {
    service.current = () => {
      calls.current += 1;
      if (throwOnCurrent) throw new Error('session preset is not readable');
      return actual;
    };
  }
  return { service, calls };
}

function makeState(ctx, config = {}) {
  const sent = [];
  const state = {
    ctx,
    config,
    streaming: true,
    sessions: new Set(),
    live: new Map(),
    pending: new Map(),
    configOptions: new Map(),
    initialSelection: {},
    catalogPromise: undefined,
    diag: () => {},
    sent,
    send: async (frame) => {
      sent.push(frame);
    },
    write: async () => {},
  };
  return state;
}

async function runInbound(state, frames) {
  const source = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });
  const forwarded = [];
  for await (const frame of createInboundGate(source, state)) forwarded.push(frame);
  return forwarded;
}

async function runOutbound(state, frames) {
  const written = [];
  state.write = async (frame) => {
    written.push(frame);
  };
  const writer = createOutboundWritable(state).getWriter();
  for (const frame of frames) await writer.write(frame);
  await writer.close();
  return written;
}

function permissionSelect(options) {
  return Array.isArray(options) ? options.find((option) => option?.id === 'permission_mode') : undefined;
}

function metaOf(frame) {
  return frame?.result?._meta?.qwenpaw;
}

/** Feed one session request + its (fake) stock response through the relay. */
async function sessionExchange(state, { id = 7, method = 'session/new', requested, result = {} } = {}) {
  const params = requested === undefined ? {} : { _meta: { qwenpaw: { permission_preset: requested } } };
  state.pending.set(id, { method, params });
  const frames = await runOutbound(state, [
    { jsonrpc: '2.0', id, result: { sessionId: 'session-1', configOptions: [], ...result } },
  ]);
  return { params, frame: frames.at(-1), meta: metaOf(frames.at(-1)) };
}

// --------------------------------------------------------------------- R04
test('R04: unreadable current() never presents the catalog default as current', () => {
  const { service } = makeService('read-only', { throwOnCurrent: true });
  const ctx = makeCtx({ service });

  const options = decorateConfigOptions(ctx, [], 'session-1', CATALOG);

  assert.equal(permissionSelect(options), undefined);
});

test('R04: missing session never presents the catalog default as current', () => {
  const { service } = makeService('danger-full-access');
  const ctx = makeCtx({ service, session: 'missing' });

  const options = decorateConfigOptions(ctx, [], 'session-1', CATALOG);

  assert.equal(permissionSelect(options), undefined);
});

test('R04: a service without current() reports unknown instead of the default', () => {
  const { service } = makeService(undefined, { withCurrent: false });
  const ctx = makeCtx({ service });

  assert.equal(permissionSelect(decorateConfigOptions(ctx, [], 'session-1', CATALOG)), undefined);
});

test('R04: an absent service omits the select entirely', () => {
  const ctx = makeCtx({ service: MISSING });

  assert.equal(permissionSelect(decorateConfigOptions(ctx, [], 'session-1', CATALOG)), undefined);
  assert.equal(permissionSelect(decorateConfigOptions(ctx, [], 'session-1', undefined)), undefined);
});

test('R04: a readable non-default actual value is still reported', () => {
  const { service } = makeService('danger-full-access');
  const ctx = makeCtx({ service });

  const select = permissionSelect(decorateConfigOptions(ctx, [], 'session-1', CATALOG));

  assert.equal(select?.currentValue, 'danger-full-access');
});

test('R04: an actual value outside the catalog is not replaced by the default', () => {
  const { service } = makeService('custom-strict');
  const ctx = makeCtx({ service });

  assert.equal(permissionSelect(decorateConfigOptions(ctx, [], 'session-1', CATALOG)), undefined);
});

test('R04: initialize reports the default as default, never as the session actual', async () => {
  const { service } = makeService('danger-full-access');
  const state = makeState(makeCtx({ service }));
  state.pending.set(1, { method: 'initialize', params: {} });

  const [frame] = await runOutbound(state, [{ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }]);
  const meta = metaOf(frame);

  assert.equal(meta.default_permission_preset, 'read-only');
  assert.equal(meta.permission_preset, undefined);
  assert.equal(meta.permission_preset_known, false);
});

test('R04: session/new reports the confirmed actual and keeps the default separate', async () => {
  const { service } = makeService('danger-full-access');
  const state = makeState(makeCtx({ service }));

  const { meta } = await sessionExchange(state);

  assert.equal(meta.permission_preset, 'danger-full-access');
  assert.equal(meta.permission_preset_known, true);
  assert.equal(meta.default_permission_preset, 'read-only');
});

test('R04: session/new with an unreadable actual omits permission_preset but keeps the default', async () => {
  const { service } = makeService('read-only', { throwOnCurrent: true });
  const state = makeState(makeCtx({ service }));

  const { meta } = await sessionExchange(state);

  assert.equal(meta.permission_preset, undefined);
  assert.equal(meta.permission_preset_known, false);
  assert.equal(meta.default_permission_preset, 'read-only');
});

test('R04: a config_option_update with an unreadable actual drops the select', async () => {
  const { service } = makeService('read-only', { throwOnCurrent: true });
  const state = makeState(makeCtx({ service }));
  state.sessions.add('session-1');

  const [frame] = await runOutbound(state, [{
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'config_option_update',
        configOptions: [{ id: 'model', currentValue: 'p/m' }],
      },
    },
  }]);

  const options = frame.params.update.configOptions;
  assert.equal(permissionSelect(options), undefined);
  assert.deepEqual(options.map((option) => option.id), ['model']);
});

// --------------------------------------------------------------------- R09
test('R09: permissionPresets:false refuses the standard permission_mode switch', async () => {
  const { service, calls } = makeService('read-only');
  const state = makeState(makeCtx({ service }), { permissionPresets: false });

  const forwarded = await runInbound(state, [{
    jsonrpc: '2.0',
    id: 11,
    method: 'session/set_config_option',
    params: { sessionId: 'session-1', configId: 'permission_mode', value: 'danger-full-access' },
  }]);

  assert.equal(forwarded.length, 0, 'the switch must not reach the stock ACP implementation');
  assert.equal(calls.set.length, 0);
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].error.code, -32602);
  assert.equal(state.sent[0].result, undefined);
});

test('R09: permissionPresets:false refuses every permission config alias', async () => {
  for (const configId of ['permission_mode', 'permission_preset', 'permissionPreset']) {
    const { service, calls } = makeService('read-only');
    const state = makeState(makeCtx({ service }), { permissionPresets: false });

    const forwarded = await runInbound(state, [{
      jsonrpc: '2.0',
      id: 12,
      method: 'session/set_config_option',
      params: { sessionId: 'session-1', configId, value: 'danger-full-access' },
    }]);

    assert.equal(forwarded.length, 0, `alias ${configId} was forwarded`);
    assert.equal(calls.set.length, 0, `alias ${configId} called the service`);
    assert.equal(state.sent[0]?.error?.code, -32602, `alias ${configId} code`);
  }
});

test('R09: permissionPresets:false refuses qwenpaw/permission/set with and without the SDK underscore', async () => {
  for (const method of ['qwenpaw/permission/set', '_qwenpaw/permission/set']) {
    const { service, calls } = makeService('read-only');
    const state = makeState(makeCtx({ service }), { permissionPresets: false });

    const forwarded = await runInbound(state, [{
      jsonrpc: '2.0',
      id: 13,
      method,
      params: { sessionId: 'session-1', preset: 'danger-full-access' },
    }]);

    assert.equal(forwarded.length, 0, `${method} was forwarded`);
    assert.equal(calls.set.length, 0, `${method} called the service`);
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].error.code, -32601);
  }
});

test('R09: permissionPresets:false refuses qwenpaw/permission/get', async () => {
  const { service } = makeService('read-only');
  const state = makeState(makeCtx({ service }), { permissionPresets: false });

  const forwarded = await runInbound(state, [{
    jsonrpc: '2.0',
    id: 14,
    method: 'qwenpaw/permission/get',
    params: { sessionId: 'session-1' },
  }]);

  assert.equal(forwarded.length, 0);
  assert.equal(state.sent[0].error.code, -32601);
});

test('R09: permissionPresets:false ignores an initial preset request without a side effect', async () => {
  const { service, calls } = makeService('read-only');
  const state = makeState(makeCtx({ service }), { permissionPresets: false });

  const { meta } = await sessionExchange(state, { requested: 'danger-full-access' });

  assert.equal(calls.set.length, 0);
  assert.equal(meta.requested_permission_preset, 'danger-full-access');
  assert.equal(meta.permission_preset_fallback, true);
  assert.equal(meta.permission_preset, undefined);
  assert.equal(meta.permission_preset_known, false);
  assert.equal(meta.permission_presets, undefined);
});

test('R09: an enabled switch is confirmed by a read-back before it reports success', async () => {
  const { service, calls } = makeService('danger-full-access');
  const state = makeState(makeCtx({ service }), {});

  const forwarded = await runInbound(state, [{
    jsonrpc: '2.0',
    id: 15,
    method: 'session/set_config_option',
    params: { sessionId: 'session-1', configId: 'permission_mode', value: 'danger-full-access' },
  }]);

  assert.equal(forwarded.length, 0);
  assert.deepEqual(calls.set, [{ session: 'session-1', name: 'danger-full-access' }]);
  const result = state.sent[0]?.result;
  assert.equal(state.sent[0]?.error, undefined);
  assert.equal(permissionSelect(result?.configOptions)?.currentValue, 'danger-full-access');
});

test('R09: a written but unconfirmed switch is not reported as success', async () => {
  const { service, calls } = makeService('read-only', { throwOnCurrent: true });
  const state = makeState(makeCtx({ service }), {});

  await runInbound(state, [{
    jsonrpc: '2.0',
    id: 16,
    method: 'session/set_config_option',
    params: { sessionId: 'session-1', configId: 'permission_mode', value: 'danger-full-access' },
  }]);

  assert.equal(calls.set.length, 1, 'the write itself still happened');
  assert.equal(state.sent[0]?.result, undefined);
  assert.equal(state.sent[0]?.error?.code, -32602);
  assert.match(state.sent[0]?.error?.message ?? '', /not confirmed|could not be confirmed/i);
  assert.equal(state.sent[0]?.error?.data?.permission_preset_written, true);
  assert.equal(state.sent[0]?.error?.data?.permission_preset_confirmed, false);
});

test('R09: an enabled qwenpaw/permission/set returns the confirmed preset', async () => {
  const { service } = makeService('workspace-write');
  const state = makeState(makeCtx({ service }), {});

  await runInbound(state, [{
    jsonrpc: '2.0',
    id: 17,
    method: '_qwenpaw/permission/set',
    params: { sessionId: 'session-1', preset: 'workspace-write' },
  }]);

  const result = state.sent[0]?.result;
  assert.equal(result?.permission_preset, 'workspace-write');
  assert.equal(result?.permission_preset_known, true);
  assert.equal(result?.default_permission_preset, 'read-only');
});

test('R09: qwenpaw/permission/get never falls back to the default', async () => {
  const { service } = makeService('read-only', { throwOnCurrent: true });
  const state = makeState(makeCtx({ service }), {});

  await runInbound(state, [{
    jsonrpc: '2.0',
    id: 18,
    method: 'qwenpaw/permission/get',
    params: { sessionId: 'session-1' },
  }]);

  const result = state.sent[0]?.result;
  assert.equal(result?.permission_preset, undefined);
  assert.equal(result?.permission_preset_known, false);
  assert.equal(result?.default_permission_preset, 'read-only');
  assert.equal(permissionSelect(result?.configOptions), undefined);
});

// ------------------------------------ G1b: initial preset must be read back
/**
 * Like `makeService`, but the fake session's actual preset can change on
 * `set()` and the read-back count is observable. This models a service whose
 * `set()` does not throw but may be a no-op (the defect under test).
 */
function makeTrackingService(initial, { apply = false, throwOnCurrent = false, withCurrent = true } = {}) {
  let actual = initial;
  const calls = { set: [], current: 0, catalog: 0 };
  const service = {
    catalog() {
      calls.catalog += 1;
      return RAW_CATALOG;
    },
    set(session, name) {
      calls.set.push({ session: session?.id, name });
      if (apply) actual = name;
    },
  };
  if (withCurrent) {
    service.current = () => {
      calls.current += 1;
      if (throwOnCurrent) throw new Error('session preset is not readable');
      return actual;
    };
  }
  return { service, calls };
}

async function initialPreset({
  method,
  requested = 'read-only',
  omitRequest = false,
  actual = 'danger-full-access',
  apply = false,
  throwOnCurrent = false,
  withCurrent = true,
  session,
  config = {},
} = {}) {
  const { service, calls } = makeTrackingService(actual, { apply, throwOnCurrent, withCurrent });
  const state = makeState(makeCtx({ service, session }), config);
  const { frame, meta } = await sessionExchange(state, { method, requested: omitRequest ? undefined : requested });
  return { frame, meta, calls };
}

const INITIAL_METHODS = ['session/new', 'session/resume'];

for (const method of INITIAL_METHODS) {
  test(`G1b: ${method} does not claim a no-op write was applied`, async () => {
    const { frame, meta, calls } = await initialPreset({ method });

    assert.deepEqual(calls.set, [{ session: 'session-1', name: 'read-only' }]);
    assert.equal(meta.requested_permission_preset, 'read-only');
    assert.equal(meta.permission_preset, 'danger-full-access', 'actual must be the real read-back');
    assert.equal(meta.permission_preset_known, true);
    assert.equal(meta.permission_preset_confirmed, false);
    assert.equal(meta.permission_preset_fallback, true);
    assert.equal(meta.default_permission_preset, 'read-only');
    assert.equal(permissionSelect(frame.result.configOptions)?.currentValue, 'danger-full-access');
    assert.equal(calls.current, 1, 'write and reply must share one read-back sample');
  });

  test(`G1b: ${method} reports unknown when current() throws`, async () => {
    const { meta, calls } = await initialPreset({ method, throwOnCurrent: true });

    assert.equal(calls.set.length, 1);
    assert.equal(meta.requested_permission_preset, 'read-only');
    assert.equal(meta.permission_preset, undefined);
    assert.equal(meta.permission_preset_known, false);
    assert.equal(meta.permission_preset_reason, 'read-failed');
    assert.equal(meta.permission_preset_confirmed, false);
    assert.equal(meta.permission_preset_fallback, true);
    assert.equal(calls.current, 1);
  });

  test(`G1b: ${method} reports unknown when the service has no current()`, async () => {
    const { meta, calls } = await initialPreset({ method, withCurrent: false });

    assert.equal(calls.set.length, 1);
    assert.equal(meta.permission_preset, undefined);
    assert.equal(meta.permission_preset_known, false);
    assert.equal(meta.permission_preset_reason, 'service-unreadable');
    assert.equal(meta.permission_preset_confirmed, false);
    assert.equal(meta.permission_preset_fallback, true);
  });

  test(`G1b: ${method} reports unknown when the session is missing`, async () => {
    const { meta, calls } = await initialPreset({ method, session: 'missing' });

    assert.equal(calls.set.length, 0, 'no write without a live session');
    assert.equal(meta.permission_preset, undefined);
    assert.equal(meta.permission_preset_known, false);
    assert.equal(meta.permission_preset_reason, 'session-unavailable');
    assert.equal(meta.permission_preset_confirmed, false);
    assert.equal(meta.permission_preset_fallback, true);
  });

  test(`G1b: ${method} reports unknown on an empty read-back`, async () => {
    const { meta, calls } = await initialPreset({ method, actual: '' });

    assert.equal(calls.set.length, 1);
    assert.equal(meta.permission_preset, undefined);
    assert.equal(meta.permission_preset_known, false);
    assert.equal(meta.permission_preset_reason, 'empty-value');
    assert.equal(meta.permission_preset_confirmed, false);
    assert.equal(meta.permission_preset_fallback, true);
  });

  test(`G1b: ${method} claims applied only when the read-back matches`, async () => {
    const { frame, meta, calls } = await initialPreset({ method, apply: true });

    assert.deepEqual(calls.set, [{ session: 'session-1', name: 'read-only' }]);
    assert.equal(meta.requested_permission_preset, 'read-only');
    assert.equal(meta.permission_preset, 'read-only');
    assert.equal(meta.permission_preset_known, true);
    assert.equal(meta.permission_preset_confirmed, true);
    assert.equal(meta.permission_preset_fallback, undefined);
    assert.equal(permissionSelect(frame.result.configOptions)?.currentValue, 'read-only');
    assert.equal(calls.current, 1, 'write and reply must share one read-back sample');
  });

  test(`G1b: ${method} honours permissionPresets:false without writing`, async () => {
    const { meta, calls } = await initialPreset({
      method,
      requested: 'danger-full-access',
      actual: 'read-only',
      config: { permissionPresets: false },
    });

    assert.equal(calls.set.length, 0);
    assert.equal(meta.requested_permission_preset, 'danger-full-access');
    assert.equal(meta.permission_preset, undefined);
    assert.equal(meta.permission_preset_known, false);
    assert.equal(meta.permission_preset_disabled, true);
    assert.equal(meta.permission_preset_confirmed, false);
    assert.equal(meta.permission_preset_fallback, true);
    assert.equal(meta.permission_presets, undefined);
  });

  test(`G1b: ${method} keeps the default distinct from the actual without a request`, async () => {
    const { frame, meta } = await initialPreset({ method, omitRequest: true, actual: 'workspace-write' });

    assert.equal(meta.requested_permission_preset, undefined);
    assert.equal(meta.permission_preset, 'workspace-write');
    assert.equal(meta.permission_preset_known, true);
    assert.equal(meta.permission_preset_confirmed, undefined);
    assert.equal(meta.permission_preset_fallback, undefined);
    assert.equal(meta.default_permission_preset, 'read-only');
    assert.equal(permissionSelect(frame.result.configOptions)?.currentValue, 'workspace-write');
  });
}
