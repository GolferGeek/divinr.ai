# Security Policy

Divinr.ai is an open-source codebase under active product development. Production secrets, hosted infrastructure, private data, and deployment credentials are not part of this repository.

## Reporting a Vulnerability

Please report security concerns privately to the project maintainer through the same channel that gave you access to this repository. If you are reviewing the repository for a contract, diligence, or funding conversation, include "Security" in the subject or first line so it can be routed quickly.

Please include:

- A short description of the issue.
- Steps to reproduce, if applicable.
- The affected area, such as API, web app, billing, authentication, data access, or local development.
- Any relevant logs, screenshots, or proof-of-concept details that do not expose third-party secrets or private user data.

## Scope

In scope:

- Authentication and authorization defects.
- Tenant or organization data isolation issues.
- Secret handling problems.
- Billing lifecycle or webhook validation issues.
- Unsafe schema mutation paths.
- Cross-site scripting, injection, or request forgery risks.
- Dependency vulnerabilities with a practical exploit path.

Out of scope:

- Public information already present in this repository.
- Missing production hardening for infrastructure that is not included here.
- Vulnerabilities that require committed local `.env` secrets, private deployment credentials, or private datasets not present in the repository.
- Denial-of-service reports against local development services.

## Local Secrets

Do not commit `.env`, API keys, Stripe secrets, LLM provider credentials, database credentials, Playwright storage state, or generated production artifacts containing private data.

The example environment file intentionally leaves optional third-party credentials blank. Stripe and LLM-backed paths are designed to no-op or use local defaults when optional credentials are absent.

## Supported Versions

This repository is pre-1.0 and under active development. Security fixes are expected to land on the active development branch unless a separate release branch is established.
