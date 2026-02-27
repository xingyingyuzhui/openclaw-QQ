---
name: qq-automation-admin
description: 管理 openclaw.json 中 qq-automation-manager 的 targets，作为 QQ 自动化唯一配置事实源。
metadata: {"openclaw":{"emoji":"⏱️","disableModelInvocation":true}}
---

# qq-automation-admin

当用户要新增/更新/禁用 QQ 自动化目标时使用本技能。

## 设计约束
- 唯一事实源：`${OPENCLAW_HOME}/openclaw.json`。
- 仅编辑：`plugins.entries["qq-automation-manager"].config.targets`。
- 强制 `agent-only`：自动化仅触发 agent turn，不旁路代发。
- 不写入 `delivery.*` 字段。
- 日常操作不要直接 `openclaw cron add/edit`。

## 前置变量
```bash
export OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
export QQ_AUTO_SCRIPT="/path/to/openclaw-QQ/skills/qq-automation-admin/scripts/qq_auto_targets.py"
```

## 常用命令

列出目标：
```bash
python3 "$QQ_AUTO_SCRIPT" list --openclaw-home "$OPENCLAW_HOME"
```

新增或更新目标：
```bash
python3 "$QQ_AUTO_SCRIPT" upsert \
  --openclaw-home "$OPENCLAW_HOME" \
  --id qq-user-123456789-daylife \
  --route user:123456789 \
  --cron "*/30 9-22 * * 1-5" \
  --message "结合最近对话，自然延续当前关系与话题，给出一句有温度但不过界的主动消息。" \
  --min-silence 30 \
  --active-window 25 \
  --random-min 30 \
  --random-max 60
```

禁用目标：
```bash
python3 "$QQ_AUTO_SCRIPT" disable --openclaw-home "$OPENCLAW_HOME" --id qq-user-123456789-daylife
```

删除目标：
```bash
python3 "$QQ_AUTO_SCRIPT" remove --openclaw-home "$OPENCLAW_HOME" --id qq-user-123456789-daylife
```

批量迁移为 agent-only：
```bash
python3 "$QQ_AUTO_SCRIPT" migrate-agent-only --openclaw-home "$OPENCLAW_HOME"
```

审计不合规目标：
```bash
python3 "$QQ_AUTO_SCRIPT" audit --openclaw-home "$OPENCLAW_HOME"
```

验证目标与状态落盘：
```bash
python3 "$QQ_AUTO_SCRIPT" verify --openclaw-home "$OPENCLAW_HOME" --id qq-user-123456789-daylife
```

## 应用与验证
配置落盘后通常网关会自动加载；若需立即生效：
```bash
openclaw gateway restart
```

跟踪日志：
```bash
openclaw logs --follow | rg "qq-automation-manager|internal scheduler|triggered target|strictAgentOnly"
```

## 验收标准
- `executionMode=agent-only`
- 目标无 `delivery` 字段
- 对应 route 的 `meta/automation-latest.json` 与 `automation-state.ndjson` 存在并持续更新
