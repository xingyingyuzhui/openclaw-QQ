# 功能说明（详细版）

本文档详细描述 `openclaw-QQ` 的功能边界、运行机制、配置入口与典型场景。

## 1. 组件与职责

### 1.1 `packages/qq`（QQ 通道插件）
职责：
- 接收 NapCat OneBot v11 入站事件
- 将入站消息规范化为 OpenClaw 可处理的会话输入
- 管理 route 级会话键、能力策略、配额与调度
- 负责出站发送（文本与媒体）以及重试/回退
- 输出结构化诊断日志

### 1.2 `packages/qq-automation-manager`（自动化调度插件）
职责：
- 按 route 执行调度判定（cron/every/at）
- 触发 route 绑定 agent 的 `agent turn`
- 写入自动化状态日志（tick/skip/send/fail）
- 默认不直接旁路发送 QQ 消息（`agent-only`）


## 2. 功能矩阵

| 能力 | QQ 插件 | 自动化插件 |
|---|---|---|
| 私聊/群聊/频道路由 | ✅ | ➖ |
| 文本收发 | ✅ | ➖ |
| 图片/语音/文件收发 | ✅ | ➖ |
| 入站聚合与去重 | ✅ | ➖ |
| route 会话隔离 | ✅ | ✅（依赖） |
| 配额与策略控制 | ✅ | ✅（触发前判定） |
| 定时触发 | ➖ | ✅ |
| 触发 agent turn | ➖ | ✅ |
| 结构化链路日志 | ✅ | ✅ |


## 3. QQ 插件核心机制

### 3.1 route 与会话隔离
支持 route：
- `user:<qq>`
- `group:<groupId>`
- `guild:<guildId>:<channelId>`

会话隔离原则：
- 每个 route 独立状态与会话日志。
- 回复严格返回来源 route，避免跨窗口串流。

### 3.2 入站聚合与调度
- 同 route 短时间消息先聚合再调度。
- 支持中断策略（preempt/queue-latest/adaptive）。
- 可配置 run timeout、中断后回退、drop 归因。

### 3.3 媒体入站解析（非文本）
- 先解析 segment/CQ 结构化信息。
- 再尝试 NapCat action 与 URL/file 多候选解析。
- materialize 阶段记录成功/失败原因码。

### 3.4 出站发送链路
- 文本与媒体统一走发送队列。
- 重试带抖动，避免风控敏感突发。
- 失败必须有 `drop_reason` 或 `error` 可追踪。

### 3.5 策略与配额
可按 route 约束：
- 是否允许文本/媒体/语音
- 每种能力的次数上限
- 允许技能白名单

管理员可通过 QQ 指令管理（见 `packages/qq/src/commands.ts`）。


## 4. 自动化插件核心机制

### 4.1 调度模型
支持：
- `cron`
- `every`
- `at`

### 4.2 触发策略
- `executionMode=agent-only`（默认）：
  - 插件只触发 agent run
  - 实际出站由 QQ 通道插件执行
  - 保证会话、策略、日志口径统一

### 4.3 智能节流（smart）
可配置：
- `minSilenceMinutes`
- `activeConversationMinutes`
- `randomIntervalMinMinutes`
- `randomIntervalMaxMinutes`
- `maxChars`

### 4.4 可观测性
自动化记录：
- `triggered`
- `skipped`
- `lastSkipReason`
- `lastRunResult`
- `run_ms`


## 5. 关键配置项（建议优先关注）

### 5.1 `channels.qq`
- `wsUrl`
- `accessToken`
- `ownerUserId`（可选）
- `aggregateWindowMs`
- `replyRunTimeoutMs`
- `routePreemptOldRun`
- `interruptPolicy`
- `inboundMedia*`
- `streamTransport*`
- `mediaProxy*`

### 5.2 `plugins.entries.qq-automation-manager.config`
- `enabled`
- `reconcileOnStartup`
- `reconcileIntervalMs`
- `strictAgentOnly`
- `targets[]`


## 6. 典型场景

### 场景 A：日常私聊陪伴
- route：`user:<qq>`
- 自动化：白天时段 cron + smart 随机间隔
- 模式：`agent-only`

### 场景 B：群聊助手
- route：`group:<id>`
- 可开启 mention 触发与历史上下文
- 建议保守配额，避免高频噪音

### 场景 C：媒体密集会话
- 保持 `messagePostFormat=array`
- 打开 trace 日志便于追踪 `materialize_error_code`


## 7. 已知边界与注意事项

1. NapCat OneBot 配置不正确（尤其 `messagePostFormat`）会直接影响媒体稳定性。
2. 自动化插件不负责“绕过通道直接发消息”，这是设计约束，不是缺陷。
3. 多套同名插件并存会导致重复加载或路由混乱。
4. 复杂任务耗时受上游模型/工具链影响，非纯通道问题。


## 8. 排障入口

- 总览：`README.md`
- NapCat 部署：`NAPCAT_SETUP.md`
- 日志字典：`packages/qq/LOGGING.md`
- 兼容版本：`COMPATIBILITY.md`

