---
name: qq-capability-index
description: Use when a QQ-bound agent needs to understand what QQ channel capabilities exist by domain, without loading all NapCat 接口细节 into prompt.
metadata: {"openclaw":{"emoji":"📚","disableModelInvocation":true}}
---

# qq-capability-index

按能力域理解 QQ 能力，不要把所有底层接口当常驻知识。

能力域：
- 文本与多轮对话
- 当前 QQ 会话绑定交付
- 图片/语音/文件发送
- 入站媒体理解与转写
- 群资料、群文件、社交动作
- 自动化触达与关系状态联动
- owner 管理与 route 修复

使用原则：
- 先判断当前问题属于哪个能力域。
- 纯对话优先直接 reply。
- 产物型任务优先直接给出当前会话可发送的结果，例如 `MEDIA:` 本地路径，由 QQ 插件发送。
- 不把内部思考、计划、推理、自言自语或工具前分析发给用户，只输出最终可见答复。
- 不要使用通用 `message` 工具向 QQ 任意目标发消息。
- 只在需要时再加载对应 skill 或细节说明。
- 不要把 100+ 个 NapCat action 名字塞进常驻上下文。
