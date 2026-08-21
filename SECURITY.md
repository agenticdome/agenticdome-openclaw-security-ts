# Security Policy

Report suspected vulnerabilities in this OpenClaw plugin or its AgenticDome integration privately to **info@agenticdome.io**, or through a private security advisory in the upstream package repository.

Do not include production API keys, tenant secrets, customer records, or OpenClaw transcripts in public issues. Include a minimal reproduction, package version, OpenClaw version or commit, and the expected policy outcome.

Do not open a public issue for a vulnerability. AgenticDome will acknowledge the report, assess impact, coordinate remediation, and discuss disclosure timing with the reporter.

## Runtime Notes

The OpenClaw `tool_result_persist` hook is synchronous. This package therefore performs local no-network transcript redaction in that hook and uses the AgenticDome API for async prompt, tool, delegation, and direct firewall DLP checks.
