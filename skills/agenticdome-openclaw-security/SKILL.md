---
name: agenticdome-openclaw-security
description: "Use AgenticDome policy checks when building or operating OpenClaw plugins and skills that call tools, delegate work, or persist sensitive outputs."
homepage: "https://au.agenticdome.io"
metadata:
  openclaw:
    requires:
      bins: ["node", "npm"]
---

# AgenticDome OpenClaw Security

Use this skill when an OpenClaw plugin, agent, or skill performs one of these actions:

- Runs a tool or external API with user-provided arguments.
- Delegates work from a manager agent to a specialist agent.
- Writes tool results or customer data to the session transcript.
- Handles secrets, credentials, PII, refunds, account changes, exports, or admin actions.

## Runtime Requirements

Use Node.js `>=22.19.0`, matching current OpenClaw runtime requirements. Verify the plugin with the real OpenClaw CLI before production rollout.

## Required Runtime Variables

Configure these in the OpenClaw runtime environment, not inside source code:

```bash
export AGENTICDOME_API_BASE="https://your-assigned-sidecar.example"
export AGENTICDOME_API_KEY="..."
export AGENTICDOME_TENANT_ID="..."
```

Use the API base supplied for the tenant's managed regional or contracted
Sovereign deployment. The plugin does not require customer-managed Redis.

## Skill Developer Pattern

When a skill receives `_decision_token` and `_source_agent_id`, preserve those fields until the protected tool call reaches the AgenticDome OpenClaw plugin. Do not log those fields, copy them into public responses, or persist them as user-visible output.

For direct use inside custom runtimes, wrap high-risk work with `OpenClawFirewall.protectedExecute()` so the same policy checks run before execution and before returning output.

## Security Expectations

- Treat missing session IDs as a deployment error unless your tenant policy explicitly allows anonymous sessions.
- Use tenant-scoped API keys only.
- Keep tool argument schemas narrow; do not pass whole session history into tool arguments unless required.
- Return structured tool results with `content: [{ type: "text", text: "..." }]` when possible so OpenClaw transcript redaction can preserve shape.

## OpenClaw Runtime Setup

After installing the plugin, enable conversation hook access so `before_agent_run` can inspect prompts:

```bash
openclaw config set plugins.entries.agenticdome-security.hooks.allowConversationAccess true
```

Without this setting, OpenClaw loads `before_tool_call` and `tool_result_persist`, but blocks `before_agent_run` for non-bundled plugins.

## Verification

Run the package checks from the SDK directory:

```bash
npm run typecheck
npm test
OPENCLAW_REPO_PATH=/path/to/openclaw npm run test:openclaw-real
```
