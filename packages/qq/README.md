# @openclaw/qq

OpenClaw 的 QQ 通道插件（OneBot v11 / NapCat 适配）。

## 功能概览
- 路由隔离：`user:<id>`、`group:<id>`、`guild:<guildId>:<channelId>`
- 入站聚合与打断调度（防乱序/防串线）
- 出站统一队列（重试、抖动、失败原因码）
- 媒体链路（解析、落盘、回退、可观测）
- 会话键统一到 `agent:<agentId>:main`（owner 特例仍支持）
- 路由级策略/配额防护
- 轻量上下文模式（按 route 开启，降低 token 压力）

## 安装
统一按仓库根目录文档执行：
- [README.md](../../README.md)
- [AGENTS.md](../../AGENTS.md)

## 最小配置
```json
{
  "channels": {
    "qq": {
      "wsUrl": "ws://127.0.0.1:3001/",
      "accessToken": "YOUR_ONEBOT_ACCESS_TOKEN",
      "ownerUserId": "QQ_OWNER_ID"
    }
  },
  "plugins": {
    "entries": {
      "qq": { "enabled": true }
    }
  }
}
```

## 进阶配置（本地模型推荐）
```json
{
  "channels": {
    "qq": {
      "liteContextRoutes": ["user:*", "group:123456789"],
      "replyRunTimeoutMs": 600000,
      "historyIncludeMedia": false,
      "historyMediaMaxItems": 1
    }
  }
}
```

`liteContextRoutes` 支持：
- 精确匹配：`user:123456789`
- 前缀通配：`user:*`、`group:*`、`guild:*`
- 全局：`*`

## 相关文档
- 日志字段与故障定位：[LOGGING.md](./LOGGING.md)
- NapCat 配置指南：[NAPCAT_SETUP.md](../../NAPCAT_SETUP.md)
- 兼容矩阵：[COMPATIBILITY.md](../../COMPATIBILITY.md)

## 注意事项
- `ownerUserId` 可选；设置后该私聊路由可映射到 `main` agent。
- `proactiveDmRoute` 默认为空，建议通过 `qq-automation-manager` 做配置驱动自动化。
