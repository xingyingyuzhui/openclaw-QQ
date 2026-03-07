# @openclaw/qq-automation-manager

> The route scheduler for QQ-bound OpenClaw agents.
>
> 它决定“什么时候该唤起哪个 QQ route agent”，而不是“替它发什么消息”。

## 它解决的不是 cron，而是一致性

很多自动化功能的问题不在“定时器能不能跑”，而在：
- 自动化是否绕过主会话
- 自动化是否破坏角色一致性
- 自动化是否把日志和配额搞成双轨
- 自动化是否对 route / agent / relationship state 一无所知

这个包的目标就是避免这些问题。

## 核心原则

### Trigger, do not bypass
它只触发 agent run，不直接旁路发送 QQ 消息。

这样做的结果是：
- 会话一致
- 角色一致
- 配额一致
- 日志一致

### Route is the security boundary
每个 target 都必须绑定显式 route：
- `user:123456789`
- `group:123456789`
- `guild:guild_id:channel_id`

裸数字无效。

### Automation should respect relationship state
自动化不是“时间到了发一句”。

它会参考：
- 最近入站
- 最近出站
- 沉默窗口
- 活跃窗口
- 随机间隔
- Role Pack 的关系状态

所以它更像 route agent 的延伸，而不是一个外置 cron bot。

## 你会得到什么

- `targets[]` 配置驱动调度
- `cron / every / at` 支持
- route -> agent 解析
- `agent-only` 执行模式
- smart skip
- Role Pack / relationship 联动
- 状态落盘与审计

## 与 `@openclaw/qq` 的关系

这个包不能单独理解。

它必须与：
- [../qq](../qq)
配合使用。

`@openclaw/qq` 负责：
- 渠道
- route
- delivery
- Role Pack runtime

`@openclaw/qq-automation-manager` 负责：
- 调度
- 触发
- 判断何时适合唤起该 route agent

## 与 skills 的关系

推荐一起安装：
- [../../skills/qq-automation-admin](../../skills/qq-automation-admin)
- [../../skills/qq-capability-index](../../skills/qq-capability-index)

这样 agent 和 owner 才能直接管理 targets、核对状态和审计结果。

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

## Thanks

感谢：
- [OpenClaw](https://github.com/openclaw/openclaw)
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)

OpenClaw 提供调度与 agent runtime 基础，NapCatQQ 提供 QQ 协议侧能力。
