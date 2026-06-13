/**
 * 文档站构建器 —— 把仓库里所有 Markdown 文档转成一个【静态 HTML 文档站】（零依赖，纯 Node）。
 *
 * 输出到 site/（镜像目录结构），可直接 GitHub Pages 托管（见 .github/workflows/pages.yml）。
 * 特性：GFM 表格 / 围栏代码 / 多反引号行内码 / 嵌套列表 / 任务列表 / 引用(含列表内) / 内联 HTML / 行内格式
 *      (粗/斜/_斜_/删)；标题自动锚点(GitHub 同款 slug，CJK 友好)；.md→.html 链接重写、源文件→拷贝；
 *      侧栏全站导航 + 当前页高亮 + 中英切换 + 本页目录。
 *
 * 用法：node scripts/build-docs.mjs   （或 npm run docs:html）。零依赖 → Pages CI 无需 npm install。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'site')
const SITE_TITLE = '飞书文档AI助手'
const GH = 'https://github.com/scott987-cmd/feishu-doc-ai-assistant'
const C0 = '\x01', C1 = '\x02' // 占位哨兵（控制字符；绝不与正文冲突，不被 esc 触碰）

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|dist|site|\.git)$/.test(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else if (e.name.endsWith('.md')) acc.push(path.relative(ROOT, full))
  }
  return acc
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// 标题文本 → 纯展示文本（去 HTML、把 [x](y) 还原为 x、去 markdown 标记）—— 给侧栏/本页目录的 label 用
const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '')

// GitHub 风格 slug：小写 → 去 HTML → 去标点/符号/emoji（保留 字母/数字/空白/_/-，CJK 友好）→ 每个空白换一个
// 连字符。关键：【不合并多连字符、不裁剪首尾连字符】——否则带前导 ★/emoji 或含 &// 的标题锚点对不上 GitHub。
function slugger() {
  const seen = new Map()
  return (text) => {
    let s = text.toLowerCase().trim().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
    if (!s) s = 'section'
    const n = seen.get(s) ?? 0; seen.set(s, n + 1)
    return n ? `${s}-${n}` : s
  }
}
function rewriteHref(u) {
  if (/^(https?:|mailto:|#|\/\/)/.test(u)) return u
  if (/\.(md)(#|$)/i.test(u)) return u.replace(/\.en\.md(#|$)/i, '.en.html$1').replace(/\.md(#|$)/i, '.html$1')
  return u // 非 .md（如 .mjs/.conf 源文件）保持相对路径——这些文件会被拷进站点
}

// ── 行内 Markdown → HTML ─────────────────────────────────────────────────────
function inline(s) {
  const code = []
  // 反引号代码段：匹配最长反引号串作分隔，内部任意（含 ``` / ** 等照原样，不再被解析）
  s = s.replace(/(`+)([\s\S]+?)\1(?!`)/g, (_, t, c) => { code.push('<code>' + esc(c.replace(/^ | $/g, '')) + '</code>'); return C0 + (code.length - 1) + C0 })
  const raw = []
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, (m) => { raw.push(m); return C1 + (raw.length - 1) + C1 })
  s = esc(s)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, alt, src) => `<img src="${src}" alt="${alt.replace(/"/g, '&quot;')}" loading="lazy">`)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, t, u) => `<a href="${rewriteHref(u)}">${t}</a>`)
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>').replace(/__([\s\S]+?)__/g, '<strong>$1</strong>')
  // 斜体内容禁含 < （即不跨越上面 ** 生成的 <strong> 标签）——否则像 **https://*.feishu.cn/*** 里残留的
  // 单星会和标签后的星配对，产生跨标签、嵌套错乱的 <em>。停在标签边界即与 GitHub 一致（内/尾星保持字面）。
  s = s.replace(/(^|[^*\w])\*([^*\s<][^*<]*?)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_\w])_([^_\s<][^_<]*?)_(?!_)/g, '$1<em>$2</em>')
  s = s.replace(/~~([\s\S]+?)~~/g, '<del>$1</del>')
  s = s.replace(new RegExp(C1 + '(\\d+)' + C1, 'g'), (_, i) => raw[+i])
  s = s.replace(new RegExp(C0 + '(\\d+)' + C0, 'g'), (_, i) => code[+i])
  return s
}

// 列表项内容：续行里以 > 开头的连续行渲成 blockquote，其余 inline（修复 列表内引用块/前导空格泄漏）
function liContent(text) {
  const lines = text.split('\n'); let html = ''; let buf = []; let quote = []
  const fp = () => { if (buf.length) { html += inline(buf.join('\n')); buf = [] } }
  const fq = () => { if (quote.length) { html += `<blockquote>${mdToHtml(quote.join('\n')).html}</blockquote>`; quote = [] } }
  for (const ln of lines) {
    if (/^\s*>\s?/.test(ln)) { fp(); quote.push(ln.replace(/^\s*>\s?/, '')) }
    else { fq(); buf.push(ln.replace(/^\s+/, '')) }
  }
  fp(); fq(); return html
}

// 嵌套列表 → <ul>/<ol>（保留起始序号 + 任务列表复选框）
function renderList(lines) {
  const items = []
  for (const ln of lines) {
    const m = ln.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)
    if (m) items.push({ indent: m[1].replace(/\t/g, '  ').length, ordered: /\d/.test(m[2]), num: parseInt(m[2], 10) || 1, text: m[3] })
    else if (items.length) items[items.length - 1].text += '\n' + ln
  }
  let i = 0
  function build(minIndent) {
    const first = items[i]; const ordered = first.ordered
    const startAttr = ordered && first.num !== 1 ? ` start="${first.num}"` : ''
    let html = ordered ? `<ol${startAttr}>` : '<ul>'
    while (i < items.length) {
      const cur = items[i]
      if (cur.indent < minIndent) break
      if (cur.indent > minIndent) { html = html.replace(/<\/li>$/, '') + build(cur.indent) + '</li>'; continue }
      i++
      let t = cur.text; const tm = t.match(/^\[([ xX])\]\s+/)
      let cb = ''
      if (tm) { cb = `<input type="checkbox" disabled${/x/i.test(tm[1]) ? ' checked' : ''}> `; t = t.slice(tm[0].length) }
      html += `<li${tm ? ' class="task"' : ''}>${cb}${liContent(t)}</li>`
    }
    return html + (ordered ? '</ol>' : '</ul>')
  }
  return items.length ? build(items[0].indent) : ''
}

// ── 块级解析 → {html, toc, title} ────────────────────────────────────────────
function mdToHtml(md) {
  const slug = slugger()
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out = []; const toc = []; let title = ''; let i = 0
  const startsTable = (k) => /\|/.test(lines[k] || '') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[k + 1] || '') && /-/.test(lines[k + 1] || '')
  while (i < lines.length) {
    const ln = lines[i]
    const fence = ln.match(/^```(\w*)/)
    if (fence) {
      const lang = fence[1]; const buf = []; i++
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++
      out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }
    const h = ln.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const level = h[1].length; const text = h[2].replace(/\s*#+\s*$/, '')
      const id = slug(plain(text))
      if (!title && level === 1) title = plain(text)
      if (level >= 2 && level <= 3) toc.push({ level, id, text: plain(text) })
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`)
      i++; continue
    }
    if (/^(\s*([-*_])\s*){3,}$/.test(ln) && ln.trim()) { out.push('<hr>'); i++; continue }
    if (startsTable(i)) {
      const rows = []
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(lines[i]); i++ }
      const cells = (r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
      const head = cells(rows[0]); const body = rows.slice(2).map(cells)
      let t = '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
      for (const r of body) t += '<tr>' + head.map((_, j) => `<td>${inline(r[j] ?? '')}</td>`).join('') + '</tr>'
      out.push(t + '</tbody></table>')
      continue
    }
    if (/^>\s?/.test(ln)) {
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push(`<blockquote>${mdToHtml(buf.join('\n')).html}</blockquote>`)
      continue
    }
    if (/^(\s*)([-*+]|\d+\.)\s+/.test(ln)) {
      const buf = []
      while (i < lines.length && (/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) || (/^\s+\S/.test(lines[i]) && lines[i].trim()))) { buf.push(lines[i]); i++ }
      out.push(renderList(buf))
      continue
    }
    if (/^\s*<(\/?)(div|p|table|img|a|details|summary|picture|source|sub|sup|br|kbd|figure|center|h[1-6]|blockquote|ul|ol|pre)\b/i.test(ln)) {
      const buf = []
      while (i < lines.length && lines[i].trim()) { buf.push(lines[i]); i++ }
      out.push(buf.join('\n'))
      continue
    }
    if (!ln.trim()) { i++; continue }
    const para = []
    while (i < lines.length && lines[i].trim() && !startsTable(i) &&
      !/^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s+|\s*<(div|p|table|img|details|ul|ol|pre|h[1-6])\b)/i.test(lines[i]) &&
      !/^(\s*([-*_])\s*){3,}$/.test(lines[i])) { para.push(lines[i]); i++ }
    if (para.length) out.push(`<p>${inline(para.map((l) => l.replace(/^\s+/, '')).join('\n').replace(/ {2,}$/gm, '<br>'))}</p>`)
    else i++
  }
  return { html: out.join('\n'), toc, title }
}

// ── 站点导航（分组）──────────────────────────────────────────────────────────
const GROUPS = [
  ['指南', ['README.md', 'docs/QUICKSTART.md', 'docs/USER_GUIDE.md', 'docs/FAQ.md']],
  ['部署', ['docs/DEPLOYMENT.md', 'docs/PRIVATE_DEPLOYMENT.md', 'docs/STORE_PUBLISHING.md', 'docs/enterprise/DEPLOY.md', 'docs/oauth-proxy/README.md']],
  ['架构与安全', ['docs/ARCHITECTURE.md', 'docs/SECURITY_AUDIT.md', 'docs/PROJECT.md', 'PRIVACY.md']],
  ['开发', ['CLAUDE.md', 'docs/DEVELOPMENT.md', 'docs/CHANGELOG.md']],
  ['English', ['README.en.md', 'docs/DEPLOYMENT.en.md', 'docs/PRIVATE_DEPLOYMENT.en.md', 'docs/STORE_PUBLISHING.en.md', 'docs/USER_GUIDE.en.md', 'docs/FAQ.en.md', 'docs/ARCHITECTURE.en.md', 'docs/SECURITY_AUDIT.en.md', 'docs/PROJECT.en.md', 'docs/DEVELOPMENT.en.md', 'docs/QUICKSTART.en.md', 'docs/enterprise/DEPLOY.en.md', 'docs/oauth-proxy/README.en.md']],
]
const htmlPath = (mdRel) => mdRel.replace(/\.md$/, '.html')
const depthPrefix = (htmlRel) => '../'.repeat(htmlRel.split('/').length - 1)

function renderNav(titles, currentHtml) {
  const rp = depthPrefix(currentHtml)
  let nav = `<a class="brand" href="${rp}index.html">🪶 ${SITE_TITLE}</a><div class="brandsub">完整文档站</div>`
  nav += `<a class="navlink${currentHtml === 'docs/index.html' ? ' on' : ''}" href="${rp}docs/index.html">📖 完整指南（单页）</a>`
  for (const [g, items] of GROUPS) {
    nav += `<div class="navg">${g}</div>`
    for (const it of items) {
      const hp = htmlPath(it)
      nav += `<a class="navlink${currentHtml === hp ? ' on' : ''}" href="${rp}${hp}">${esc(titles.get(it) || it.split('/').pop().replace(/\.md$/, ''))}</a>`
    }
  }
  return nav
}

function page({ title, bodyHtml, toc, navHtml, htmlRel, mdRel, langAlt }) {
  const rp = depthPrefix(htmlRel)
  const tocHtml = toc.length ? `<aside class="onthispage"><div class="opt">本页</div>${toc.map((t) => `<a class="l${t.level}" href="#${t.id}">${esc(t.text)}</a>`).join('')}</aside>` : ''
  const langBtn = langAlt ? `<a class="langbtn" href="${rp}${langAlt}">${langAlt.includes('.en.') ? 'EN' : '中文'}</a>` : ''
  return `<!DOCTYPE html><html lang="zh"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${SITE_TITLE}</title>
<link rel="stylesheet" href="${rp}assets/site.css">
</head><body>
<button class="navtoggle" onclick="document.body.classList.toggle('navopen')" aria-label="菜单">☰</button>
<nav class="toc">${navHtml}</nav>
<div class="page">
<main>
<div class="crumb"><a href="${rp}index.html">← 文档首页</a> ${langBtn} <a class="src" href="${GH}/blob/main/${mdRel}" target="_blank" rel="noopener">源文件 ↗</a></div>
${bodyHtml}
<hr><p class="foot">© ${SITE_TITLE} · 本页由 <code>scripts/build-docs.mjs</code> 从 <code>${esc(mdRel)}</code> 生成 · <a href="${GH}">GitHub</a></p>
</main>
${tocHtml}
</div>
<script src="${rp}assets/site.js"></script>
</body></html>`
}

const SITE_CSS = `:root{--bg:#fff;--fg:#1d2433;--mut:#5b6478;--line:#e7eaf2;--soft:#f6f8fc;--accent:#4f6bff;--code:#0f1320;--codefg:#e6e9f5}
@media(prefers-color-scheme:dark){:root{--bg:#0f1320;--fg:#e6e9f5;--mut:#9aa3c7;--line:#262c46;--soft:#171c2e;--accent:#7d93ff;--code:#0b0e18;--codefg:#e6e9f5}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font:15px/1.72 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg)}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
nav.toc{position:fixed;top:0;left:0;width:248px;height:100vh;overflow:auto;padding:20px 12px;border-right:1px solid var(--line);background:var(--bg);font-size:13.5px}
nav.toc .brand{display:block;font-weight:700;font-size:15px;color:var(--fg)}
nav.toc .brandsub{color:var(--mut);font-size:11.5px;margin:0 0 12px 2px}
nav.toc .navg{margin:14px 8px 3px;font-size:11px;letter-spacing:.05em;color:var(--mut);text-transform:uppercase}
nav.toc .navlink{display:block;color:var(--mut);padding:4px 10px;border-radius:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
nav.toc .navlink:hover{background:var(--soft);text-decoration:none;color:var(--fg)}
nav.toc .navlink.on{background:var(--soft);color:var(--fg);font-weight:600}
.page{margin-left:248px;display:flex;gap:24px;max-width:1200px}
main{flex:1;min-width:0;padding:26px 34px 100px}
.onthispage{position:sticky;top:0;align-self:flex-start;width:180px;flex:0 0 180px;height:100vh;overflow:auto;padding:30px 14px 30px 0;font-size:12.5px}
.onthispage .opt{color:var(--mut);text-transform:uppercase;font-size:11px;letter-spacing:.05em;margin-bottom:6px}
.onthispage a{display:block;color:var(--mut);padding:2px 0}.onthispage a.l3{padding-left:12px;font-size:12px}
.onthispage a:hover,.onthispage a.on{color:var(--fg)}
.crumb{display:flex;gap:14px;align-items:center;font-size:13px;color:var(--mut);margin-bottom:18px;flex-wrap:wrap}
.crumb .src{margin-left:auto}.langbtn{border:1px solid var(--line);border-radius:6px;padding:1px 9px;font-size:12px}
h1{font-size:27px;margin:6px 0 14px;line-height:1.25}
h2{font-size:21px;margin:40px 0 8px;padding-top:10px;border-top:1px solid var(--line)}
h3{font-size:17px;margin:24px 0 6px}h4{font-size:14.5px;margin:18px 0 4px}
p,li{color:var(--fg)}img{max-width:100%;border-radius:8px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86em;background:var(--soft);padding:1px 5px;border-radius:5px;border:1px solid var(--line)}
pre{background:var(--code);color:var(--codefg);padding:14px 16px;border-radius:10px;overflow:auto;font-size:13px;line-height:1.55}
pre code{background:none;border:0;padding:0;color:inherit}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:13.5px;display:block;overflow:auto}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}th{background:var(--soft)}
blockquote{margin:14px 0;padding:8px 16px;border-left:3px solid var(--accent);background:var(--soft);border-radius:0 8px 8px 0;color:var(--mut)}
blockquote p{margin:6px 0}
hr{border:0;border-top:1px solid var(--line);margin:28px 0}
ul,ol{padding-left:24px}li{margin:3px 0}li.task{list-style:none;margin-left:-20px}li.task input{margin-right:7px}
.foot{color:var(--mut);font-size:12.5px}
.navtoggle{display:none;position:fixed;top:12px;right:12px;z-index:20;width:40px;height:40px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--fg);font-size:18px;cursor:pointer}
.hero{padding:30px 0 10px}.hero h1{font-size:34px;margin:0 0 6px}.hero p{font-size:17px;color:var(--mut);margin:0}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:22px 0}
.dcard{display:block;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:14px 16px;color:inherit}
.dcard:hover{border-color:var(--accent);text-decoration:none}.dcard b{display:block;margin-bottom:3px}.dcard span{color:var(--mut);font-size:13px}
.gtitle{font-size:13px;color:var(--mut);text-transform:uppercase;letter-spacing:.05em;margin:26px 0 2px}
@media(max-width:980px){.onthispage{display:none}.page{max-width:none}}
@media(max-width:760px){nav.toc{transform:translateX(-100%);transition:.2s;z-index:15}body.navopen nav.toc{transform:none}.page{margin-left:0}.navtoggle{display:block}main{padding:18px}}`

const SITE_JS = `document.querySelectorAll('nav.toc a').forEach(a=>a.addEventListener('click',()=>document.body.classList.remove('navopen')));
const tl=[...document.querySelectorAll('.onthispage a')];
if(tl.length){const m=new Map(tl.map(a=>[a.getAttribute('href').slice(1),a]));
const ob=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){tl.forEach(x=>x.classList.remove('on'));const a=m.get(e.target.id);if(a)a.classList.add('on')}}),{rootMargin:'-8% 0px -82% 0px'});
document.querySelectorAll('main h2[id],main h3[id]').forEach(h=>ob.observe(h));}`

// ── 构建 ─────────────────────────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true })
fs.writeFileSync(path.join(OUT, 'assets', 'site.css'), SITE_CSS)
fs.writeFileSync(path.join(OUT, 'assets', 'site.js'), SITE_JS)

const mdFiles = walk(ROOT)
const parsed = new Map(); const titles = new Map()
for (const rel of mdFiles) {
  const r = mdToHtml(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
  parsed.set(rel, r)
  titles.set(rel, r.title || rel.split('/').pop().replace(/\.md$/, ''))
}
const enToZh = (rel) => rel.replace(/\.en\.md$/, '.md')

let count = 0
for (const rel of mdFiles) {
  const r = parsed.get(rel); const htmlRel = htmlPath(rel)
  let langAlt = ''
  if (rel.endsWith('.en.md') && mdFiles.includes(enToZh(rel))) langAlt = htmlPath(enToZh(rel))
  else if (!rel.endsWith('.en.md') && mdFiles.includes(rel.replace(/\.md$/, '.en.md'))) langAlt = htmlPath(rel.replace(/\.md$/, '.en.md'))
  const out = page({ title: titles.get(rel), bodyHtml: r.html, toc: r.toc, navHtml: renderNav(titles, htmlRel), htmlRel, mdRel: rel, langAlt })
  const dest = path.join(OUT, htmlRel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, out)
  count++
}

// 拷贝 docs/ 下所有【非 .md】文件（截图 + 服务端源 .mjs / nginx.conf / admin-ui.html / 完整指南 index.html…
// 让文档里指向源文件的相对链接可达）
function copyNonMd(dir) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) copyNonMd(rel)
    else if (!e.name.endsWith('.md')) { fs.mkdirSync(path.join(OUT, dir), { recursive: true }); fs.copyFileSync(path.join(ROOT, rel), path.join(OUT, rel)) }
  }
}
copyNonMd('docs')
if (fs.existsSync(path.join(ROOT, 'screenshots'))) fs.cpSync(path.join(ROOT, 'screenshots'), path.join(OUT, 'screenshots'), { recursive: true })
// 文档里多处链到根级 .env.example / LICENSE（README 同级、docs/* 用 ../）——拷到站点根，避免站内死链。
for (const f of ['.env.example', 'LICENSE']) if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f))

const card = (rel, desc) => `<a class="dcard" href="${htmlPath(rel)}"><b>${esc(titles.get(rel) || rel)}</b><span>${esc(desc || rel)}</span></a>`
const landing = `<!DOCTYPE html><html lang="zh"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${SITE_TITLE} · 文档站</title><link rel="stylesheet" href="assets/site.css">
</head><body>
<button class="navtoggle" onclick="document.body.classList.toggle('navopen')" aria-label="菜单">☰</button>
<nav class="toc">${renderNav(titles, 'index.html')}</nav>
<div class="page"><main>
<div class="hero"><h1>🪶 ${SITE_TITLE}</h1><p>Chrome MV3 扩展 · 用自然语言操作飞书多维表格/电子表格/文档，并做成 看板/网站/PPT。完整文档一站读完。</p></div>
<p><a class="dcard" style="display:inline-block;border-color:var(--accent)" href="docs/index.html"><b>📖 完整指南（单页）</b><span>概览 / 使用 / 部署 / 架构 / 安全 / 管理台 / 验证 —— 最快上手入口</span></a></p>
<div class="gtitle">入门</div><div class="cards">${card('README.md', '项目说明 + 个人 5 步上手')}${card('docs/QUICKSTART.md', '个人快速部署（5 步）')}${card('docs/USER_GUIDE.md', '使用手册（图文）')}${card('docs/FAQ.md', '常见问题排错')}</div>
<div class="gtitle">部署</div><div class="cards">${card('docs/DEPLOYMENT.md', '部署指南：个人/企业/私有化')}${card('docs/PRIVATE_DEPLOYMENT.md', '私有化/内网完整方案')}${card('docs/STORE_PUBLISHING.md', '上架 Chrome 商店')}${card('docs/enterprise/DEPLOY.md', '企业内部分发(.crx + 策略)')}${card('docs/oauth-proxy/README.md', 'OAuth 代理自托管')}</div>
<div class="gtitle">架构与安全</div><div class="cards">${card('docs/ARCHITECTURE.md', '深结构：模块/工具/坑')}${card('docs/SECURITY_AUDIT.md', '安全逐条审计 + 攻击场景')}${card('docs/PROJECT.md', '一站式：架构/功能/安全/部署')}${card('PRIVACY.md', '隐私政策')}</div>
<div class="gtitle">开发</div><div class="cards">${card('CLAUDE.md', 'Agent 快速上手')}${card('docs/DEVELOPMENT.md', '开发手册')}${card('docs/CHANGELOG.md', '更新日志')}</div>
<p class="foot" style="margin-top:30px">英文文档见左侧 English 分组 · 本站由 <code>scripts/build-docs.mjs</code> 生成 · <a href="${GH}">GitHub</a></p>
</main></div>
<script src="assets/site.js"></script></body></html>`
fs.writeFileSync(path.join(OUT, 'index.html'), landing)
fs.writeFileSync(path.join(OUT, '.nojekyll'), '')

console.log(`✓ 文档站已生成 → site/  （${count} 篇 .md + 首页 + 完整指南；非 .md 源文件/截图已拷贝）`)
