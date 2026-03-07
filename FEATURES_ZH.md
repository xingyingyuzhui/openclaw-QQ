# 功能与设计说明

这不是一份“接口清单”。

`openclaw-QQ` 的重点不在于“支持多少个 QQ 动作”，而在于这些能力如何被组织成一套长期可运行、可维护、可审计的 OpenClaw 渠道系统。

如果根 README 解释的是“为什么要这样设计”，这份文档解释的就是：
- 这套设计具体由哪些能力构成
- 这些能力分别落在哪一层
- 它们如何一起工作

## 1. 功能总览

| 能力域 | 具体能力 | 所在层 |
|---|---|---|
| 渠道接入 | 私聊 / 群聊 / 频道消息收发 | `packages/qq` |
| 路由模型 | `user:/group:/guild:` route 绑定 agent | `packages/qq` |
| 会话一致性 | route 隔离、resident agent、deliveryContext | `packages/qq` |
| 媒体链路 | 图片 / 文件 / 语音发送与入站 materialize | `packages/qq` |
| 出站稳定性 | 发送队列、重试、fallback、drop reason | `packages/qq` |
| 角色体系 | Role Pack、关系状态、偏好状态 | `packages/qq` |
| 管理入口 | 中文命令、owner 管理、agent 修复 | `packages/qq` + `skills/` |
| 自动化 | route 级定时触发、smart skip | `packages/qq-automation-manager` |
| 可观测性 | trace / chat / gateway / action lifecycle logs | `packages/qq` + `qq-automation-manager` |

## 2. 渠道层：QQ 不只是收发消息

### 2.1 route 绑定
QQ 插件的第一职责不是“收消息”，而是把消息放进正确的 route。

支持：
- `user:<qq>`
- `group:<groupId>`
- `guild:<guildId>:<channelId>`

这意味着：
- 私聊和群聊不会因为同为数字 id 而混淆
- 每个 route 都可以绑定固定 agent
- 后续的自动化、角色卡、关系状态都建立在这层之上

### 2.2 会话一致性
QQ 插件会维护：
- route -> agent 绑定
- session key 生成与迁移
- deliveryContext
- route metadata

所以它不是“把消息推给模型”，而是在维护一个长期会话系统。

### 2.3 入站调度
入站链路不是简单直通。

它会处理：
- 聚合
- 去重
- 中断策略
- 调度状态机
- 历史拼装
- route 级上下文约束

这决定了 QQ 场景下的稳定性，而不是模型本身。

## 3. 媒体链路：不是 lucky path

### 3.1 入站媒体
对图片、语音、文件，插件会做：
- segment/CQ 解析
- action 候选尝试
- URL / file / stream / base64 候选回退
- materialize 落盘
- unresolved 原因记录

### 3.2 出站媒体
对 `MEDIA:` 路径或其它媒体载荷，插件会做：
- 类型识别
- 路径/URL 归一化
- 本地文件候选
- HTTP/base64 回退
- NapCat stream / legacy action 尝试
- 统一发送日志

也就是说，媒体支持不是“会不会发一张图”，而是：
- 能不能解释失败
- 能不能回归验证
- 能不能在不同 NapCat 版本下保持兼容

## 4. Role Pack：人格不是 prompt 附件

Role Pack 是 QQ route agent 的结构化运行时资产，而不是一段随手写的系统提示。

默认结构：

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

### 4.1 它解决什么问题
- 角色信息不再和 QQ 规则混写
- 关系状态可结构化持久化
- agent 不需要每轮都重新吞一大段 prompt
- 自动化和日常聊天共享同一套角色事实源

### 4.2 它和中文命令的关系
中文命令不是独立功能，而是 Role Pack 的管理面：
- `/角色`
- `/好感度`
- `/关系`
- `/代理`

这些命令本质上是在修改或查询 Role Pack / relationship state / route metadata。

## 5. 自动化层：调度，而不是代发

### 5.1 为什么单独拆插件
自动化不应该直接挤进渠道插件里。

拆出来的好处是：
- 消息链路和调度链路职责分开
- 自动化不会偷偷绕过出站链路
- 出错时更容易判断是“调度问题”还是“通道问题”

### 5.2 自动化到底做什么
`qq-automation-manager` 负责：
- 读 `targets[]`
- route -> agent 解析
- schedule 触发
- smart skip 判定
- 状态落盘

它不负责：
- 直接发消息
- 绕过 route 规则
- 建立另一套会话体系

### 5.3 smart skip 不只是时间窗口
smart skip 可以结合：
- 最近 inbound/outbound
- 最小静默时间
- 活跃窗口
- 随机区间
- `relationship.json` 中的 affinity / initiative 等状态

这让主动消息更像 route agent 的延伸，而不是“定时器每隔多久冒一句”。

## 6. skills：管理面，而不是装饰品

仓库里的 skills 不是锦上添花，而是这套系统的“操作层”。

包括：
- `qq-role-manager`
- `qq-relationship-manager`
- `qq-agent-admin`
- `qq-owner-console`
- `qq-capability-index`
- `qq-automation-admin`

它们的作用是：
- 帮 agent 理解 QQ 体系能做什么
- 帮 owner 管理 route、角色、关系和自动化
- 避免把管理逻辑硬塞回 prompt

## 7. 日志与可观测性

这套仓库的一个核心优点是：日志不是补丁，而是架构的一部分。

可用日志面包括：
- route chat log
- route trace log
- gateway log
- NapCat action lifecycle trace
- automation state records

这样你在排障时可以明确区分：
- 是协议层失败
- 是 route 解析失败
- 是媒体 materialize 失败
- 是调度/自动化判定跳过
- 是策略/配额阻断

## 8. 为什么它比“QQ 机器人 + prompt”更稳

因为它把真正复杂的部分都显式建模了：
- route
- session
- agent binding
- deliveryContext
- role pack
- automation state
- media lifecycle
- logging

这也是它的价值所在。

你可以把它理解成：

> 一套把 OpenClaw 正式带进 QQ 场景的运行时系统。

而不是：

> 一份给 QQ 消息接个模型的脚本集合。

## 9. 延伸阅读

- 总览与理念：[README.md](./README.md)
- QQ 插件架构：[packages/qq/README.md](./packages/qq/README.md)
- 自动化插件：[packages/qq-automation-manager/README.md](./packages/qq-automation-manager/README.md)
- NapCat 部署：[NAPCAT_SETUP.md](./NAPCAT_SETUP.md)
- 兼容矩阵：[COMPATIBILITY.md](./COMPATIBILITY.md)
