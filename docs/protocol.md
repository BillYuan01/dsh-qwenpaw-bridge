# ACP extension protocol

This document describes bridge 1.1.0 and `_meta.qwenpaw.protocol = 1`.
The transport remains NDJSON / JSON-RPC ACP over stdio, using official dsh-acp.
Clients that do not understand the extensions can ignore the added metadata
and continue using standard ACP.

## Metadata and model catalog

initialize, session/new, and session/resume responses add information under
`result._meta.qwenpaw`. This illustrative initialize fragment is not a complete
ACP response; its model and provider values are placeholders:

```json
{
  "_meta": {
    "qwenpaw": {
      "protocol": 1,
      "bridge": "dsh-qwenpaw-bridge",
      "version": "1.1.0",
      "streaming": true,
      "models": [
        {
          "id": "example-model",
          "name": "Example model",
          "provider": "example-provider",
          "provider_name": "Example provider",
          "selection_value": "[\"example-provider\",\"example-model\"]",
          "reasoning_efforts": [{"id": "high", "name": "High"}],
          "default_reasoning_effort": "high",
          "default": true
        }
      ],
      "current_model": {"provider": "example-provider", "model": "example-model"},
      "permission_presets": [{"id": "read-only", "name": "read-only"}],
      "default_permission_preset": "read-only",
      "permission_preset_known": false,
      "permission_preset_reason": "session-unavailable",
      "initialized": true
    }
  }
}
```

**initialize has no session and reports no actual `permission_preset`.**
The read-only default above is just an example profile value, not evidence of
later session permissions. `initialized` appears only in initialize responses;
new/resume read the current model and permissions for the session.

Model field conventions:

- Identity is the provider/model pair. Do not match model IDs across providers
  without checking the provider.
- `selection_value` is `[provider, model]` encoded as a JSON string.
- `reasoning_efforts` is always an array; it may be empty when details are
  unavailable.
- Optional fields include description, context_window, max_tokens,
  input_modalities, and default_reasoning_effort.
- `current_model` may include reasoning_effort. `default` marks catalog entries
  matching the current selection.
- Expect exactly one default only when the current route is present and its
  identity is unique in the catalog.
- Model counts depend on deployment; the catalog may be empty. `models: false`
  omits the models field.
- The catalog is cached per connection and invalidated by `llm/adapters-updated`.
- Query failure may skip a failed provider, retain models without optional
  details, or return an empty catalog. None of these guarantees model usability.

## Permission state

| Field | Meaning |
| --- | --- |
| `default_permission_preset` | Process-level profile default, not a session fact |
| `permission_preset` | Actual preset read back from this session; present only when known |
| `permission_preset_known` | Whether the actual value is known |
| `permission_preset_reason` | Why the actual value is unknown, such as service-unavailable, session-unavailable, or read-failed |
| `requested_permission_preset` | Initial preset requested by the client for new/resume |
| `permission_preset_confirmed` | Whether read-back matches the initial request; omitted without a request |
| `permission_preset_fallback` | True when the initial request was not confirmed as applied |
| `permission_preset_disabled` | True when the bridge's permission-preset feature is disabled |

Never substitute the default for the actual value when the service is
unavailable, its current method is missing, the session is unavailable, or
read-back is empty or throws. Add the standard config option only when the
actual value is known and present in the preset catalog:

```json
{
  "id": "permission_mode",
  "name": "Permission mode",
  "category": "permission",
  "type": "select",
  "currentValue": "read-only",
  "options": [{"value": "read-only", "name": "read-only"}]
}
```

If the actual value is outside the catalog, retain it in metadata but omit the
select. read-only is a DSH permission preset, not a path allowlist; the bridge
does not define which files can be read.

## Permission switching

Prefer the standard ACP config method. This method/params fragment uses a
synthetic session ID:

```json
{"method":"session/set_config_option","params":{"sessionId":"example-session","configId":"permission_mode","value":"read-only"}}
```

The standard entry also accepts `permission_preset` and `permissionPreset` as
configId aliases. Extension methods are listed below. The ACP SDK adds a
leading `_`; the bridge accepts names with or without it.

| Method | Parameters | Result |
| --- | --- | --- |
| `qwenpaw/permission/set` | sessionId, preset | Confirmed actual value, catalog, and configOptions |
| `qwenpaw/permission/get` | sessionId | actual/known, catalog, and configOptions; no default substitution when unknown |
| `qwenpaw/streaming/set` | enabled | Streaming state for the current connection |

permission/set also accepts permission_preset and permissionPreset as preset
parameter aliases. Unknown `qwenpaw/*` methods return `-32601`.

An explicit switch requires a valid service, session, and preset. The standard
entry additionally checks catalog membership. A non-throwing `service.set()`
only completes the write call; **success requires read-back matching the
request**. Unreadable or mismatching state returns `-32602`, with error.data:

- `permission_preset_written: true` and `permission_preset_confirmed: false`;
- `permission_preset_reason` when unreadable, or `permission_preset_actual`
  when mismatched.

Clients must stop and re-read permissions, not treat the error as a completed
switch or automatically escalate privileges. Direct switching through the
bridge does not restart its process. Whether QwenPaw restarts a worker when
changing its own approval level is QwenPaw-side behavior.

### Initial requests and disabling the feature

new/resume may request an initial preset in
`params._meta.qwenpaw.permission_preset`. permissionPreset and permission_mode
are also accepted, as are the corresponding aliases under bare `_meta`.
The request is not an enforced precondition: a session may still be created if
it cannot be applied, returning the requested value, confirmed=false, and
fallback=true. Safety-sensitive clients must verify actual/known/confirmed and
withhold prompts when requirements are not met.

`permissionPresets: false` does more than hide a config option:

- No preset catalog is advertised; actual is unknown and disabled=true.
- Standard permission_mode and its aliases return `-32602`; extension
  permission/set and permission/get return `-32601`.
- These requests are rejected locally, never forwarded to stock ACP, with zero
  preset-service writes.
- An initial request may still fall back. The switch disables the bridge's own
  hot-switch surface, not every DSH/stock permission feature.
- DSH still controls profile defaults. Do not infer that the session is read-only.

## Streaming and other notifications

`agent/assistant-stream` text-delta and reasoning-delta events project to
standard `agent_message_chunk` and `agent_thought_chunk` updates, respectively.
Only sessions owned by the current connection are processed. Separate text and
reasoning flags for each model attempt suppress the corresponding committed
text copies. Flags survive end until the next start so queued committed
messages do not append duplicate text. Image, tool, usage, and other updates
are not discarded as a result.

initialize with `params._meta.qwenpaw.streaming: false` disables live output
for the connection. Extension streaming/set changes connection state. Profile
configuration `streaming: false` prevents installing the live subscription
altogether; later toggling connection state does not create that subscription.
Missing live events, subscription failure, or disabling live preserves the
committed path. `streaming: true` means enabled, not proof that deltas arrived,
and does not promise reliable replay after a write failure.

Tool categorization adds read/edit/execute/search/fetch only for known tool
names and preserves existing non-other categories. It is not authorization.
Metadata-decoration errors forward the original frame: this is an availability
fallback, not evidence that permission requirements were met. Catalog and
streaming degradation may be **fail-soft**; clients must handle failed
permission requests and initial fallback **fail-closed**.
