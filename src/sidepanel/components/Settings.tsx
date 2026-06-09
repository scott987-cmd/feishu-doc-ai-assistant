import React, { useState, useEffect } from 'react'
import type { AppSettings } from '../../shared/types'
import { HAS_BUILTIN_CREDS, HAS_APP_SECRET, HAS_ENCRYPTED_SECRET, WEB_SPEECH_ALLOWED, BUILD_CONFIG, FEISHU_API_BASE, HAS_MANAGED_LLM } from '../../shared/config'
import { clearManagedLlmCache, usingManagedLlm } from '../../shared/ai/llmConfig'
import { loadPolicy, policyLockedKeys } from '../../shared/enterprisePolicy'
import { getTenantAccessToken } from '../../shared/feishu/auth'
import { authorizeFeishuUser, oauthRedirectUrl, fetchUserOpenId } from '../../shared/feishu/oauth'
import { saveUserToken, clearUserToken } from '../../shared/feishu/auth'
import { unlockAppSecret, lockAppSecret, isAppSecretLocked } from '../../shared/feishu/appSecret'
import { saveUserAppCreds, getUserAppId, hasUserAppCreds } from '../../shared/feishu/userAppCreds'
import { recipeCount, clearRecipes } from '../../shared/ai/recipes'
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../../shared/theme'
import { LLM_PROVIDERS, providerForBaseUrl, assertSafeBaseUrl, KNOWN_PROVIDER_HOSTS } from '../../shared/providers'
import './Settings.css'

interface Props {
  settings: AppSettings
  /** Current brand accent hex (UI-only preference, persisted to localStorage). */
  accent: string
  onAccentChange: (hex: string) => void
  onSave: (s: AppSettings) => void
  onCancel: () => void
}

