/**
 * Permission-preset projection and hot switching.
 *
 * `ctx.permissionPresets` is a public DSH service, but it is mounted by
 * dsh-base rather than by dsh-acp. The bridge therefore treats it as an
 * optional capability: present -> advertise/switch; absent -> do nothing and
 * keep the plain ACP surface.
 */

import { PERMISSION_CONFIG_ID } from './protocol.js';

/** Read the optional service without turning a missing mount into a crash. */
export function presetService(ctx) {
  try {
    return typeof ctx.get === 'function' ? ctx.get('permissionPresets') : undefined;
  } catch (_missingService) {
    return undefined;
  }
}

/** Return the process catalog in the bridge's stable `_meta` shape. */
export function presetCatalog(ctx) {
  const service = presetService(ctx);
  if (service === undefined || typeof service.catalog !== 'function') return undefined;
  try {
    const catalog = service.catalog();
    const options = Array.isArray(catalog?.options)
      ? catalog.options
        .filter((option) => typeof option?.value === 'string' && option.value.length > 0)
        .map((option) => ({
          id: option.value,
          name: typeof option.name === 'string' ? option.name : option.value,
          ...(typeof option.description === 'string' ? { description: option.description } : {}),
        }))
      : [];
    if (options.length === 0) return undefined;
    return {
      options,
      default: typeof catalog.defaultPreset === 'string' ? catalog.defaultPreset : options[0].id,
    };
  } catch (error) {
    return { error: String(error) };
  }
}

/**
 * Read one session's actual preset, keeping "unknown" strictly separate from
 * the catalog default.
 *
 * `catalog.defaultPreset` is a process-wide fallback owned by the profile; it
 * is never evidence about a live session. Callers that need a session fact
 * must go through this function and must not substitute the default when
 * `known` is false.
 *
 * @returns {{known: true, value: string} | {known: false, reason: string}}
 */
export function presetState(ctx, sessionId) {
  const service = presetService(ctx);
  if (service === undefined) return { known: false, reason: 'service-unavailable' };
  if (typeof service.current !== 'function') return { known: false, reason: 'service-unreadable' };
  const session = lookupSession(ctx, sessionId);
  if (session === undefined) return { known: false, reason: 'session-unavailable' };
  try {
    const value = service.current(session);
    if (typeof value === 'string' && value.length > 0) return { known: true, value };
    return { known: false, reason: 'empty-value' };
  } catch (_notReadable) {
    return { known: false, reason: 'read-failed' };
  }
}

/**
 * Compare one read-back snapshot with the preset a client requested.
 *
 * A write only counts as applied when the snapshot is known and its value is
 * exactly the requested one. An unknown read-back (missing service/method/
 * session, a throw, or an empty value) and a different value are both
 * unconfirmed; callers must not substitute the catalog default.
 *
 * `snapshot` is the result of `presetState`, so callers can take one sample
 * and reuse it for the config option and `_meta` without sampling again.
 *
 * @returns {{confirmed: boolean, known: boolean, actual: string|undefined, reason: string|undefined}}
 */
export function comparePresetSnapshot(snapshot, expected) {
  if (snapshot === undefined || snapshot.known !== true) {
    return {
      confirmed: false,
      known: false,
      actual: undefined,
      reason: snapshot?.reason ?? 'unreadable',
    };
  }
  const confirmed = snapshot.value === expected;
  return {
    confirmed,
    known: true,
    actual: snapshot.value,
    reason: confirmed ? undefined : 'mismatch',
  };
}

/**
 * Current preset for one live session, or undefined when it cannot be read.
 * Kept for callers that only need the value; do not use it to fill in a
 * default — see `presetState`.
 */
export function currentPreset(ctx, sessionId) {
  const state = presetState(ctx, sessionId);
  return state.known ? state.value : undefined;
}

/**
 * Switch one session's preset through the service's canonical write path.
 * @returns `{ok: true}` or `{ok: false, error}`; never throws.
 */
export function switchPreset(ctx, sessionId, name) {
  const service = presetService(ctx);
  if (service === undefined || typeof service.set !== 'function') {
    return { ok: false, error: 'permission presets are not available in this profile' };
  }
  const session = lookupSession(ctx, sessionId);
  if (session === undefined) return { ok: false, error: `unknown session: ${sessionId}` };
  if (typeof name !== 'string' || name.length === 0) return { ok: false, error: 'permission preset must be a non-empty string' };
  try {
    service.set(session, name);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}

/** All currently selectable preset ids, used for lightweight validation. */
export function availablePresets(catalog) {
  return new Set((catalog?.options ?? []).map((option) => option.id));
}

/**
 * Append (or replace) the `permission_mode` select in a session's complete
 * config-option array. The current value comes from the service projection,
 * never from a cached guess, so an external `/permission` switch is reflected.
 *
 * When the actual value is unknown — or is not one of the advertised options —
 * the whole select is omitted. A `select` needs a truthful `currentValue`, and
 * `catalog.default` is a default, not a session fact; omitting the option is
 * the only honest shape. An explicit `default_permission_preset` stays
 * available in `_meta.qwenpaw` for clients that want the fallback.
 *
 * `snapshot` lets one response reuse the exact read-back that was already
 * taken (for example after an initial-preset write) instead of sampling the
 * service a second time and risking a different value in the same reply.
 */
export function decorateConfigOptions(ctx, options, sessionId, catalog, snapshot) {
  const base = Array.isArray(options) ? options.filter((option) => option?.id !== PERMISSION_CONFIG_ID) : [];
  if (catalog === undefined || Array.isArray(catalog?.options) === false || catalog.options.length === 0) return base;
  const presetOptions = catalog.options;
  const state = snapshot ?? presetState(ctx, sessionId);
  if (!state.known) return base;
  if (!presetOptions.some((option) => option.id === state.value)) return base;
  return [...base, {
    id: PERMISSION_CONFIG_ID,
    name: 'Permission mode',
    category: 'permission',
    type: 'select',
    currentValue: state.value,
    options: presetOptions.map((option) => ({
      value: option.id,
      name: option.name,
      ...(option.description === undefined ? {} : { description: option.description }),
    })),
  }];
}

function lookupSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined;
  try {
    return typeof ctx.sessions?.get === 'function' ? ctx.sessions.get(sessionId) : undefined;
  } catch (_missingSession) {
    return undefined;
  }
}
