# @openclaw/qq-automation-manager

`@openclaw/qq-automation-manager` 是 `@openclaw/qq` 的调度伴生插件。

它的职责不是“帮你偷偷发消息”，而是把 QQ 自动化这件事做成 OpenClaw 内部的一等能力：
- route 绑定
- agent-only 执行
- Role Pack/relationship 联动
- 状态可审计

## 定位

如果 `@openclaw/qq` 负责“QQ 怎么收、怎么发、怎么隔离”，
那这个包负责“什么时候触发哪个 QQ agent 去做一轮事”。

所以它本质上是：
- **调度层**
不是：
- **代发层**

## 设计原则

### 1. 只触发 agent，不旁路发送
这是最重要的设计约束。

本插件默认只做：
- 定时判定
- route 解析
- agent 选择
- 触发 run
- 写状态日志

真正的发消息仍然回到 `@openclaw/qq`。

这样可以保证：
- 会话一致
- 角色一致
- 配额一致
- 日志一致

### 2. 自动化必须服从 route 绑定模型
每个 target 都必须绑定显式 QQ route：
- `user:123456789`
- `group:123456789`
- `guild:guild_id:channel_id`

不接受裸数字。

这样可以避免：
- 群/私聊误判
- 假 session
- 错绑 agent

### 3. 自动化不是“定时器”，而是“关系驱动触发器”
这个包不仅看 schedule，还会看：
- 最近入站
- 最近出站
- 沉默窗口
- 活跃窗口
- 随机间隔
- Role Pack 的关系状态

所以它更像：
- “现在适不适合让这个 agent 自然开口”
而不是：
- “时间到了就发一句”

## 核心能力

### 1. 配置驱动 targets
从 `openclaw.json` 读取：
- `plugins.entries.qq-automation-manager.config.targets[]`

每个 target 可独立配置：
- route
- schedule
- message
- timeout
- smart skip

### 2. 调度模型
支持：
- `cron`
- `every`
- `at`

### 3. Smart skip
当 `job.smart.enabled = true` 时，会综合：
- 最近 inbound activity
- 最近 outbound activity
- 随机间隔窗口
- `relationship.json`

目前支持的关系敏感参数：
- `lowInitiativeExtraSilenceMinutes`
- `lowAffinityExtraSilenceMinutes`
- `coldStageSkip`

### 4. Role Pack 联动
自动化会读取 route 绑定 agent 的：
- `role-pack.meta.json`
- `persona-core.json`
- `style.md`
- `relationship.json`

用途：
- 更自然地决定是否跳过
- 让主动消息风格与该 agent 保持一致
- 让自动化和日常聊天共享一套角色事实源

## 与 OpenClaw 的结合方式

这个包不绕开 OpenClaw。

它依赖：
- OpenClaw 的 agent run
- route -> agent 绑定规则
- QQ 插件的 delivery path
- workspace / session 元数据

所以它的价值不是“多一个 cron”，而是：
- **把自动化纳入 OpenClaw 的 agent/session/role 体系中**

## 与 `@openclaw/qq` 的关系

必须先安装：
- [../qq](../qq)

推荐同时安装技能：
- [../../skills/qq-automation-admin](../../skills/qq-automation-admin)
- [../../skills/qq-capability-index](../../skills/qq-capability-index)

## 快速例子

```json
{
  "plugins": {
    "entries": {
      "qq-automation-manager": {
        "enabled": true,
        "config": {
          "enabled": true,
          "targets": [
            {
              "id": "qq-user-123456789-daylife",
              "enabled": true,
              "route": "user:123456789",
              "executionMode": "agent-only",
              "job": {
                "type": "cron-agent-turn",
                "schedule": {
                  "kind": "cron",
                  "expr": "*/5 9-22 * * *",
                  "tz": "Asia/Shanghai"
                },
                "message": "结合近期上下文，自然发起一句简短关怀。",
                "thinking": "low",
                "timeoutSeconds": 120,
                "smart": {
                  "enabled": true,
                  "minSilenceMinutes": 30,
                  "activeConversationMinutes": 25,
                  "randomIntervalMinMinutes": 30,
                  "randomIntervalMaxMinutes": 60,
                  "maxChars": 48
                }
              }
            }
          ]
        }
      }
    }
  }
}
```

## 校验

```bash
pnpm run check
```

## 感谢

这个包建立在这些项目之上：
- [OpenClaw](https://github.com/openclaw/openclaw)
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)

其中 OpenClaw 提供调度和 agent runtime 基础，NapCatQQ 提供 QQ 协议侧能力。
