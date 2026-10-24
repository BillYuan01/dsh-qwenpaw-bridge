# Optional fake-only diagnostics

These source-checkout tools are not bridge runtime components and are not in
the npm package. They are diagnostic samples, not installers, security checks,
or a proven fix for model discovery. No model is prompted by either probe.
DSH/profile startup can still load plugins, resolve credentials, write local
state, or contact services; a no-prompt probe is not a no-side-effects guarantee.
Do not run these against a live profile or use them as a credential test.

## Prerequisites and isolation

Use a disposable, **already configured** DSH home containing a `qwenpaw` ACP
profile and fake credentials only. The catalog probe does not install a
profile or repair missing dependencies. Existing isolated-profile tests relied
on preconfigured **absolute links** to installed package/dependency locations;
these probes do not demonstrate clean-machine installation or portable links.
Recreate those links for the local checkout if needed, never to credential
files. **Never link or copy live secrets** into a test home, including `.env`
or `.credentials.yaml`. Do not call `test/spike_lib.py`'s `prepare_home` helper:
it can link a live store; the catalog probe only imports the ACP helpers it
needs and does not call it.

Run with a sanitized environment: fake `HOME`, explicit fake `DSH_HOME`, an
allowlisted `PATH`, and no inherited provider keys, tokens, `NODE_OPTIONS`, or
other application configuration. Use a network-isolated environment and
fake/non-network provider adapters where practical. Profile/plugin code is
executable code; inspect it before booting. Installation/network operations
are separate manual steps, not something these instructions perform.

## Catalog timing sample

Requires Python >=3.10, the official ACP Python SDK (`acp`) in the selected
Python environment, and a compatible DSH CLI on `PATH`. It imports the sibling
`test/spike_lib.py` relative to this checkout, not a user-specific path.
Given an existing fake profile, use absolute paths in this example:

```sh
# All /path/to/... entries must be replaced with disposable/local paths.
env -i HOME=/path/to/fake-user-home PATH=/path/to/allowlisted-bin \
  DSH_HOME=/path/to/fake-dsh-home \
  /path/to/python diagnostics/catalog-probe.py \
  /path/to/fake-dsh-home /path/to/fake-workdir fake-only 2
```

The probe initializes ACP, opens a session, waits (default two seconds), opens
a second session, then closes both. It reports bridge/catalog metadata at
initialize and the two sessions, plus config-option identifiers. It sends no
prompt. Distinct samples do **not** prove discovery causality: registration,
caching, profile configuration, or timing may explain a difference, and an
unchanged result cannot rule those out.

## Credential-service sampling plugin

`credential-service-probe/` is a private optional DSH bundle, not a published
package. Manually configure it only in the disposable fake profile. Its
`cordis.patch.yml` adds `diag-cred-probe`; never merge it into a live profile.
Set `DIAG_OUT` to a fresh path inside the disposable test directory before
booting. Otherwise the sample defaults to `/tmp/diag-cred-report.json`, which
is not an isolated per-run path and could collide with another run.

The plugin samples `credentials.describe` and `credentials.resolve` at apply
and after 1200 ms. It records service availability, configuration/source flags,
resolved-value length, and whether the environment variable exists, not the
value. Resolving a credential still reads it internally, so **fake values only**.
Sampling does not establish when the model catalog discovered a key. Errors
are captured as truncated service messages and report-write errors are
silently ignored: absent output is not evidence of service absence or success.

## Output handling and limits

The optional probes may print local paths or write paths, provider/model IDs,
and service error messages into reports. Service errors are not guaranteed to
be secret-free. **Never upload raw output**; review and redact it separately.
Do not put generated diagnostic reports, private incident notes, manifests, or
cloud verification output into this repository. Publication checks compile
these files and syntax-check the plugin only; they do not execute DSH, boot a
profile, resolve credentials, or certify the probes against live services.
