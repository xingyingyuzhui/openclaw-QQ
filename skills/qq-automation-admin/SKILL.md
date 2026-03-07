---
name: qq-automation-admin
description: Manage QQ automation targets in openclaw.json as single source of truth for qq-automation-manager.
metadata: {"openclaw":{"emoji":"⏱️","disableModelInvocation":true}}
---

# qq-automation-admin

Use this skill when user wants to add/update/disable QQ proactive automation targets.

Design rule:
- Single source of truth is `${OPENCLAW_HOME}/openclaw.json`.
- Only edit `plugins.entries["qq-automation-manager"].config.targets`.
- Enforce **agent-only** mode: automation only triggers agent turns and records status.
- Never configure direct delivery fields (`delivery.*`) in targets.
- Do not directly create/edit cron jobs with `openclaw cron add/edit` during normal operations.
- 对于图片/文件/语音等产物型自动化，优先让目标 agent 直接产出可发送结果（如 `MEDIA:` 本地路径），由 QQ 插件按当前会话规则发送。
- 不把内部思考、计划、推理、自言自语或工具前分析发给用户。

## Commands

List targets:
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-automation-admin/scripts/qq_auto_targets.py list
```

Create or update target:
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-automation-admin/scripts/qq_auto_targets.py upsert \
  --id qq-user-123456789-weekday \
  --route user:123456789 \
  --cron "*/30 9-22 * * 1-5" \
  --message "结合最近对话，自然延续当前关系与话题，给出一句有温度但不过界的主动消息。" \
  --min-silence 30 \
  --active-window 25 \
  --random-min 30 \
  --random-max 60
```


Disable target:
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-automation-admin/scripts/qq_auto_targets.py disable --id qq-user-123456789-weekday
```

Remove target:
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-automation-admin/scripts/qq_auto_targets.py remove --id qq-user-123456789-weekday
```

Migrate existing targets to agent-only mode:
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-automation-admin/scripts/qq_auto_targets.py migrate-agent-only
```

Audit targets for non-agent-only fields:
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-automation-admin/scripts/qq_auto_targets.py audit
```

## Apply behavior

- Gateway usually auto-reloads config after write.
- If user asks immediate apply/verification, run:
```bash
openclaw gateway restart
```

Internal scheduler verification (agent-only mode):
```bash
# 0) Static verification against config + state files
python3 ${OPENCLAW_HOME}/workspace/skills/qq-automation-admin/scripts/qq_auto_targets.py verify --id qq-user-123456789-daylife

# 1) Check manager logs
openclaw logs --follow | rg "qq-automation-manager|internal scheduler|triggered target|strictAgentOnly"

# 2) Check route state files (route may be user:... or user__...)
ls -la ${OPENCLAW_HOME}/workspace/qq_sessions/user__123456789/meta
cat ${OPENCLAW_HOME}/workspace/qq_sessions/user__123456789/meta/automation-latest.json
```

Verification expectations:
- `executionMode=agent-only`
- no `delivery` field on target
- manager writes `automation-latest.json` and appends `automation-state.ndjson`
- required record fields include: `triggered/produced/skipped/sent_by_channel/trace`

Note: manager uses internal scheduler (`cron/every/at`) and triggers route agent turns only.
