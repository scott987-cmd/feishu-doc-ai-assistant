> 🌐 **English** | [中文](CONTRIBUTING.md)

# Contributing

Thanks for considering a contribution to **Feishu Document AI Assistant**! This is a Chrome **MV3** extension: **no backend**, every operation runs as the **user's own Feishu identity**. We welcome issues, PRs, docs, and translations.

> Released under the **[Elastic License 2.0](LICENSE)**: free to use / modify / self-host (including internal commercial use), but you may **NOT** offer it to third parties as a hosted / SaaS service. By contributing, you agree your contribution is released under the same license.

---

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Getting started (required reading)](#getting-started-required-reading)
- [Security boundaries you must not break](#security-boundaries-you-must-not-break)
- [Opening a pull request](#opening-a-pull-request)
- [Commit conventions](#commit-conventions)
- [Reporting security vulnerabilities](#reporting-security-vulnerabilities)
- [Scope & non-goals](#scope--non-goals)

---

## Code of conduct

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md). Be professional and kind.

## Ways to contribute

- 🐞 **Bug reports** — open an [Issue](https://github.com/scott987-cmd/feishu-doc-ai-assistant/issues) with repro steps and environment (Chrome version, SaaS vs private Feishu domain, extension version).
- 💡 **Feature proposals** — open an Issue to align on direction before building.
- 🔧 **Code PRs** — fixes, features, tests, performance.
- 📖 **Docs** — the bilingual docs under `docs/` (deployment / development / architecture / security), `README`, FAQ.
- 🌍 **Translations** — keep zh/en in sync (every `X.md` should have a matching `X.en.md`).

> For commercial licensing (resale / offering as a SaaS — uses restricted by the license), use the [commercial issue template](https://github.com/scott987-cmd/feishu-doc-ai-assistant/issues/new?template=commercial.md), not a regular issue.

## Getting started (required reading)

The full developer guide is **[`docs/DEVELOPMENT.en.md`](docs/DEVELOPMENT.en.md)** (repo map, data flow, recipes, pitfalls). The minimal loop:

```bash
npm install                 # first time
# —— edit code under src/ ——
npm run typecheck           # ① must be 0 errors (tsc --noEmit)
npm test                    # ② must be all green (vitest); add tests for new logic
npm run build               # ③ must succeed (occasional TLS flake → retry)
npm run test:ui             # ④ only if you changed the side-panel UI (puppeteer smoke)
npm run validate:server     # ⑤ only if you changed docs/*-proxy-server.mjs / docs/admin-*
```

**"Done" = ①②③ all pass** (add ④ for UI, ⑤ for the enterprise servers). **typecheck / test not passing is not done.**

- Preview the side panel without a real extension: `npm run dev:ui` (`chrome-mock` stubs `chrome.*`).
- On-device: `chrome://extensions` → Developer mode → Load `dist/` → open a Feishu page side panel.
- Architecture: [`docs/ARCHITECTURE.en.md`](docs/ARCHITECTURE.en.md); edition differences (SaaS / private / enterprise): [`docs/PRIVATE_DEPLOYMENT.en.md`](docs/PRIVATE_DEPLOYMENT.en.md).

## Security boundaries you must not break

These are **hard-coded security boundaries** and the core promise to enterprise users. Any PR that touches them **must preserve the semantics and add tests**; see [`docs/SECURITY_AUDIT.en.md`](docs/SECURITY_AUDIT.en.md):

1. **User identity only** — `auth.ts` `resolveToken` never falls back to a tenant token.
2. **File-level delete is always refused** — `agent.ts` `isFileLevelDelete`; content deletion goes through a confirmation gate (`DESTRUCTIVE_TOOLS`).
3. **General-API allowlist** — `assertApiCallAllowed` / `API_BLOCKED` (blocks IM / contacts / permissions / ownership APIs).
4. **Outbound only via** `feishuReq` / `feishuFetch` (egress guard + retry + private-deploy version fallback); LLM egress via `assertSafeBaseUrl`. **Never `fetch` Feishu / the LLM directly.**
5. **Sandbox isolation** — LLM-generated code runs in an opaque-origin iframe with `connect-src:'none'`; **never add `allow-same-origin`**.
6. **Secrets never ship in plaintext** — use encrypted `appSecretEnc` or the OAuth proxy `oauthProxyUrl`.
7. **Writes never auto-retry** (`robustFetch` retries GET only).

> When you change code, update the related docs (`README` / `docs/ARCHITECTURE.md`, …). Docs drifting from code counts as incomplete.

## Opening a pull request

1. **Fork** and branch off `main` (`fix/...`, `feat/...`, `docs/...`).
2. Keep PRs **focused** — one concern per PR.
3. **Add tests** for new logic and bug fixes (vitest).
4. Run the loop above; ensure **typecheck / test / build are green**.
5. **Update docs** (and keep zh/en in sync) for any behavior change.
6. In the PR description: **what changed, why, how you verified it**; link related issues.
7. Prefer a [Conventional Commits](#commit-conventions) prefix in the title.

CI validates PRs (see `.github/workflows`). Maintainers will review as soon as they can — please be responsive to feedback.

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(slides): dark-theme export
fix(auth): OAuth missing offline_access caused 2h expiry
docs(deployment): document private-deploy CIDR allowlist
test(redact): cover unconditional redaction
```

Common types: `feat` / `fix` / `docs` / `test` / `refactor` / `perf` / `chore` / `security`.

**DCO sign-off**: commit with `git commit -s` to add `Signed-off-by`, certifying you may submit the contribution under this project's license ([Developer Certificate of Origin](https://developercertificate.org/)).

## Reporting security vulnerabilities

**Do not report vulnerabilities in public issues.** See [`SECURITY.md`](SECURITY.md) — please use GitHub private Security Advisories.

## Scope & non-goals

To keep the product focused and the security promise intact, the following are **non-goals** — open an issue to discuss before a PR:

- **No backend dependency** in the core extension ("no backend, user identity"). The enterprise server suite (`docs/*-proxy-server.mjs`) is **optional**, zero-dependency, and feature-gated — it must never become a hard requirement of the core.
- **No widening of the permission surface** — don't expand `manifest` `host_permissions` / `permissions`, don't relax CSP / sandbox, don't bypass the API allowlist.
- **Import/export is Bitable-only** — Sheets / Docs are online-CRUD only; no file import/export.
- **No silent telemetry / reporting** — see the privacy promise in [`PRIVACY.md`](PRIVACY.md).

Not sure if something is in scope? **Open an issue first** — cheaper than a rejected PR.
