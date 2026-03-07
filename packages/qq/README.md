# @openclaw/qq

> The QQ channel layer for OpenClaw.
>
> 负责把 QQ 变成一个 route-aware、role-aware、loggable 的 OpenClaw 渠道，而不是一个简单的消息进出适配器。

## 它在解决什么问题

QQ 接入大模型本身不难。
真正困难的是把下面这些事情同时做对：
- 私聊、群聊、频道 route 不串流
- 每个 route 能稳定绑定 agent 和 session
- 媒体、文件、语音不是 lucky path，而是可追踪链路
- 中文管理命令、角色状态、自动化调度能共享同一套事实源
- 系统不会把内部 planning / reasoning 泄漏给用户

`@openclaw/qq` 就是为这些问题存在的。

## 核心观念

### Route before message
这个包首先处理 route，然后才处理消息。

消息只是事件，route 才是长期状态的边界。

### Delivery must be deterministic
出站不是“能发出去就行”，而是：
- 发回哪个 route
- 用什么候选链发送媒体
- 失败如何记录
- 哪些文本必须拦截
都要可解释。

### Role Pack belongs to runtime, not to a giant prompt
角色卡在这里不是一个附属文件，而是 route-bound runtime state。

它与会话、关系、策略、中文命令一起工作，而不是躺在文档里供人欣赏。

## 你会得到什么

### Route-aware channel runtime
- `user:<qq>` / `group:<id>` / `guild:<g>:<c>` route 支持
- resident agent 绑定
- owner -> `main` 特例支持
- route metadata 与 session store 收敛

### Structured inbound / outbound pipeline
- 入站规范化
- 聚合与去重
- 调度保护与状态机
- 文本/媒体统一发送队列
- 媒体 materialize 和 fallback

### Role Pack runtime
- `persona-core.json`
- `style.md`
- `examples.md`
- `qq-rules.md`
- `capabilities.md`
- `relationship.json`
- `preferences.json`
- `role-pack.meta.json`

### Chinese-first operations
- `/角色`
- `/好感度`
- `/关系`
- `/代理`

## Architecture

这个包不是单文件中心化实现。

内部已经分成：
- `services/`
- `state/`
- `inbound/`
- `outbound/`
- `napcat/transport`
- `napcat/contracts`
- `napcat/compat`
- `diagnostics/`

这使它具备三个重要特征：
1. 协议层和业务层分离
2. 运行态状态显式注册，而不是散落在大文件里
3. 关键链路可以单测和回归

更细节的模块关系看：
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [LOGGING.md](./LOGGING.md)

## 与 OpenClaw 的结合点

这个包依赖并强化 OpenClaw 的核心概念：
- agent
- session
- runtime
- channel plugin
- deliveryContext
- automation
- workspace

因此它的价值不是“给 QQ 发消息”，而是让 QQ 成为 OpenClaw 的原生渠道之一。

## 与其它组件的关系

### 与 `@openclaw/qq-automation-manager`
- `@openclaw/qq` 负责渠道层
- `@openclaw/qq-automation-manager` 负责 route 调度层
- 两者共享 Role Pack、route 绑定和日志事实源

### 与 `skills/`
插件提供运行时能力，skills 提供管理面。

如果你只安装这个包，QQ route 依然能运行。
如果你把仓库里的 skills 一起装上，owner 与 agent 才能完整使用角色、关系和自动化管理能力。

## 前置条件

需要一个能稳定提供 OneBot v11 Forward WebSocket 的 QQ 协议侧。
本仓库推荐：
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [NapCat-Docker](https://github.com/NapNeko/NapCat-Docker)

关键要求：
- `messagePostFormat = array`
- token 与 `channels.qq.accessToken` 保持一致

部署细节见：
- [../../NAPCAT_SETUP.md](../../NAPCAT_SETUP.md)

## 安装与配置

从仓库根目录执行：

```bash
bash scripts/install.sh --openclaw-home "$HOME/.openclaw" --repo-path "$PWD"
```

配置至少包括：
- `channels.qq.wsUrl`
- `channels.qq.accessToken`
- `channels.qq.ownerUserId`（可选）

完整例子见：
- [../../openclaw.example.json](../../openclaw.example.json)

## 校验

```bash
pnpm run check
```

包含：
- architecture check
- typecheck
- contract verification
- service coverage verification
- unit tests

## Thanks

感谢以下项目：
- [OpenClaw](https://github.com/openclaw/openclaw)
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ)
- [NapCat-Docker](https://github.com/NapNeko/NapCat-Docker)
- [OneBot v11](https://github.com/botuniverse/onebot-11)
