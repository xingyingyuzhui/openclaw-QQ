# @openclaw/qq

`@openclaw/qq` 是一个面向 [OpenClaw](https://github.com/openclaw/openclaw) 的 QQ 渠道插件，不是独立 bot 框架。

它的职责是把 QQ 变成 OpenClaw 的一个高约束、可追踪、可维护的渠道层。

## 设计目标

这个插件重点解决四件事：

1. **route 绑定**
- QQ 私聊、群聊、频道要稳定映射到固定 agent / 固定会话语义

2. **媒体稳定性**
- 图片、语音、文件不能只靠一次 lucky path
- 要有候选链、fallback、原因码、日志闭环

3. **运行时边界**
- 不允许跨 route 串流
- 不允许裸数字目标猜测 user/group
- 不允许内部思考直接泄漏到用户侧

4. **OpenClaw 深度结合**
- 会话
- agent 绑定
- Role Pack
- deliveryContext
- 自动化触发
- 中文管理命令
都必须和 OpenClaw 主体系一致

## 这不是一个“QQ 机器人插件”

如果你的理解是：
- 收消息
- 调 LLM
- 发回去

那只理解了最表层。

这个包真正做的是：
- 构建 `QQ route -> OpenClaw agent -> OpenClaw session -> QQ delivery` 的稳定映射
- 让 QQ 成为 OpenClaw 内部系统的一部分，而不是外挂入口

## 核心能力

### 1. 路由与会话模型
支持：
- `user:<qq>`
- `group:<groupId>`
- `guild:<guildId>:<channelId>`

原则：
- 每个 route 独立隔离
- owner 私聊可绑定 `main`
- 其它 route 默认绑定各自 resident agent
- 所有出站默认回原 route

### 2. 入站链路
- NapCat / OneBot 事件接入
- 消息归一化
- route 判定
- 聚合与去重
- 调度保护（queue-latest / adaptive 等）
- session 写入与上下文组装

### 3. 出站链路
- 文本与媒体统一发送队列
- 重试与抖动
- fallback 与 drop reason
- `MEDIA:` 路径解析
- 媒体候选构建与 materialize

### 4. Role Pack 内建支持
每个 QQ route agent 都可以绑定：
- `persona-core.json`
- `style.md`
- `examples.md`
- `qq-rules.md`
- `capabilities.md`
- `relationship.json`
- `preferences.json`
- `role-pack.meta.json`

这让 QQ agent 具备：
- 稳定人设
- 风格一致性
- 关系状态
- 中文管理命令支撑

### 5. 中文命令
内置支持：
- `/角色 查看`
- `/角色 模板`
- `/角色 导入`
- `/角色 重置`
- `/好感度`
- `/好感度 设置`
- `/关系 查看`
- `/关系 重置`
- `/代理 查看`
- `/代理 修复`

这些命令不是玩具命令，而是 QQ route agent 管理面的正式入口。

## 架构特点

### 分层而不是大文件堆逻辑
当前插件不是把所有逻辑塞进一个 `channel.ts`，而是分成：
- `services/`
- `state/`
- `inbound/`
- `outbound/`
- `napcat/transport`
- `napcat/contracts`
- `napcat/compat`
- `diagnostics/`

这样做的意义是：
- NapCat 契约与业务逻辑解耦
- route 状态与业务行为解耦
- 出站、入站、自动化协作点可测试

### NapCat 强类型契约
NapCat 动作不是 scattered string calls。

插件内部通过：
- typed action contracts
- compatibility fallback
- structured invoke trace
来保证：
- 升级可控
- 失败可解释
- 覆盖率可检查

### 日志是第一等能力
这个包不是“出问题再加日志”。

默认就有：
- chat log
- trace log
- gateway log
- NapCat action lifecycle log

排障入口见：
- [LOGGING.md](./LOGGING.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)

## 与 OpenClaw 的结合点

这个插件依赖 OpenClaw 的核心概念，而不是绕开它们：
- agent
- session
- runtime
- channel plugin
- deliveryContext
- automation
- workspace

所以它的价值不只是“QQ 接上了”，而是：
- QQ 成为了 OpenClaw 原生渠道的一部分
- route agent 可以拥有自己的规则、角色、自动化和记忆

## 前置条件

### OpenClaw
- 推荐 `>= 2026.2.26`

### NapCat / OneBot
必须满足：
- OneBot v11 Forward WebSocket
- `messagePostFormat = array`
- token 与 `channels.qq.accessToken` 一致

这部分是渠道接入前提，不是仓库主角。
详细看：
- [../../NAPCAT_SETUP.md](../../NAPCAT_SETUP.md)

## 安装

从仓库根目录：

```bash
bash scripts/install.sh --openclaw-home "$HOME/.openclaw" --repo-path "$PWD"
```

如果只开发这个包，也可以单独同步到 `${OPENCLAW_HOME}/extensions/qq`。

## 配置

在 `openclaw.json` 中至少设置：
- `channels.qq.wsUrl`
- `channels.qq.accessToken`
- `channels.qq.ownerUserId`（可选）

并确保：
- `plugins.allow` 包含 `qq`
- `plugins.entries.qq.enabled = true`

完整示例见：
- [../../openclaw.example.json](../../openclaw.example.json)

## 与 skills 的关系

这个包本身已经包含：
- 角色卡机制
- 关系状态
- 中文命令

但如果你想让人类或 agent 方便管理这套能力，还应该一起安装：
- [../../skills/qq-role-manager](../../skills/qq-role-manager)
- [../../skills/qq-relationship-manager](../../skills/qq-relationship-manager)
- [../../skills/qq-agent-admin](../../skills/qq-agent-admin)
- [../../skills/qq-owner-console](../../skills/qq-owner-console)
- [../../skills/qq-capability-index](../../skills/qq-capability-index)

## 校验

```bash
pnpm run check
```

当前校验包括：
- architecture check
- typecheck
- NapCat contract verification
- service coverage verification
- unit tests

## 感谢

这个包站在以下项目之上：
- [OpenClaw](https://github.com/openclaw/openclaw)
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [NapCat-Docker](https://github.com/NapNeko/NapCat-Docker)
- [OneBot v11](https://github.com/botuniverse/onebot-11)

感谢这些项目提供稳定边界和基础能力。
