
OpenClawd 是一个多功能代理。下面的聊天演示仅展示了最基础的功能。
# OpenClaw QQ 插件 (OneBot v11)

本插件通过 OneBot v11 协议（WebSocket）为 [OpenClaw](https://github.com/openclaw/openclaw) 添加全功能的 QQ 频道支持。它不仅支持基础聊天，还集成了群管、频道、多模态交互和生产级风控能力。

## ✨ 核心特性

### 🧠 深度智能与上下文
*   **历史回溯 (Context)**：在群聊中自动获取最近 N 条历史消息（默认 5 条），让 AI 能理解对话前文，不再“健忘”。
*   **系统提示词 (System Prompt)**：支持注入自定义提示词，让 Bot 扮演特定角色（如“猫娘”、“严厉的管理员”）。
*   **转发消息理解**：AI 能够解析并读取用户发送的合并转发聊天记录，处理复杂信息。
*   **关键词唤醒**：除了 @机器人，支持配置特定的关键词（如“小助手”）来触发对话。

### 🛡️ 强大的管理与风控
*   **连接自愈**：内置心跳检测与重连指数退避机制，能自动识别并修复“僵尸连接”，确保 7x24 小时在线。
*   **群管指令**：管理员可直接在 QQ 中使用指令管理群成员（禁言/踢出）。
*   **严格路由隔离**：入站会话按 `user:/group:/guild:` 固定路由，默认回复严格回到原窗口，避免“群里触发却发到私聊”。
*   **全局单线程发送队列**：所有文本/媒体发送统一串行排队并带随机抖动，降低 QQ 风控触发概率。
*   **会话落盘目录**：自动在 `qq_sessions/<route>/` 下创建 `in/ out/ logs/ memory/`，按天写入 `logs/chat-YYYY-MM-DD.ndjson`。
*   **任务调度落盘**：重任务会写入 `qq_sessions/<route>/meta/task-lifecycle.ndjson`（状态 `queued -> running -> succeeded|failed|timeout`，包含 taskKey/msgId/dispatchId/retry/error/result 摘要）。
*   **黑白名单**：
    *   **群组白名单**：只在指定的群组中响应，避免被拉入广告群。
    *   **用户黑名单**：屏蔽恶意用户的骚扰。
*   **自动请求处理**：可配置自动通过好友申请和入群邀请，实现无人值守运营。
*   **生产级风控**：
    *   **默认 @ 触发**：默认开启 `requireMention`，仅在被 @ 时回复，保护 Token 并不打扰他人。
    *   **速率限制**：发送多条消息时自动插入随机延迟，防止被 QQ 风控禁言。
    *   **URL 规避**：自动对链接进行处理（如加空格），降低被系统吞消息的概率。
    *   **系统号屏蔽**：自动过滤 QQ 管家等系统账号的干扰。

### 🎭 丰富的交互体验
*   **戳一戳 (Poke)**：当用户“戳一戳”机器人时，AI 会感知到并做出有趣的回应。
*   **拟人化回复**：
    *   **自动 @**：在群聊回复时，自动 @原发送者（仅在第一段消息），符合人类社交礼仪。
    *   **昵称解析**：将消息中的 `[CQ:at]` 代码转换为真实昵称（如 `@张三`），AI 回复更自然。
*   **多模态支持**：
    *   **图片**：支持收发图片。优化了对 `base64://` 格式的支持，即使 Bot 与 OneBot 服务端不在同一局域网也可正常交互。
    *   **语音**：接收语音消息（需服务端支持 STT）并可选开启 TTS 语音回复。
    *   **文件**：支持群文件和私聊文件的收发。
*   **角色与关系状态**：
    *   **Role Pack**：每个 QQ route 绑定 agent 都可携带独立角色包、关系状态和能力索引。
    *   **严格 route 约束**：QQ 目标事实源只来自当前会话的 `deliveryContext` 或 owner 显式 route，禁止裸数字猜测。
*   **QQ 频道 (Guild)**：原生支持 QQ 频道消息收发。

---

## 📋 前置条件

1.  **OpenClaw**：已安装并运行 OpenClaw 主程序。
2.  **OneBot v11 服务端**：你需要一个运行中的 OneBot v11 实现。
    *   推荐：**[NapCat (Docker)](https://github.com/NapCatQQ/NapCat-Docker)** 或 **Lagrange**。
    *   **重要配置**：请务必在 OneBot 配置中将 `message_post_format` 设置为 `array`（数组格式），否则无法解析多媒体消息。
    *   网络：确保开启了正向 WebSocket 服务（通常端口为 3001）。

---

## 🚀 安装指南

### 方法 1: 使用 OpenClaw CLI (推荐)
如果你的 OpenClaw 版本支持插件市场或 CLI 安装：
```bash
# 进入插件目录
cd openclaw/extensions
# 克隆仓库
git clone https://github.com/constansino/openclaw_qq.git qq
# 安装依赖并构建
cd ../..
pnpm install && pnpm build
```

### 方法 2: Docker 集成
在你的 `docker-compose.yml` 或 `Dockerfile` 中，将本插件代码复制到 `/app/extensions/qq` 目录，然后重新构建镜像。

---

## 🔄 本地开发部署（避免重启后依赖丢失）

如果你是在 `tmp_openclaw_qq` 开发并同步到 `~/.openclaw/extensions/qq`，请不要再手动 `rsync --delete`。
使用下面命令会自动：
1) 同步代码（保留目标 `node_modules` 不被删）
2) 安装运行时依赖（`npm install --omit=dev`）

