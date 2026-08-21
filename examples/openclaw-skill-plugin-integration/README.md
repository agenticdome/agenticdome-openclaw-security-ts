# OpenClaw Skill Integration Example

This is a minimal copyable pattern for OpenClaw developers who want both plugin-level protection and explicit high-risk skill protection.

## Install

```bash
npm install
```

## Configure

```bash
export AGENTICDOME_API_BASE="https://your-assigned-sidecar.example"
export AGENTICDOME_TENANT_ID="<tenant_id>"
export AGENTICDOME_API_KEY="<tenant_api_key>"
export AGENTICDOME_REQUIRE_SESSION_ID="true"
export AGENTICDOME_FAIL_CLOSED="true"
```

The API base is supplied for the tenant's managed regional or contracted
Sovereign deployment. Normal plugin use does not require customer-managed
Redis.

Install the runtime plugin:

```bash
openclaw plugins install npm:agenticdome-openclaw-security
openclaw plugins enable agenticdome-security
openclaw config set plugins.entries.agenticdome-security.hooks.allowConversationAccess true
```

Use `OpenClawFirewall.protectedExecute()` inside high-risk skills so tool arguments and returned output are governed by AgenticDome policy even when the skill is invoked outside the global plugin path.

## Run the Example

```bash
npm start
```

The example calls a mock customer risk skill through `protectedExecute()`. In a strict tenant, high-risk requests can be blocked before execution. Output is passed through DLP before being returned.
