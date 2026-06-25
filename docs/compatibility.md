# OpenClaw Compatibility Matrix

This matrix is the supported release target for `agenticdome-openclaw-security`.

| AgenticDome OpenClaw SDK | Node.js | OpenClaw CLI | Compatibility status | Verification |
| --- | --- | --- | --- | --- |
| 0.1.8 | >=22.19.0 | 2026.6.10 | Supported | Real OpenClaw CLI smoke passed on 2026-06-24 |
| 0.1.8 | >=22.19.0 | latest | Supported when `latest` resolves to a CLI compatible with the hooks below | Admin SDK harness resolves `openclaw@latest`, caches the resolved version, and verifies runtime load |
| 0.1.8 | <22.19.0 | any | Unsupported | OpenClaw runtime requirement is not met |

## Required OpenClaw Contracts

The plugin is compatible when OpenClaw can install the package and runtime inspection reports:

```text
status: loaded
hook_count: 3
typed_hooks:
  - before_agent_run
  - before_tool_call
  - tool_result_persist
policy.allowConversationAccess: true
```

## Version Policy

- Node.js is pinned by engine requirement: `>=22.19.0`.
- OpenClaw CLI defaults to `OPENCLAW_CLI_VERSION=latest` in the admin harness.
- The admin harness resolves `openclaw@latest` to a concrete version, installs it into `.harness_runtime_ts/<fingerprint>/openclaw_cli`, and reuses that cached CLI until npm reports a different latest version.
- Set `OPENCLAW_CLI_VERSION=2026.6.10` to pin the harness to the currently verified CLI version.
- A release is not production-ready until `npm run test:openclaw-cli` and `npm run test:live-tenant` both pass in release CI.

## Adding New OpenClaw Versions

1. Set `OPENCLAW_CLI_VERSION=<candidate>`.
2. Run `npm run test:openclaw-cli`.
3. Run `npm run test:live-tenant` with a real AgenticDome tenant.
4. Add a new row to this matrix with the result and date.
5. Only mark the version supported if all three typed hooks load and live policy calls pass.
