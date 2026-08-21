# Live Tenant Testing

`npm test` covers local behavior, package build, real OpenClaw CLI install/inspect, and compatibility checks that do not require production credentials.

`npm run test:live-tenant` is the release gate that verifies this SDK talks to a real AgenticDome tenant through live policy APIs.

## Required Environment

```bash
export AGENTICDOME_API_BASE="https://your-assigned-sidecar.example"
export AGENTICDOME_TENANT_ID="<tenant_id>"
export AGENTICDOME_API_KEY="<tenant_api_key>"
```

Use the API base supplied for the tenant. Managed deployments use an assigned
sidecar in the selected supported geographic region, subject to availability;
Sovereign deployments use the endpoint inside the contracted
customer-controlled environment. This test and plugin do not require
customer-managed Redis.

For strict security-policy release gates, add:

```bash
export AGENTICDOME_LIVE_EXPECT_STRICT="1"
```

Strict mode expects:

- prompt injection text is `BLOCKED`
- unauthorized high-risk refund tooling is `BLOCKED`
- sensitive output is redacted or blocked

Without strict mode, the test verifies live API reachability and parseable policy results while allowing tenant-specific policies to return `ALLOWED`, `BLOCKED`, or `REDACTED`.

## Command

```bash
npm run test:live-tenant
```

The command builds the SDK and executes `test/live-tenant.test.mjs` with `AGENTICDOME_LIVE_TENANT_TEST=1`.

## What It Covers

- Prompt ingress guardrail through `OpenClawFirewall.screenPrompt()`
- Direct tool authorization through `OpenClawFirewall.authorizeDirectSkill()`
- Output DLP through `OpenClawFirewall.sanitizeOutput()`

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Missing required live test environment variables` | One or more credentials are absent | Export `AGENTICDOME_API_BASE`, `AGENTICDOME_TENANT_ID`, and `AGENTICDOME_API_KEY` |
| HTTP 401 or 403 | API key does not belong to the tenant or region | Verify tenant ID, key, and API base region |
| Prompt injection returns `ALLOWED` in strict mode | Tenant policy is too permissive for the release gate | Tighten tenant policy or run without `AGENTICDOME_LIVE_EXPECT_STRICT=1` for contract-only validation |
| Output still contains secrets in strict mode | DLP policy is disabled or redaction is not enabled | Enable secret and PII redaction for the tenant |
| Network timeout | Runner cannot reach the AgenticDome API base | Check firewall, DNS, proxy, and regional API base |