```bash
cd ${OPENCLAW_HOME}/workspace/tmp_openclaw_qq
npm run deploy:local
openclaw gateway restart
```

---

## ⚙️ 配置说明

### 1. 快速配置 (CLI 向导)
插件内置了交互式配置脚本，助你快速生成配置文件。
在插件目录 (`openclaw/extensions/qq`) 下运行：

```bash
node bin/onboard.js
```
按照提示输入 WebSocket 地址（如 `ws://localhost:3001`）、Token 和管理员 QQ 号即可。

### 2. 标准化配置 (OpenClaw Setup)
如果已集成到 OpenClaw CLI，可运行：
```bash
openclaw setup qq
```

### 3. 手动配置详解 (`openclaw.json`)
你也可以直接编辑配置文件。以下是完整配置清单：

```json
{
  "channels": {
    "qq": {
      "wsUrl": "ws://127.0.0.1:3001",
      "accessToken": "你的Token",
      "admins": [12345678, 87654321],
      "allowedGroups": [10001, 10002],
      "blockedUsers": [999999],
      "systemPrompt": "你是一个名为“人工智障”的QQ机器人，说话风格要风趣幽默。",
      "historyLimit": 5,
      "keywordTriggers": ["小助手", "帮助"],
      "autoApproveRequests": true,
      "enableGuilds": true,
      "enableTTS": false,
      "rateLimitMs": 1000,
      "formatMarkdown": true,
      "antiRiskMode": false,
      "maxMessageLength": 4000
    }
  },
  "plugins": {
    "entries": {
      "qq": { "enabled": true }
    }
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `wsUrl` | string | **必填** | OneBot v11 WebSocket 地址 |
| `accessToken` | string | - | 连接鉴权 Token |
| `admins` | number[] | `[]` | **管理员 QQ 号列表**。拥有执行 `/status`, `/kick` 等指令的权限。 |
| `requireMention` | boolean | `true` | **是否需要 @ 触发**。设为 `true` 仅在被 @ 或回复机器人时响应。 |
| `allowedGroups` | number[] | `[]` | **群组白名单**。若设置，Bot 仅在这些群组响应；若为空，则响应所有群组。 |
| `blockedUsers` | number[] | `[]` | **用户黑名单**。Bot 将忽略这些用户的消息。 |
| `systemPrompt` | string | - | **人设设定**。注入到 AI 上下文的系统提示词。 |
| `historyLimit` | number | `5` | **历史消息条数**。群聊时携带最近 N 条消息给 AI，设为 0 关闭。 |
| `keywordTriggers` | string[] | `[]` | **关键词触发**。群聊中无需 @，包含这些词也会触发回复。 |
| `autoApproveRequests` | boolean | `false` | 是否自动通过好友申请和群邀请。 |
| `enableGuilds` | boolean | `true` | 是否开启 QQ 频道 (Guild) 支持。 |
| `enableTTS` | boolean | `false` | (实验性) 是否将 AI 回复转为语音发送 (需服务端支持 TTS)。 |
| `rateLimitMs` | number | `1000` | **发送限速**。多条消息间的延迟(毫秒)，建议设为 1000 以防风控。 |
| `formatMarkdown` | boolean | `false` | 是否将 Markdown 表格/列表转换为易读的纯文本排版。 |
| `antiRiskMode` | boolean | `false` | 是否开启风控规避（如给 URL 加空格）。 |
| `maxMessageLength` | number | `4000` | 单条消息最大长度，超过将自动分片发送。 |
| `mediaProxyEnabled` | boolean | `false` | 为 HTTP 媒体启用代理 URL 改写（供 NapCat 容器访问）。 |
| `publicBaseUrl` | string | `""` | NapCat 可访问的 OpenClaw 对外地址，如 `http://192.168.1.10:18789`。 |
| `mediaProxyPath` | string | `"/qq/media"` | 代理路径（与网关路由保持一致）。 |
| `mediaProxyToken` | string | `""` | 可选媒体代理访问令牌。 |
| `voiceBasePath` | string | `""` | 相对语音路径的基准目录。 |
| `mediaHttpFallbackToBase64` | boolean | `true` | HTTP 媒体发送失败时回退为 base64。 |

