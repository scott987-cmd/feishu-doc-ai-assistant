# 企业内部分发（不上架谷歌商店、不用开发者模式）

目标：让员工的 Chrome **自动装上**本扩展，无需任何手动操作、不进 Chrome 商店。
唯一可靠的办法 = **Chrome 企业策略「强制安装」+ 自托管 .crx**。扩展 ID 已用 `key` 固定为
`jhdbgegkmhcopcilclkpioilclemkeog`，所以 .crx、更新清单、策略三者的 ID 始终一致。

> 普通用户**无法**手动拖入 .crx 安装（现代 Chrome 直接拦截非商店扩展）——这正是为什么必须走策略。

---

## 一、打 .crx（已用项目私钥签名，ID 固定）

```bash
# SaaS 包（当前 dist）：
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --pack-extension="$(pwd)/dist" --pack-extension-key="$(pwd)/extension-key.pem" --no-message-box
mv -f dist.crx feishu-ai-saas.crx
```
- 换包（如私有化包）时：先用对应 env `npm run build` 生成 dist，再重打 .crx。
- **每次更新都要把 manifest.json 的 `version` 加一**，并同步改 `update_manifest.xml` 的 version，浏览器才会自动拉新版。
- `extension-key.pem` 是签名私钥，**务必保密、勿入库**（已 gitignore）；丢了会导致 ID 变化、无法平滑更新。

## 二、托管到内网 HTTPS

把这两个文件放到**受管浏览器能访问的 HTTPS 地址**（内网 web/文件服务器、对象存储均可）：
- `feishu-ai-saas.crx`
- `update_manifest.xml`（把里面的 `codebase` 改成 .crx 的真实 URL）

> 必须 HTTPS。http 或不可达会导致策略安装失败。

## 三、下发「强制安装」策略（三选一，按你们的管理方式）

### A. Google Workspace 管理控制台（有 Google 托管账号时最简单）
admin.google.com → 设备 → Chrome → 应用和扩展程序 → 「用户和浏览器」
→ 右下 ➕ →「通过 ID 添加 Chrome 应用或扩展程序」
→ 扩展 ID 填 `jhdbgegkmhcopcilclkpioilclemkeog`，来源选「自定义」并填 `update_manifest.xml` 的 URL
→ 安装策略设为「**强制安装**」→ 保存。
按组织部门(OU)指定可用范围即可。

### B. Windows 组策略（GPO，域环境）
管理模板 → Google → Google Chrome → Extensions → **配置强制安装的应用和扩展程序列表**
（ExtensionInstallForcelist），新增一行：
```
jhdbgegkmhcopcilclkpioilclemkeog;https://YOUR-INTERNAL-HOST/update_manifest.xml
```
（需先导入 Chrome ADMX 模板。）

### C. macOS（MDM）— 推荐，本仓库已带现成描述文件
现成文件：**`docs/enterprise/feishu-ai-chrome-forceinstall.mobileconfig`**
（已含固定扩展 ID + 正确 payload，已通过 plist 校验）。

用法：
1. 把文件里的 `YOUR-INTERNAL-HOST` 改成你托管 `update_manifest.xml` 的内网 HTTPS 地址。
2. 通过你们的 MDM 下发到设备（System scope）。各家控制台位置：
   - **Jamf Pro**：Configuration Profiles → 新建 → **Application & Custom Settings → Upload**
     上传该 .mobileconfig（或 Preference Domain 填 `com.google.Chrome`，粘贴 plist 内容）。
   - **Intune**：设备 → 配置 → 新建「**偏好设置文件 (Preference file)**」配置，
     自定义配置文件名 `com.google.Chrome`，上传该 .mobileconfig。
   - **Kandji**：Library → Add → **Custom Profile** → 上传该 .mobileconfig。
   - **Mosyle / SimpleMDM 等**：Custom Profile / Custom Configuration → 上传该 .mobileconfig。

底层就是给 `com.google.Chrome` 这个 preference domain 写一个**受管**键：
```
ExtensionInstallForcelist = [
  "jhdbgegkmhcopcilclkpioilclemkeog;https://YOUR-INTERNAL-HOST/update_manifest.xml"
]
```
> 注意：必须是 MDM 下发的**受管**偏好（配置描述文件），普通 `defaults write` Chrome 不认。

**验证**（员工机）：`chrome://policy` 能看到 ExtensionInstallForcelist 这条 +
`chrome://extensions` 自动出现该扩展（不可卸载）即成功。生效一般几分钟内，或重启 Chrome。

策略生效后，受管 Chrome 会**自动安装、自动更新、用户不可卸载**，全程零操作。
验证：员工机访问 `chrome://policy` 看到该策略 +`chrome://extensions` 出现该扩展即成功。

---

## 四、别忘了的一次性配套（与分发独立）

### 4.1 飞书应用权限（开放平台 → 应用 → 权限管理）
本扩展**不是机器人**——以**用户本人身份(user_access_token)经 OAuth** 操作，需开通以下 scope，
**且都勾「用户身份」**（后台权限有"应用身份/用户身份"两栏；运行时只用用户身份）：

| scope | 作用 |
|---|---|
| `offline_access` | **必须**：换取 refresh_token，否则 user_access_token 约 **2 小时**失效且无法续期（报 code=99991677） |
| `bitable:app` | 多维表格：建/读/写表、字段、记录、视图 |
| `docx:document` | 新版文档：建文档、读写内容块 |
| `sheets:spreadsheet` | 电子表格：读写区间、行列 |
| `drive:drive` | 云空间：新建文件/文件夹（Base/文档/表格都落云盘） |
| `wiki:wiki` | 知识库：识别/操作 wiki 文档（用到才需） |
| `contact:user.base:readonly` | 读本人基本信息（拿 open_id） |

- 这就是构建用的 `VITE_FEISHU_OAUTH_SCOPE`，**后台开通须与之一致**，少一个则该类操作 403。
- **不需要**（且代码 `API_BLOCKED` 硬禁）：机器人/消息 `im`、通讯录 `contact:contact`、
  转移所有权 `transfer_owner`、权限管理 `permissions`、`admin`。

### 4.2 其余一次性配套
- **重定向 URL**：安全设置 → 重定向 URL 加 `https://jhdbgegkmhcopcilclkpioilclemkeog.chromiumapp.org/`（含末尾斜杠）。
- **发布应用**：创建版本 → 提交发布 → 可用范围设全员/部门（否则只有测试成员能授权）。
- **解锁密码**（加密 secret 方案）：把 `unlock-password.txt` 里的统一密码随使用说明发给用户，
  首次在「设置」解锁一次。
- **大模型 Key**：用户在「设置」各自填（每人自带）。
- **私有化包**：用各自实例的 app_id/secret 重新构建并重打 .crx，托管到内网，策略 codebase 指向它。

## 五、更新流程（发新版）
1. 改代码 → `npm run build` → manifest `version` +1（构建会带上）。
2. 重打 .crx（同私钥）→ 覆盖内网上的 .crx。
3. 把 `update_manifest.xml` 的 `version` 改成新版本号 → 覆盖。
4. 受管浏览器几小时内（或重启后）自动更新；急用可让用户在 `chrome://extensions` 点「立即更新」。
