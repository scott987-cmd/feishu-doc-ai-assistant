> 🌐 [English](QUICKSTART.en.md) | **中文**

# 个人快速部署（5 步上手）

> 面向**个人自用**（自己装、自己用，不发别人/不上架）。企业/私有化见 [`DEPLOYMENT.md`](DEPLOYMENT.md) / [`PRIVATE_DEPLOYMENT.md`](PRIVATE_DEPLOYMENT.md)。
> 卡住了看 [`FAQ.md`](FAQ.md)。

整体只需：**配飞书应用 → 填构建配置 → 一键打包 → 加载 → 授权用**。

---

## 1. 创建并配置飞书应用

1. 打开 **[open.feishu.cn](https://open.feishu.cn) → 开发者后台 → 创建企业自建应用**，记下 **App ID** 和 **App Secret**。
2. **权限管理**：开通以下 scope，**每个都勾「用户身份」**（本扩展始终以你本人身份操作，不用应用身份）：

   | scope | 作用 | 必须? |
   |---|---|---|
   | `offline_access` | 换 refresh_token（否则 token ~2h 失效报 99991677） | **必须** |
   | `bitable:app` | 多维表格：建/读/写表、字段、记录 | 用到才需 |
   | `docx:document` | 文档：读/写内容块 | 用到才需 |
   | `sheets:spreadsheet` | 电子表格：读写区间/行列 | 用到才需 |
   | `drive:drive` | 云空间：新建 Base/文档/表格 | 用到才需 |
   | `wiki:wiki` | 知识库里识别/操作 | 用到才需 |
   | `contact:user.base:readonly` | 取本人 open_id | 建议 |

   **不要开**（代码也硬禁）：`im`、`contact:contact`、`transfer_owner`、`permissions`、`admin`。

3. **安全设置 → 重定向 URL**：添加 `https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/`（含末尾斜杠）。
   > 这个 ID 由仓库内置签名 key 固定。若你 fork 后换了自己的 key，请改成你自己的扩展 ID 对应的回调。
4. **可用范围**：把你自己加进去（或全员）。
5. **发布**：创建版本 → 提交发布（测试阶段也可只把自己加为「测试成员」即时生效）。

> 改了权限后，若应用是「已发布」，要**再创建一版并发布**才生效。

---

## 2. 配置构建（`.env.local`）

```bash
git clone <repo> && cd feishu-doc-ai-assistant
npm install
cp .env.example .env.local        # 已被 .gitignore，安全
```

填 `.env.local`，个人推荐二选一：

**A. 直连·明文（最简单，纯自用）**
```bash
VITE_FEISHU_APP_ID=cli_你的AppID
VITE_FEISHU_APP_SECRET=你的AppSecret
```

**B. 直连·密码加密（推荐：secret 不以明文进包）**
```bash
node scripts/encrypt-secret.mjs      # 按提示输入 App Secret + 自设解锁密码 → 输出密文
# 然后填：
VITE_FEISHU_APP_ID=cli_你的AppID
VITE_FEISHU_APP_SECRET_ENC=上一步输出的密文
VITE_FEISHU_APP_SECRET=              # 留空！
```
用 B 时，安装后首次在「设置 → 飞书鉴权」**输入一次解锁密码**即可。

> - `offline_access` 等 scope 代码已**自动请求**，无需在此重复配置。
> - **大模型 Key 不在构建里**——运行时在扩展「设置」里填（OpenAI 兼容，默认 DeepSeek）。
> - 不想内置任何凭据？三个 secret 变量全留空也行，运行时在设置里粘贴你自己的 `user_access_token`。

---

## 3. 一键打包

```bash
npm run pack
```
自动完成：构建 → 打 `dist/` →压缩成 `feishu-doc-ai-assistant.zip`（→ 有签名私钥时再出 `.crx`）。
个人自用**只需 `dist/`**；zip 用于备份/发别人。

> 只想构建不打包：`npm run build`（产出 `dist/`）。

---

## 4. 加载到 Chrome

1. `chrome://extensions` → 右上**开发者模式**打开。
2. **「加载已解压的扩展程序」** → 选 **`dist/`** 目录。
3. 固定到工具栏（可选）。扩展 ID 会是 `jhdbgegk…`（与第 1 步重定向 URL 对应）。

---

## 5. 首次使用

1. 打开任意飞书**多维表格 / 电子表格 / 文档**页面 → 点扩展图标唤出**侧边栏**。
2. **设置**里：
   - （若用了加密版 B）**输入解锁密码**。
   - 点 **用飞书账号授权**（走 OAuth，拿到你本人的 token）。
   - 填 **大模型 API Key**（如 DeepSeek 的 `sk-…`）。
3. 回对话框，一句话开干：「新建一个项目管理表，含名称/状态/负责人/截止日期，并加 5 条示例」。

---

## 常见卡点

| 现象 | 解决 |
|---|---|
| 授权报 **20027 / 需开通 offline_access** | 第 1 步把 `offline_access` 开通并（已发布的话）重新发版 → 重授权 |
| 读文档报错 / "识别不了文档" | 开通 `docx:document`（用户身份）+ 重授权 |
| 403 无权限 | 该资源不是你本人的/没共享给你；用你有权限的账号操作 |
| 加密版用不了 | 设置里先**输入解锁密码**解锁，再授权 |
| 改了代码要重验 | `npm run build` → `chrome://extensions` 点该扩展 **🔄 刷新** |

更多见 [`FAQ.md`](FAQ.md)。
