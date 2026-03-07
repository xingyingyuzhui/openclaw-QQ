# openclaw-QQ

`openclaw-QQ` 不是一个“独立 QQ 机器人”仓库，而是一套围绕 [OpenClaw](https://github.com/openclaw/openclaw) 构建的 QQ 渠道基础设施。

它解决的核心问题不是“怎么接上 QQ”，而是：
- 如何让 `user:/group:/guild:` 路由稳定绑定到 OpenClaw agent
- 如何在 QQ 场景下保持会话隔离、角色一致性、自动化一致性
- 如何把媒体链路、日志链路、权限边界和管理能力收敛到同一套系统里

## 仓库包含什么

- [`packages/qq`](./packages/qq)
  - QQ 通道插件
  - 负责入站、出站、媒体、路由绑定、会话隔离、策略/配额、Role Pack 落盘、中文命令
- [`packages/qq-automation-manager`](./packages/qq-automation-manager)
  - QQ 自动化插件
  - 负责按 route 调度对应 agent 的任务，不旁路发送消息
- [`skills/`](./skills)
  - 一组围绕 QQ agent 运行体系的配套技能
  - 包括角色管理、关系管理、owner 管理、能力索引、自动化配置

## 为什么这套架构值得用

### 1. 它是 OpenClaw-first，不是 QQ-bot-first
很多 QQ 项目本质是“机器人接个大模型”。

这套不是。

这里的第一事实源是 OpenClaw：
- agent
- session
- route
- deliveryContext
- automation
- role pack

QQ 只是一个高约束、可审计、可回归的渠道层。

### 2. Route 绑定是系统级能力，不是 prompt 小技巧
QQ 的难点不是收发文本，而是避免：
- 群聊/私聊串流
- 目标误判
- 假 session
- 假 agent
- 自动化和主会话双轨运行

这个仓库把这些问题收敛成固定模型：
- `user:<qq>` -> 固定 agent
- `group:<id>` -> 固定 agent
- `guild:<g>:<c>` -> 固定 agent
- owner 私聊 -> `main`

### 3. 自动化不会绕过主链路
`qq-automation-manager` 不是一个偷偷代发消息的定时器。

它只做：
- 调度
- route 判定
- 触发对应 agent
- 记录状态

真正的发消息仍然回到同一个 QQ 通道插件，所以：
- 会话一致
- 角色一致
- 日志一致
- 权限边界一致

### 4. 角色卡机制是系统内建能力，不是额外贴 prompt
Role Pack 不是一个附加噱头，而是 route agent 的稳定组成部分。

它把这些东西分开管理：
- 角色本体
- 风格
- 示例
- QQ 通道规则
- 能力索引
- 关系状态
- 偏好状态

这比把所有设定塞进一个 system prompt 更稳，也更省 token。

## 组件分层

| 层 | 位置 | 作用 |
|---|---|---|
| 渠道层 | [`packages/qq`](./packages/qq) | QQ 入站/出站、媒体、路由、日志 |
| 调度层 | [`packages/qq-automation-manager`](./packages/qq-automation-manager) | route 级自动化与触发 |
| 角色层 | `packages/qq` 内置 Role Pack | 人设、关系、规则、能力索引 |
| 管理层 | [`skills/`](./skills) | owner/agent 的操作入口 |

## 适合什么场景

- 你已经在用 OpenClaw，希望把 QQ 变成稳定渠道
- 你需要 route 绑定 agent，而不是一个全局大机器人
- 你需要自动化，但不想破坏会话一致性
- 你需要角色卡/关系状态/中文管理命令
- 你需要可追踪日志和可回归的媒体链路

## 快速开始

1. 安装 NapCat 并打开 OneBot v11 Forward WebSocket
2. 安装 [`packages/qq`](./packages/qq)
3. 安装 [`packages/qq-automation-manager`](./packages/qq-automation-manager)
4. 把 [`skills/`](./skills) 同步到 `${OPENCLAW_HOME}/workspace/skills/`
5. 合并 [`openclaw.example.json`](./openclaw.example.json)
6. 重启 gateway 并执行验证脚本

详细步骤：
- [AGENTS.md](./AGENTS.md)
- [NAPCAT_SETUP.md](./NAPCAT_SETUP.md)
- [COMPATIBILITY.md](./COMPATIBILITY.md)

## 推荐阅读顺序

### 人类部署者
1. [NAPCAT_SETUP.md](./NAPCAT_SETUP.md)
2. [packages/qq/README.md](./packages/qq/README.md)
3. [packages/qq-automation-manager/README.md](./packages/qq-automation-manager/README.md)
4. [AGENTS.md](./AGENTS.md)

### OpenClaw agent / 自动化安装器
1. [AGENTS.md](./AGENTS.md)
2. [openclaw.example.json](./openclaw.example.json)
3. [skills/qq-capability-index/SKILL.md](./skills/qq-capability-index/SKILL.md)
4. [skills/qq-automation-admin/SKILL.md](./skills/qq-automation-admin/SKILL.md)

## 感谢与依赖

这个仓库建立在多个上游项目之上：

- [OpenClaw](https://github.com/openclaw/openclaw)
  - 提供 agent、session、runtime、gateway、automation 等核心基础设施
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
  - 提供 QQ 协议侧与 OneBot 能力
- [NapCat-Docker](https://github.com/NapNeko/NapCat-Docker)
  - 提供稳定的容器部署方案
- [OneBot v11](https://github.com/botuniverse/onebot-11)
  - 提供标准化消息协议抽象

感谢这些项目提供的能力边界和工程基础。

## 当前仓库的定位

一句话：

**这是把 OpenClaw 认真带进 QQ 场景的一套工程化实现，而不是把 QQ 接口拼成一个聊天机器人。**