---

## 🎮 使用指南

### 🗣️ 基础聊天
*   **私聊**：直接发送消息给机器人即可。
*   **群聊**：
    *   **@机器人** + 消息。
    *   回复机器人的消息。
    *   发送包含**关键词**（如配置中的“小助手”）的消息。
    *   **戳一戳**机器人头像。

### 👮‍♂️ 管理员指令
仅配置在 `admins` 列表中的用户可用：

*   `/status`
    *   查看机器人运行状态（内存占用、连接状态、Self ID）。
*   `/help`
    *   显示帮助菜单。
*   `/mute @用户 [分钟]` (仅群聊)
    *   禁言指定用户。不填时间默认 30 分钟。
    *   示例：`/mute @张三 10`
*   `/kick @用户` (仅群聊)
    *   将指定用户移出群聊。

### 中文管理命令

QQ 侧采用中文命令优先：

*   `/角色 查看 [route]`
*   `/角色 重置 [route] [彻底]`
*   `/角色 模板 [route] <陪伴型|助手型>`
*   `/角色 导入 [route] 文件 <路径>`
*   `/角色 导入 [route] 文本 <设定>`
*   `/好感度 [route]`
*   `/好感度 设置 [route] <0-100>`
*   `/关系 查看 [route]`
*   `/关系 重置 [route]`
*   `/代理 查看 [route]`
*   `/代理 修复 [route]`
规则：

*   非 owner 默认只能管理当前 route。
*   owner `user:QQ_OWNER_ID` 可显式指定其他 route。

### 💻 CLI 命令行使用
如果你在服务器终端操作 OpenClaw，可以使用以下标准命令：

1.  **查看状态**
    ```bash
    openclaw status
    ```
    显示 QQ 连接状态、延迟及当前 Bot 昵称。

2.  **列出群组/频道**
    ```bash
    openclaw list-groups --channel qq
    ```
    列出所有已加入的群聊和频道 ID。

3.  **主动发送消息**
    ```bash
    # 发送私聊
    openclaw send qq 12345678 "你好，这是测试消息"
    
    # 发送群聊 (使用 group: 前缀)
    openclaw send qq group:88888888 "大家好"
    
    # 发送频道消息
    openclaw send qq guild:GUILD_ID:CHANNEL_ID "频道消息"
    ```

---

## ❓ 常见问题 (FAQ)

## 🧰 运维与排障（新增）

### 1) 报错：`无法获取用户信息`
- 这是 NapCat 在发送阶段构造上下文失败时的常见错误（常见于私聊上下文或目标解析异常）。
- 请同时查看：
  - NapCat 容器日志（错误栈）
  - OpenClaw gateway.err.log（对应 send action / target / retry）
- 新版插件会输出结构化发送日志：`account/route/target/action/retry`，可用于快速定位。

### 2) 报错：`duplicate plugin id detected`
- 说明存在多个 `qq` 插件目录同时被扫描。
- 只保留一个 qq 插件源码目录在扩展扫描路径中，其他目录必须移出 `extensions/`。

### 3) 报错：`mkdir '//qq_sessions'`
- 旧版本路径拼接错误导致写入根目录失败。
- 新版已改为基于 workspace 根路径写入：`<workspace>/qq_sessions/...`。

### 4) 迁移旧会话 key（旧版与新版并存时）
- 脚本位置：`scripts/migrate-session-keys.mjs`
- 默认处理：`${OPENCLAW_HOME}/agents/main/sessions/sessions.json`
- 对 `user:QQ_OWNER_ID`（Owner）会额外将 `qq-user-QQ_OWNER_ID` 旧 key 重写到 `agent:main:qq:user:QQ_OWNER_ID`

```bash
# Dry-run（仅查看映射）
node scripts/migrate-session-keys.mjs

# 应用迁移（自动备份原 sessions.json）
node scripts/migrate-session-keys.mjs --apply
```

### Resident per-conversation agents
- QQ 入站会话不再固定写入 `main`，而是按路由绑定常驻 agent：
  - **Owner 私聊特例**：`user:QQ_OWNER_ID` 强制绑定 `agentId: main`
  - Owner 会话键固定为：`agent:main:qq:user:QQ_OWNER_ID`
  - 不会为 Owner 私聊使用 `qq-user-QQ_OWNER_ID`
  - `user:<id>` -> `agentId: qq-user-<id>`
  - `group:<id>` -> `agentId: qq-group-<id>`
  - `guild:<g>:<c>` -> `agentId: qq-guild-<g>-<c>`