export default function Settings({ settings, accent, onAccentChange, onSave, onCancel }: Props) {
  const [form, setForm] = useState<AppSettings>({ ...settings })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showTokenHelp, setShowTokenHelp] = useState(false)
  const [authing, setAuthing] = useState(false)
  const [authResult, setAuthResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // Password-protected App Secret (personal hardening). Locked until the user enters the
  // password; once unlocked it's remembered device-encrypted so OAuth can run.
  const [secretLocked, setSecretLocked] = useState(HAS_ENCRYPTED_SECRET)
  const [unlockPwd, setUnlockPwd] = useState('')
  const [showUnlockPwd, setShowUnlockPwd] = useState(false)
  const [unlockMsg, setUnlockMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [policyLocks, setPolicyLocks] = useState<Set<keyof AppSettings>>(new Set())
  const [policyNotice, setPolicyNotice] = useState('')

  // "Bring your own app" — public / store build ships no creds; user enters their own
  // Feishu App ID + Secret (secret stored device-encrypted). Only relevant when !HAS_BUILTIN_CREDS.
  const [byoAppId, setByoAppId] = useState('')
  const [byoSecret, setByoSecret] = useState('')
  const [byoSaved, setByoSaved] = useState(false)
  const [byoMsg, setByoMsg] = useState('')
  const redirectUrl = oauthRedirectUrl()

  useEffect(() => {
    if (HAS_ENCRYPTED_SECRET) void isAppSecretLocked().then(setSecretLocked)
    void loadPolicy().then((p) => { setPolicyLocks(policyLockedKeys(p)); setPolicyNotice(p?.notice || '') })
    if (!HAS_BUILTIN_CREDS) void (async () => {
      const id = await getUserAppId(); if (id) setByoAppId(id)
      setByoSaved(await hasUserAppCreds())
    })()
  }, [])

  async function saveByoCreds() {
    if (!byoAppId.trim() || !byoSecret.trim()) { setByoMsg('请填写 App ID 与 App Secret'); return }
    await saveUserAppCreds(byoAppId.trim(), byoSecret.trim())
    setByoSaved(true); setByoSecret('')
    setByoMsg('✓ 已保存（App Secret 已本机加密存储）。现在可点「用飞书账号授权」。')
  }

  async function handleUnlock() {
    setUnlockMsg(null)
    try {
      await unlockAppSecret(unlockPwd, true)
      setSecretLocked(false)
      setUnlockPwd('')
      setUnlockMsg({ ok: true, msg: '已解锁 ✓ 现在可以授权/操作了' })
    } catch (err) {
      setUnlockMsg({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    }
  }
  async function handleLock() {
    await lockAppSecret()
    setSecretLocked(true)
    setUnlockMsg(null)
  }

  // "越用越聪明" — local learned-recipe count + clear.
  const [recipeN, setRecipeN] = useState<number | null>(null)
  useEffect(() => { void recipeCount().then(setRecipeN) }, [])
  async function handleClearRecipes() {
    await clearRecipes()
    setRecipeN(0)
  }

  async function authorize() {
    setAuthing(true)
    setAuthResult(null)
    try {
      const { userToken, openId, name, refreshToken, expiresIn } = await authorizeFeishuUser()
      // Persist the refreshable bundle so the token auto-renews before its ~2h expiry.
      await saveUserToken({ accessToken: userToken, refreshToken, expiresIn })
      setForm((f) => ({ ...f, feishuOwnerOpenId: openId, feishuAccessToken: userToken }))
      setAuthResult({ ok: true, msg: `已授权：${name}（open_id 已自动填入，将自动续期，记得点保存）` })
    } catch (err) {
      setAuthResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setAuthing(false)
    }
  }

  // Fallback to OAuth: derive open_id straight from the pasted user_access_token.
  async function fillOpenIdFromToken() {
    setAuthing(true)
    setAuthResult(null)
    try {
      const { openId, name } = await fetchUserOpenId(form.feishuAccessToken)
      // Manual token wins over any prior OAuth bundle — drop the bundle so the pasted
      // token is the one actually used (it can't be auto-refreshed).
      await clearUserToken()
      setForm((f) => ({ ...f, feishuOwnerOpenId: openId }))
      setAuthResult({ ok: true, msg: `已获取：${name}（open_id 已填入，记得点保存）` })
    } catch (err) {
      setAuthResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setAuthing(false)
    }
  }

  const set =
    (k: keyof AppSettings) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  // ── LLM provider preset ──────────────────────────────────────────────────
  const provider = providerForBaseUrl(form.openaiBaseUrl)

  // Endpoint safety hint: an error (blocked at send time) vs a soft warning for an
  // unknown but otherwise-valid https host — the user's chat/table data is sent here.
  const baseUrlNote = (() => {
    const v = form.openaiBaseUrl?.trim()
    if (!v) return null
    try {
      assertSafeBaseUrl(v, BUILD_CONFIG.openaiAllowedHosts)
    } catch (err) {
      return { kind: 'error' as const, msg: err instanceof Error ? err.message : String(err) }
    }
    try {
      const host = new URL(v).hostname.toLowerCase()
      if (!KNOWN_PROVIDER_HOSTS.includes(host)) {
        return { kind: 'warn' as const, msg: `⚠️ 「${host}」非内置厂商，对话与表格内容会发送至此地址，请确认可信。` }
      }
    } catch { /* unparseable handled above */ }
    return null
  })()

  function pickProvider(id: string) {
    const p = LLM_PROVIDERS.find((x) => x.id === id)
    if (!p) return
    setForm((f) => ({
      ...f,
      // "自定义" keeps the user's current base URL/model; presets fill both in.
      openaiBaseUrl: p.region === 'custom' ? f.openaiBaseUrl : p.baseUrl,
      openaiModel: p.models[0] ?? f.openaiModel,
    }))
  }

  async function testFeishu() {
    setTesting(true)
    setTestResult(null)
    try {
      if (HAS_APP_SECRET) {
        // Only possible when the secret is baked in (direct mode). In proxy mode there's
        // no secret client-side, so fall through to the user-token probe instead.
        const token = await getTenantAccessToken(
          BUILD_CONFIG.feishuAppId,
          BUILD_CONFIG.feishuAppSecret
        )
        setTestResult({ ok: true, msg: `tenant_access_token 获取成功 ✓ (${token.slice(0, 12)}…)` })
      } else {
        // Ping a bitable endpoint — any non-auth error means token is valid
        const res = await fetch(
          `${FEISHU_API_BASE}/bitable/v1/apps/__probe__`,
          { headers: { Authorization: `Bearer ${form.feishuAccessToken}` } }
        )
        const json = await res.json() as { code: number; msg: string }
        const authFailed = json.code === 99991677 || json.code === 99991668
        setTestResult(
          authFailed
            ? { ok: false, msg: `Token 无效或已过期 (${json.code})` }
            : { ok: true, msg: `Token 有效 ✓ (code=${json.code})` }
        )
      }
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  const feishuReady = HAS_BUILTIN_CREDS || !!form.feishuAccessToken

  return (
    <div className="settings">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="btn-icon" onClick={onCancel} title="Close">✕</button>
      </div>

      <div className="settings-body">

        {/* ── Appearance ── */}
        <section className="settings-section">
          <h3 className="section-title">外观 · 主题色</h3>
          <div className="accent-row">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.hex}
                className={`accent-swatch ${accent.toLowerCase() === p.hex.toLowerCase() ? 'accent-swatch--active' : ''}`}
                style={{ background: p.hex }}
                title={p.name}
                aria-label={p.name}
                onClick={() => onAccentChange(p.hex)}
              />
            ))}
            <label className="accent-custom" title="自定义颜色">
              <input
                type="color"
                value={accent}
                onChange={(e) => onAccentChange(e.target.value)}
              />
              <span>🎨</span>
            </label>
          </div>
          <p className="field-hint">
            主题色即时生效并记住选择；与浅/深色模式独立。
            {accent.toLowerCase() !== DEFAULT_ACCENT.toLowerCase() && (
              <> <button className="btn-link" onClick={() => onAccentChange(DEFAULT_ACCENT)}>恢复默认</button></>
            )}
          </p>
        </section>

        {policyNotice && (
          <section className="settings-section">
            <p className="field-hint" style={{ color: '#d48806' }}>📢 {policyNotice}</p>
          </section>
        )}

        {/* ── AI Model ── */}
        <section className="settings-section">
          <h3 className="section-title">AI 模型（OpenAI 兼容）</h3>

          {/* Enterprise managed-LLM: the company key is fetched from the proxy after Feishu auth —
              only members of your tenant get it. A switch lets the company still configure manually,
              unless the build locks managed (VITE_LLM_LOCK_MANAGED). */}
          {HAS_MANAGED_LLM && (() => {
            const managed = usingManagedLlm(form) // single source of truth (shared with the runtime)
            return (
              <div className="field-label" style={{ gap: 6 }}>
                <span>大模型配置来源</span>
                {BUILD_CONFIG.llmLockManaged ? (
                  <span className="field-hint">由企业统一下发并锁定（不可手动配置）。</span>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {([['managed', '企业统一'], ['manual', '手动配置']] as const).map(([val, label]) => {
                      const on = val === 'managed' ? managed : !managed
                      return (
                        <button key={val} type="button"
                          onClick={() => setForm((f) => ({ ...f, llmSource: val }))}
                          style={{
                            padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                            border: on ? '1px solid transparent' : '1px solid var(--border, #d9dcea)',
                            background: on ? 'var(--color-primary, #4f6bff)' : '#fff',
                            color: on ? '#fff' : 'var(--color-text, #333)',
                          }}>{label}</button>
                      )
                    })}
                  </div>
                )}
                {managed && (
                  <span className="field-hint">
                    模型由企业统一提供，用本企业飞书账号授权后自动获取，无需填写 Key。
                    {' '}<button type="button" className="btn-link" onClick={() => void clearManagedLlmCache()}>重新获取</button>
                  </span>
                )}
              </div>
            )
          })()}

          {!usingManagedLlm(form) && (<>
          <label className="field-label">
            供应商
            <select className="field-input" value={provider.id} onChange={(e) => pickProvider(e.target.value)}>
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <label className="field-label">
            Base URL
            <input className="field-input" type="url"
              value={form.openaiBaseUrl} onChange={set('openaiBaseUrl')}
              placeholder="https://api.deepseek.com" />
            {baseUrlNote && (
              <span
                className="field-hint"
                style={{ color: baseUrlNote.kind === 'error' ? '#d4380d' : '#d48806' }}
              >
                {baseUrlNote.msg}
              </span>
            )}
          </label>

          <label className="field-label">
            API Key
            <input className="field-input" type="password"
              value={form.openaiApiKey} onChange={set('openaiApiKey')}
              placeholder="sk-…" />
          </label>

          <label className="field-label">
            Model
            <input className="field-input" type="text" list="model-suggestions"
              value={form.openaiModel} onChange={set('openaiModel')}
              placeholder={provider.models[0] || 'deepseek-v4-pro'} />
            <datalist id="model-suggestions">
              {provider.models.map((m) => <option key={m} value={m} />)}
            </datalist>
          </label>

          <p className="field-hint">
            默认国内大模型（DeepSeek）。模型 ID 可**直接输入**最新型号（预设仅作建议）；
            海外模型仍可在「供应商」中选择。
          </p>
          </>)}
        </section>

        {/* ── Feishu Auth ── */}
        <section className="settings-section">
          <h3 className="section-title">飞书 Feishu 鉴权</h3>

          {HAS_BUILTIN_CREDS ? (
            /* ── Built-in App Credentials ── */
            <div className="builtin-badge">
              <span className="builtin-icon">🔑</span>
              <div className="builtin-text">
                <span className="builtin-label">App Credentials（已内置）</span>
                <span className="builtin-sub">
                  此版本已打包 App ID，无需手动配置。
                  如需覆盖，可在下方填写 user_access_token。
                </span>
              </div>
            </div>
          ) : null}

          {/* Bring-your-own Feishu app — public / store build (no baked creds). */}
          {!HAS_BUILTIN_CREDS && (
            <div className="field-group byo-box">
              <label className="field-label-inline">自建飞书应用（本版本不内置凭据，请填你自己的）</label>
              <input
                className="field-input" type="text" value={byoAppId}
                onChange={(e) => setByoAppId(e.target.value)} placeholder="App ID：cli_xxxxxxxxxxxx"
              />
              <input
                className="field-input" type="password" value={byoSecret} style={{ marginTop: 6 }}
                onChange={(e) => setByoSecret(e.target.value)}
                placeholder={byoSaved ? 'App Secret（已保存，如需更新再填）' : 'App Secret'}
              />
              <div className="test-row" style={{ marginTop: 6 }}>
                <button className="btn-test" type="button" onClick={() => void saveByoCreds()} disabled={!byoAppId.trim() || !byoSecret.trim()}>
                  保存应用凭据
                </button>
                {byoSaved && <span className="test-result test-result--ok">已配置 ✓</span>}
              </div>
              {byoMsg && <span className="field-hint">{byoMsg}</span>}
              {redirectUrl && (
                <div className="help-box" style={{ marginTop: 6 }}>
                  <p>在飞书后台「安全设置 → 重定向 URL」登记（须完全一致，含末尾斜杠）：</p>
                  <pre className="help-code">{redirectUrl}</pre>
                  <p>权限管理开通（勾<b>用户身份</b>）：<code>offline_access</code> + 按需 <code>bitable:app</code> <code>docx:document</code> <code>sheets:spreadsheet</code> <code>drive:drive</code> <code>wiki:wiki</code> <code>contact:user.base:readonly</code>；并把自己加入「可用范围」、发布应用。</p>
                </div>
              )}
            </div>
          )}

          {/* Password-protected App Secret (personal build): unlock before OAuth. */}
          {HAS_ENCRYPTED_SECRET && (
            <div className="unlock-box">
              <div className="unlock-head">
                <span>{secretLocked ? '🔒' : '🔓'}</span>
                <span className="unlock-title">
                  应用密钥已加密{secretLocked ? '（需输入密码解锁后才能授权/操作）' : '（已解锁）'}
                </span>
              </div>
              {secretLocked ? (
                <>
                <div className="unlock-row">
                  <input
                    className="field-input" type={showUnlockPwd ? 'text' : 'password'} value={unlockPwd}
                    onChange={(e) => setUnlockPwd(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleUnlock() }}
                    placeholder="粘贴解锁密码"
                  />
                  <button
                    className="btn-secondary unlock-btn" type="button"
                    onClick={() => setShowUnlockPwd((v) => !v)}
                    title={showUnlockPwd ? '隐藏' : '显示，核对粘贴是否完整'}
                  >
                    {showUnlockPwd ? '隐藏' : '👁'}
                  </button>
                  <button className="btn-primary unlock-btn" disabled={!unlockPwd} onClick={() => void handleUnlock()}>
                    解锁
                  </button>
                </div>
                {unlockPwd && (
                  <span className="field-hint">已输入 {unlockPwd.length} 个字符{/\s/.test(unlockPwd) ? '（含空白，可能是粘贴多带了空格/换行）' : ''}</span>
                )}
                </>
              ) : (
                <button className="btn-secondary" onClick={() => void handleLock()}>锁定（清除本机已记住的密钥）</button>
              )}
              {unlockMsg && (
                <span className="field-hint" style={{ color: unlockMsg.ok ? '#389e0d' : '#d4380d' }}>{unlockMsg.msg}</span>
              )}
            </div>
          )}

          {/* User token — required when no built-in creds, optional override when present */}
          <div className="field-group">
            <div className="help-toggle-row">
              <label className="field-label-inline">
                {HAS_BUILTIN_CREDS ? 'user_access_token（可选覆盖）' : 'user_access_token'}
              </label>
              <button className="btn-link" onClick={() => setShowTokenHelp((v) => !v)}>
                {showTokenHelp ? '收起' : '如何获取?'}
              </button>
            </div>

            {showTokenHelp && (
              <div className="help-box">
                <p>在浏览器打开飞书网页版，F12 → Console 执行：</p>
                <pre className="help-code">{'window.larkSuite?.globalState?.userInfo?.accessToken'}</pre>
                <p>或查看任意 API 请求的 <code>Authorization: Bearer &lt;token&gt;</code> 请求头。</p>
                <p className="help-note">⚠ Token 约 2 小时过期，请勿分享。存储时已加密。</p>
              </div>
            )}

            <input className="field-input" type="password"
              value={form.feishuAccessToken} onChange={set('feishuAccessToken')}
              placeholder={HAS_BUILTIN_CREDS ? '留空则使用内置凭据' : 'u-xxxxxxxxxxxxxxxxxxxxxxxx'} />
          </div>

          {/* Owner open_id — created Bases get transferred here so they show in your drive */}
          <label className="field-label">
            你的 open_id（新建多维表格归属）
            <input className="field-input" type="text"
              value={form.feishuOwnerOpenId} onChange={set('feishuOwnerOpenId')}
              placeholder="ou_xxxxxxxxxxxxxxxx（留空则新建的表归应用所有，你看不到）" />
          </label>

          <div className="test-row">
            {(HAS_BUILTIN_CREDS || byoSaved) && (
              <button className="btn-test" onClick={authorize} disabled={authing}>
                {authing ? '授权中…' : '用飞书账号授权'}
              </button>
            )}
            <button
              className="btn-test"
              onClick={fillOpenIdFromToken}
              disabled={authing || !form.feishuAccessToken.trim()}
              title={form.feishuAccessToken.trim() ? '用上方 token 换取 open_id' : '请先在上方填入 user_access_token'}
            >
              {authing ? '获取中…' : '用 token 取 open_id'}
            </button>
            {authResult && (
              <span className={`test-result ${authResult.ok ? 'test-result--ok' : 'test-result--err'}`}>
                {authResult.msg}
              </span>
            )}
          </div>
          <p className="field-hint">
            授权失败时，可改用右边：在上方「user_access_token」粘贴你的 token（见「如何获取?」），
            再点【用 token 取 open_id】——无需登记重定向 URL。
          </p>

          <p className="field-hint">
            用「内置凭据 / tenant」身份新建的多维表格默认归应用所有、不在你的云空间显示。
            点上方授权后，助手新建表会自动转交给你（应用保留编辑权）；也可手填 open_id。
            {HAS_BUILTIN_CREDS && oauthRedirectUrl() && (
              <>
                <br />⚠️ 首次需在飞书开放平台「安全设置 → 重定向 URL」添加：
                <code>{oauthRedirectUrl()}</code>
              </>
            )}
          </p>

          {/* Test connection */}
          <div className="test-row">
            <button className="btn-test" onClick={testFeishu} disabled={testing || !feishuReady}>
              {testing ? '测试中…' : '测试飞书连接'}
            </button>
            {testResult && (
              <span className={`test-result ${testResult.ok ? 'test-result--ok' : 'test-result--err'}`}>
                {testResult.msg}
              </span>
            )}
          </div>

          <p className="storage-note">🔒 API Key 和 Token 使用 AES-256-GCM 加密存储</p>
        </section>

        {/* ── Scenario Templates ── */}
        <section className="settings-section">
          <h3 className="section-title">场景模版库</h3>
          <label className="field-label">
            模版库地址
            <input
              className="field-input"
              type="text"
              value={form.templateRegistryUrl}
              onChange={set('templateRegistryUrl')}
              placeholder="https://… 或 http://localhost:8787/registry.json"
            />
          </label>
          <p className="field-hint">
            留空使用内置模版。填写<b>任意可访问的地址</b>（HTTPS，或 http://localhost 本地测试），
            「场景」Tab 即可拉取。支持单文件 bundle（一个 .json 内含全部模版）或 index.json + 多文件两种格式。
          </p>
        </section>

        {/* ── 越用越聪明（本地经验记忆） ── */}
        <section className="settings-section">
          <h3 className="section-title">越用越聪明（本地经验）</h3>
          <label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.learnFromHistory !== false}
              disabled={policyLocks.has('learnFromHistory')}
              onChange={(e) => setForm((f) => ({ ...f, learnFromHistory: e.target.checked }))}
            />
            记住成功的操作套路，下次自动参考
            {policyLocks.has('learnFromHistory') && <span className="field-hint">（由企业策略锁定）</span>}
          </label>
          <p className="field-hint">
            每次任务成功后，仅在<b>本机</b>把「做了什么 + 下次怎么做最稳」提炼成一条经验（不含表格/文档数据），
            下次遇到相似任务自动参考、少走弯路。最多积累 <b>300</b> 条，已积累 <b>{recipeN ?? '…'}</b> 条。
          </p>
          <button className="btn-secondary" onClick={() => void handleClearRecipes()} style={{ alignSelf: 'flex-start' }}>
            清空学到的经验
          </button>
        </section>

        {/* ── Auto 模式（自动确认内容删除） ── */}
        <section className="settings-section">
          <h3 className="section-title">Auto 模式（自动确认删除）</h3>
          <label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.autoConfirm === true}
              disabled={policyLocks.has('autoConfirm')}
              onChange={(e) => setForm((f) => ({ ...f, autoConfirm: e.target.checked }))}
            />
            开启后，文档内的内容删除（行 / 字段 / 内容块 / 去重）<b>自动确认、不再弹按钮</b>
            {policyLocks.has('autoConfirm') && <span className="field-hint">（由企业策略锁定）</span>}
          </label>
          <p className="field-hint" style={{ color: form.autoConfirm ? '#d4380d' : undefined }}>
            ⚠️ 谨慎开启：开启后助手删除文档内容前<b>不再向你确认</b>。
            <b>文件级删除（整表 / 电子表格 / 文档 / 云文件）始终被拦截</b>，Auto 模式也不会放开。
          </p>
        </section>

        {WEB_SPEECH_ALLOWED && (
          <section className="settings-section">
            <h3 className="section-title">语音输入</h3>
            <label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={form.voiceInput !== false}
                onChange={(e) => setForm((f) => ({ ...f, voiceInput: e.target.checked }))}
              />
              在输入框显示 🎤 语音输入
            </label>
            <p className="field-hint">
              用浏览器内置语音识别(zh-CN)把说话转成文字填进输入框，可编辑后再发。
              ⚠️ 语音识别由浏览器走 Google 服务完成，音频会发往外部——私有化/内网部署已自动禁用本功能。
            </p>
          </section>
        )}

      </div>

      <div className="settings-footer">
        <span className="settings-version" title="当前运行的扩展版本（用于确认是否已加载新构建）">
          v{typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : 'dev'}
        </span>
        <button className="btn-cancel" onClick={onCancel}>Cancel</button>
        <button className="btn-save" onClick={() => onSave(form)}>Save</button>
      </div>
    </div>
  )
}
