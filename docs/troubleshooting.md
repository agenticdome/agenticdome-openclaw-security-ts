# Troubleshooting

## Node Runtime

OpenClaw requires Node.js `>=22.19.0`. The admin SDK harness searches these sources in order:

1. `NODE_BINARY` or `NODE22_BINARY`
2. host `node`
3. cached `node@22` binaries under `.harness_runtime_ts/npm-cache`
4. nvm, fnm, asdf, and Volta install paths
5. `/usr/local/bin/node`, `/opt/node/bin/node`, `/opt/nodejs/bin/node`
6. `npx -y -p node@22 node`

If resolution fails, install Node 22 or set `NODE22_BINARY` to an absolute path.

## npm and npx Under Web Runners

The Laravel admin runner may not inherit an interactive shell `PATH`. The harness now adds `/usr/local/bin:/usr/bin:/bin` and resolves `npm` and `npx` to absolute paths. Override with:

```bash
export NPM_BINARY="/usr/bin/npm"
export NPX_BINARY="/usr/bin/npx"
```

## OpenClaw CLI Downloads

The harness does not download OpenClaw every run. It resolves `openclaw@latest` to a concrete version, installs it into `.harness_runtime_ts/<fingerprint>/openclaw_cli`, and reuses the cached copy until npm reports a newer latest version.

Pin a version with:

```bash
export OPENCLAW_CLI_VERSION="2026.6.10"
```

## Required OpenClaw Hook Consent

The plugin needs conversation access for prompt ingress scanning. Enable it with:

```bash
openclaw config set plugins.entries.agenticdome-security.hooks.allowConversationAccess true
```

If `before_agent_run` is missing from inspection, this consent setting is usually the issue.
