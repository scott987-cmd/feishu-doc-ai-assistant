<!-- 感谢贡献!请先读 CONTRIBUTING.md。Thanks! Please read CONTRIBUTING.md first. -->

## 这个 PR 做了什么 / What & why

<!-- 简述改动与动机;关联 issue。Briefly describe the change and motivation; link issues. -->

Closes #

## 自检清单 / Checklist

- [ ] `npm run typecheck` 通过(0 错)
- [ ] `npm test` 全绿(新逻辑已补测试 / added tests for new logic)
- [ ] `npm run build` 成功
- [ ] 动了侧边栏 UI → 跑了 `npm run test:ui`(否则忽略)
- [ ] 动了 `docs/*-proxy-server.mjs` / `docs/admin-*` → 跑了 `npm run validate:server`(否则忽略)
- [ ] 行为有变 → 已同步更新文档(`README` / `docs/*`,并保持中英一致)
- [ ] 未提交任何密钥 / `.env.*` / `*.pem`(`.gitignore` 已覆盖)

## 安全边界 / Security boundaries

> 若改动触及以下任一硬边界,请说明如何**保留语义**并**补了测试**(见 [`docs/SECURITY_AUDIT.md`](../docs/SECURITY_AUDIT.md)):
> 仅用户身份(`resolveToken`)· 文件级删除拒绝(`isFileLevelDelete`)· API 白名单(`assertApiCallAllowed`)·
> 出站经 `feishuFetch`/`assertSafeBaseUrl` · 沙箱隔离 · 密钥不进明文包 · 写操作不自动重试。

- [ ] 不涉及上述安全边界,或:已说明并补测试 ⬇️

<!-- 如涉及,在此说明 / If applicable, explain here -->
