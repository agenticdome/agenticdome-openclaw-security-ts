# OpenClaw Compatibility Matrix

This file is maintained by the Admin SDK Harness certification workflow.

| AgenticDome plugin | Node.js | OpenClaw CLI | Status |
| --- | --- | --- | --- |
| 1.0.4 | `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0` | 2026.7.1-2 | Certified compatibility floor |
| 1.0.4 | `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0` | 2026.8.1 | Certified compatibility ceiling |

Certified support: `2026.7.1-2` through `2026.8.1`. Both endpoints must pass real CLI installation, exact typed-hook inspection, Node-engine validation, local firewall cases, package build and dependency checks before this range is extended.

Required hooks: `before_agent_run`, `before_tool_call`, `tool_result_persist`. The plugin must load with `policy.allowConversationAccess=true`.
