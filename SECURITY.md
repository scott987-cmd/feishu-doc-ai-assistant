# 安全策略 · Security Policy

*[English below](#security-policy-english)*

## 报告漏洞

**请不要在公开 Issue / PR / 讨论区里披露安全漏洞。**

请通过 **GitHub 私有安全公告** 私下提交:
👉 <https://github.com/scott987-cmd/feishu-doc-ai-assistant/security/advisories/new>

报告请尽量包含:

- 受影响的版本 / 形态(商店版 SaaS、私有化、企业版)与运行环境(Chrome 版本、飞书域名是否为私有化);
- 复现步骤或 PoC;
- 影响评估(可被谁、在什么前提下利用,后果是什么)。

**响应预期**:我们会在 **5 个工作日内**确认收到,并就修复与披露时间线与你沟通。修复发布后,如你愿意,我们会在公告中致谢。

## 安全模型(评估漏洞前请先了解)

本扩展的设计本身就是安全边界,理解它有助于判断什么算漏洞:

- **无后端**:核心扩展不含服务端,所有操作以**用户本人飞书身份**(OAuth user token)进行,**绝不**回退到 tenant 身份。
- **最小权限**:通用飞书 API 走白名单(禁 IM / 通讯录 / 权限 / 所有权);**文件级删除一律拒绝**,内容删除走确认门。
- **出站受控**:所有飞书 / 大模型出站经 `feishuFetch` / `assertSafeBaseUrl` 守卫;写操作不自动重试。
- **沙箱隔离**:LLM 生成的代码在 opaque origin + `connect-src:'none'` 的 iframe 中执行,拿不到 `chrome.*` / token。
- **密钥不入明文包**:商店版为 BYO(用户自填);私有化 / 企业版用加密 `appSecretEnc` 或 OAuth 代理。
- **无遥测**:不做任何静默上报(见 [`PRIVACY.md`](PRIVACY.md))。

逐条审计见 [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md)。

## 范围

**在范围内**(欢迎报告):绕过上述任一边界——例如越权调用被禁 API、token 泄漏 / 越权、沙箱逃逸、CSP 绕过、明文密钥泄漏、企业服务端套件(`docs/*-proxy-server.mjs` / `admin-server.mjs`)的鉴权 / CSRF / 注入 / SSRF。

**通常不在范围内**:依赖库中需特定非默认配置才能触发的问题、社工 / 钓鱼、需要已被攻陷的设备、纯属用户自填了恶意的大模型 Base URL / App 凭据。

## 受支持版本

仅对**最新发布版本**提供安全修复。请先升级到最新版再报告。

---

## Security Policy (English)

### Reporting a vulnerability

**Please do not disclose security issues in public issues / PRs / discussions.**

Report privately via **GitHub private Security Advisories**:
👉 <https://github.com/scott987-cmd/feishu-doc-ai-assistant/security/advisories/new>

Please include, where possible: affected version / edition (Store SaaS, private, enterprise) and environment (Chrome version, whether the Feishu domain is private); reproduction steps or a PoC; and an impact assessment.

**Response expectations**: we aim to acknowledge within **5 business days** and will coordinate a fix and disclosure timeline with you. We're happy to credit you in the advisory once a fix ships.

### Security model (please understand before assessing)

- **No backend** — all operations run as the **user's own Feishu identity** (OAuth user token); it never falls back to tenant identity.
- **Least privilege** — general Feishu APIs are allowlisted (IM / contacts / permissions / ownership blocked); file-level delete is always refused; content deletion goes through a confirmation gate.
- **Controlled egress** — all Feishu / LLM traffic goes through `feishuFetch` / `assertSafeBaseUrl`; writes never auto-retry.
- **Sandbox isolation** — LLM-generated code runs in an opaque-origin iframe with `connect-src:'none'`; it cannot reach `chrome.*` / tokens.
- **No plaintext secrets** — Store builds are BYO; private / enterprise use encrypted `appSecretEnc` or an OAuth proxy.
- **No telemetry** — see [`PRIVACY.md`](PRIVACY.md).

Line-by-line audit: [`docs/SECURITY_AUDIT.en.md`](docs/SECURITY_AUDIT.en.md).

### Scope

**In scope**: bypassing any of the boundaries above — calling blocked APIs, token leakage / privilege escalation, sandbox escape, CSP bypass, plaintext secret exposure, or auth / CSRF / injection / SSRF in the enterprise server suite (`docs/*-proxy-server.mjs` / `admin-server.mjs`).

**Usually out of scope**: issues requiring non-default dependency configuration, social engineering / phishing, attacks requiring an already-compromised device, or a user supplying a deliberately malicious LLM base URL / app credentials.

### Supported versions

Security fixes are provided for the **latest released version** only. Please upgrade before reporting.
