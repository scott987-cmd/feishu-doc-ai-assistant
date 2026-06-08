#!/usr/bin/env node
/**
 * Encrypt the Feishu App Secret with a password for the "personal" build, so the
 * plaintext secret NEVER lands in the bundle — only ciphertext that requires a password
 * (PBKDF2 → AES-GCM) to unlock at runtime (see src/shared/feishu/appSecret.ts).
 *
 * Usage (interactive, avoids shell history):
 *   node scripts/encrypt-secret.mjs
 * Or non-interactive (CI / scripted):
 *   ENC_SECRET=... ENC_PASSWORD=... node scripts/encrypt-secret.mjs
 * then paste the printed value into .env.local as:
 *   VITE_FEISHU_APP_SECRET_ENC=<value>
 *   # and LEAVE VITE_FEISHU_APP_SECRET empty.
 *
 * Format: base64( salt[16] ‖ iv[12] ‖ AES-256-GCM ciphertext ), PBKDF2 SHA-256 210k iters.
 * Must match decryptSecretBlob() in appSecret.ts exactly.
 */
import { webcrypto as crypto } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const ITERS = 210_000

function bytesToB64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

async function readInputs() {
  // Non-interactive path for CI / scripted builds.
  if (process.env.ENC_SECRET && process.env.ENC_PASSWORD) {
    return { secret: process.env.ENC_SECRET.trim(), password: process.env.ENC_PASSWORD.trim(), password2: process.env.ENC_PASSWORD.trim() }
  }
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const secret = (await rl.question('App Secret (明文): ')).trim()
    const password = (await rl.question('设置解锁密码: ')).trim()
    const password2 = (await rl.question('再次输入密码: ')).trim()
    return { secret, password, password2 }
  } finally {
    rl.close()
  }
}

async function main() {
  const { secret, password, password2 } = await readInputs()

  if (!secret) { console.error('✗ App Secret 不能为空'); process.exit(1) }
  if (!password) { console.error('✗ 密码不能为空'); process.exit(1) }
  if (password !== password2) { console.error('✗ 两次密码不一致'); process.exit(1) }
  if (password.length < 8) console.warn('⚠ 密码较短，建议 ≥12 位且含大小写/数字/符号（密文可被离线暴力破解）')

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const mat = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERS, hash: 'SHA-256' },
    mat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret)))

  const out = new Uint8Array(salt.length + iv.length + ct.length)
  out.set(salt, 0)
  out.set(iv, salt.length)
  out.set(ct, salt.length + iv.length)

  console.log('\n✓ 已加密。把下面这行写入 .env.local（并清空 VITE_FEISHU_APP_SECRET）：\n')
  console.log(`VITE_FEISHU_APP_SECRET_ENC=${bytesToB64(out)}\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
