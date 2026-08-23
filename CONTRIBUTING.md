# Contributing to the AgenticDome OpenClaw Security Plugin

## Local verification

Use Node.js `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`, then run:

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

## Plugin and example changes

- Use public OpenClaw hooks and stable public AgenticDome client interfaces.
- Add or update tests for every behavior change.
- Examples must use placeholder credentials and synthetic data, show both allowed and blocked outcomes, and identify the protected OpenClaw lifecycle boundary.
- Do not publish private endpoints, tenant evidence, detection rules, internal policy logic, or server-side implementation.

## Pull requests and security reports

Explain the user-visible behavior, security impact, test results, and compatibility implications. Security-sensitive changes require maintainer review and may require design changes before merge. By submitting a contribution, you agree that it is provided under the repository's Apache-2.0 license.

Use the public [issue tracker](https://github.com/agenticdome/agenticdome-openclaw-security-ts/issues) for ordinary defects. Report vulnerabilities privately to **info@agenticdome.io** under [SECURITY.md](SECURITY.md).
