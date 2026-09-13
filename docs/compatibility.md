# OpenClaw Compatibility Matrix

This file is maintained by the Admin SDK Harness certification workflow. The exact AgenticDome plugin version is resolved from the immutable npm candidate and is deliberately not duplicated here.

| Certified boundary | Node.js | OpenClaw CLI | Status |
| --- | --- | --- | --- |
| Certified floor | `>=24.16.0 <25 || >=26.1.0` | 2026.7.1-2 | Preserved compatibility floor |
| Certified ceiling | `>=24.16.0 <25 || >=26.1.0` | 2026.9.4 | Current compatibility ceiling |

Certified support: `2026.7.1-2` through `2026.9.4`. Both endpoints must pass real CLI installation, exact typed-hook inspection, Node-engine validation, local firewall cases, package build and dependency checks before this range is extended.

Required hooks: `before_agent_run`, `before_tool_call`, `tool_result_persist`. The plugin must load with `policy.allowConversationAccess=true`.
