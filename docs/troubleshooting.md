# Troubleshooting

## Node Runtime

OpenClaw requires Node.js `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`. The admin SDK harness searches these sources in order:

1. `NODE_BINARY` (or the older `NODE22_BINARY` alias)
2. host `node`
3. compatible cached Node binaries under `.harness_runtime_ts/npm-cache`
4. nvm, fnm, asdf, and Volta install paths
5. `/usr/local/bin/node`, `/opt/node/bin/node`, `/opt/nodejs/bin/node`
6. `npx -y -p node@<compatible-major> node`, derived from the candidate OpenClaw package's `engines.node`

If resolution fails, install a Node release accepted by the displayed `engines.node` range or set `NODE_BINARY` to its absolute path. The Laravel release service uses `AGENTICDOME_NODE_BINARY`.

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
export OPENCLAW_CLI_VERSION="2026.7.1-2"
```

## Required OpenClaw Hook Consent

The plugin needs conversation access for prompt ingress scanning. Enable it with:

```bash
openclaw config set plugins.entries.agenticdome-security.hooks.allowConversationAccess true
```

If `before_agent_run` is missing from inspection, this consent setting is usually the issue.
