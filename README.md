# openclaw-QQ

OpenClaw QQ 生态插件仓库（Monorepo），包含：
- `packages/qq`：QQ 通道插件（OneBot v11）
- `packages/qq-automation-manager`：QQ 路由自动化调度插件（默认仅触发 agent，不旁路代发）

本仓库目标是把 OpenClaw 在 QQ 场景下的“消息收发、会话隔离、媒体链路、自动化触达、可观测性”做成可复用、可运维、可升级的工程化方案。

## 版本基线
- OpenClaw：`>= 2026.2.26`
- NapCatQQ：测试基线 `v4.17.25`
- 协议：OneBot v11（正向 WebSocket）

详细兼容说明见：`COMPATIBILITY.md`

## 插件功能总览

### 1) QQ 通道插件（`packages/qq`）
核心能力：
- QQ 私聊、群聊、频道（guild）路由收发
- 入站消息聚合、去重、会话调度
- 出站消息统一发送队列（重试、抖动、失败分类）
- 媒体链路（图片/语音/文件）解析、回退与落盘
- route 级会话隔离与路由绑定
- route 级策略与配额（文本/媒体/语音）
- 完整结构化日志（trace/chat/gateway）

稳定性相关：
- 中断场景下的出站保护与 drop 原因可解释
- 自动化控制词泄漏拦截（避免把内部控制信息发给用户）
- 发送失败与回退阶段有明确日志字段

### 2) QQ 自动化插件（`packages/qq-automation-manager`）
核心能力：
- 按 route 维护自动化目标（`targets[]`）
- 支持 cron/every/at 调度模型
- 自动触发 route 对应 agent 的一次 `agent turn`
- 默认 `agent-only`：不直接旁路发 QQ，避免双轨会话
- 记录 skip/send/fail 的结构化状态与原因

稳定性策略：
- route 合法性校验（`user:/group:/guild:`）
- 调度状态持久化与幂等更新
- 自动化链路与聊天链路日志口径分离（`source=automation|chat`）

## 项目结构

```text
openclaw-QQ/
├── packages/
│   ├── qq/
│   │   ├── src/
│   │   ├── README.md
│   │   └── LOGGING.md
│   └── qq-automation-manager/
│       ├── src/
│       └── README.md
├── scripts/
│   ├── install.sh
│   └── verify.sh
├── openclaw.example.json
├── NAPCAT_SETUP.md
├── AGENTS.md
├── COMPATIBILITY.md
└── CHANGELOG.md
```

## 安装前置条件

必须满足：
1. 已安装并可运行 OpenClaw（版本满足基线）
2. 已部署 NapCat（Docker 或非 Docker 都可）
3. NapCat OneBot v11 正向 WS 服务已开启
4. OneBot 配置 `messagePostFormat` 必须为 `array`
5. OpenClaw 与 NapCat 网络可达（host/port/token 对齐）

NapCat 详细配置请看：`NAPCAT_SETUP.md`

## 快速安装（Git）

```bash
git clone https://github.com/xingyingyuzhui/openclaw-QQ.git
cd openclaw-QQ
bash scripts/install.sh --openclaw-home "$HOME/.openclaw" --repo-path "$PWD"
```

然后：
1. 将 `openclaw.example.json` 合并到 `~/.openclaw/openclaw.json`
2. 按你的环境填写 `channels.qq.wsUrl` 和 `channels.qq.accessToken`
3. 重启网关：

```bash
openclaw gateway restart
```

验证：

```bash
bash scripts/verify.sh --openclaw-home "$HOME/.openclaw"
```

## npm 安装（可选）

```bash
npm install @openclaw/qq @openclaw/qq-automation-manager
```

说明：
- 该方式要求你的 OpenClaw 扩展加载路径已配置为可解析 npm 包入口。
- 如果你追求部署确定性，建议优先使用 Git 安装方式。

## OpenClaw 配置说明

最小必填配置：
- `channels.qq.wsUrl`
- `channels.qq.accessToken`
- `plugins.allow` 包含：`qq`, `qq-automation-manager`
- `plugins.entries.qq.enabled=true`
- `plugins.entries.qq-automation-manager.enabled=true`

可选 owner 绑定：
- `channels.qq.ownerUserId`
- 或环境变量 `OPENCLAW_QQ_OWNER_ID`

作用：
- 指定 owner 私聊 route 可映射到 `main` agent。

## 自动化配置示例（精简）

```json
{
  "plugins": {
    "entries": {
      "qq-automation-manager": {
        "enabled": true,
        "config": {
          "enabled": true,
          "strictAgentOnly": true,
          "targets": [
            {
              "id": "qq-user-demo",
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
                "message": "请结合上下文自然发起一条简短关怀。",
                "thinking": "low",
                "timeoutSeconds": 120
              }
            }
          ]
        }
      }
    }
  }
}
```

## 日志与排障

建议按三层排障：
1. 网关日志：`${OPENCLAW_HOME}/logs/gateway.log`
2. route 聊天日志：`${OPENCLAW_HOME}/workspace/qq_sessions/<route_key>/logs/chat-*.ndjson`
3. route 追踪日志：`${OPENCLAW_HOME}/workspace/qq_sessions/<route_key>/logs/trace-*.ndjson`

重点字段：
- `route`, `msg_id`, `dispatch_id`, `attempt_id`, `source`
- `resolve_stage`, `resolve_action`, `materialize_error_code`
- `drop_reason`, `retry_count`

详细事件字典见：`packages/qq/LOGGING.md`

## 常见问题

1. QQ 连不上
- 检查 NapCat WS host/port/token 与 OpenClaw 配置是否一致。

2. 媒体消息时好时坏
- 首先确认 `messagePostFormat=array`。
- 再看 trace 日志中的 `materialize_error_code`。

3. 自动化触发了但没有发出
- 看 `qq-automation-manager` 日志中的 `skip_reason`/`triggered`。
- 检查是否启用 `strictAgentOnly` 且 route->agent 映射正常。

4. 会话错位或串流
- 确认 route 格式合法、插件只加载一个版本。
- 查看 trace 中 route/session_key 是否一致。

## 安全与发布说明

- 仓库不包含生产 token、个人路径、私有运行态数据。
- 请不要提交真实 `openclaw.json`、NapCat 登录数据、会话落盘数据。
- 升级时建议先在隔离环境验证：
  - 文本收发
  - 媒体收发
  - 自动化触发

## 相关文档
- Agent 安装导向：`AGENTS.md`
- NapCat 部署细节：`NAPCAT_SETUP.md`
- 兼容矩阵：`COMPATIBILITY.md`
- 变更记录：`CHANGELOG.md`