- 会话键统一为：
  - Owner：`agent:main:qq:user:QQ_OWNER_ID`
  - 其他 route：`agent:<agentId>:main`
- 每个路由会在工作区写入元数据：
  - `qq_sessions/<route>/agent.json`
  - 含 `capabilities` 策略，默认低权限：`sendText: true`, `sendMedia: false`, `sendVoice: false`, `skills: []`
  - Owner 私聊元数据会标记 `boundToMain: true`，避免与常驻路由策略冲突
- 自动回复链路默认绑定原路由，避免跨窗口误发；显式目标发送仍可通过 `to` 指定目标。

### Role Pack 目录结构

每个 QQ route agent workspace 下都可以包含：

```text
character/persona-core.json
character/style.md
character/examples.md
channel/qq-rules.md
channel/capabilities.md
runtime/relationship.json
runtime/preferences.json
runtime/role-pack.meta.json
```

这些文件分别承载：

*   `persona-core.json`：身份、关系定位、核心风格与边界
*   `style.md`：口吻、节奏、表达偏好
*   `examples.md`：仅在必要时按需注入的风格示例
*   `qq-rules.md`：QQ 专属约束，不与角色本体混写
*   `capabilities.md`：能力域索引，不暴露底层 NapCat 动作名
*   `relationship.json`：好感度、信任、主动性等结构化状态

### Route 安全规则

*   QQ route 必须显式写成 `user:<qq>` / `group:<id>` / `guild:<g>:<c>`。
*   裸数字目标视为无效输入，不做自动猜测。
*   普通 QQ agent 不应自行指定 QQ 目标；当前会话的目标由 `deliveryContext` 决定。
*   owner 跨 route 管理也必须使用显式 route，不做模糊补全。


**Q: 安装依赖时报错 `openclaw @workspace:*` 找不到？**
A: 这是因为主仓库的 workspace 协议导致的。我们已在最新版本中将其修复，请执行 `git pull` 后直接使用 `pnpm install` 或 `npm install` 即可，无需特殊环境。

**Q: 给机器人发图片它没反应？**
A: 
1. 确认你使用的 OneBot 实现（如 NapCat）开启了图片上报。
2. 建议在 OneBot 配置中开启“图片转 Base64”，这样即使你的 OpenClaw 在公网云服务器上，也能正常接收本地内网机器人的图片。
3. 插件现在会自动识别并提取图片，不再强制要求开启 `message_post_format: array`。

**Q: 机器人与 OneBot 不在同一个网络环境（非局域网）能用吗？**
A: **完全可以**。只要 `wsUrl` 能够通过内网穿透或公网 IP 访问到，且图片通过 Base64 传输，即可实现跨地域部署。

**Q: 为什么群聊不回话？**
A: 
1. 检查 `requireMention` 是否开启（默认开启），需要 @机器人。
2. 检查群组是否在 `allowedGroups` 白名单内（如果设置了的话）。
3. 检查 OneBot 日志，确认消息是否已上报。

**Q: 如何让 Bot 说话（TTS）？**
A: 将 `enableTTS` 设为 `true`。注意：这取决于 OneBot 服务端是否支持 TTS 转换。通常 NapCat/Lagrange 对此支持有限，可能需要额外插件。

---

## 🆚 与 Telegram 插件的功能区别

如果您习惯使用 OpenClaw 的 Telegram 插件，以下是 `openclaw_qq` 在体验上的主要差异：

| 功能特性 | QQ 插件 (openclaw_qq) | Telegram 插件 | 体验差异说明 |
| :--- | :--- | :--- | :--- |
| **消息排版** | **纯文本** | **原生 Markdown** | QQ 不支持加粗、代码块高亮，插件会自动转换排版。 |
| **流式输出** | ❌ 不支持 | ✅ 支持 | TG 可实时看到 AI 打字；QQ 需等待 AI 生成完毕后整段发送。 |
| **消息编辑** | ❌ 不支持 | ✅ 支持 | TG 可修改已发内容；QQ 发送后无法修改，只能撤回。 |
| **交互按钮** | ❌ 暂不支持 | ✅ 支持 | TG 消息下方可带按钮；QQ 目前完全依靠文本指令。 |
| **风控等级** | 🔴 **极高** | 🟢 **极低** | QQ 极易因回复过快或敏感词封号，插件已内置分片限速。 |
| **戳一戳** | ✅ **特色支持** | ❌ 不支持 | QQ 特有的社交互动，AI 可感知并回应。 |
| **转发消息** | ✅ **深度支持** | ❌ 基础支持 | QQ 插件专门优化了对“合并转发”聊天记录的解析。 |
