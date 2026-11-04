# Security reporting

GitHub Private Vulnerability Reporting is enabled for this repository.
[Report a vulnerability privately](https://github.com/warsclon/harness_config_studio/security/advisories/new)
using your GitHub account. Do not post vulnerabilities or configuration contents
in public issues.

Provide the affected commit or package version, Node.js version, operating system,
reproduction steps using fictitious data, and the expected impact. Never include
real credentials or personal Agent Configuration Artifacts.

## Supported versions

Only the latest published minor version receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Verifying a package

Published versions carry npm provenance. After installing the package, verify its
registry signatures and attestations with `npm audit signatures`.
