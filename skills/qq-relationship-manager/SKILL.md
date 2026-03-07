---
name: qq-relationship-manager
description: Use when reading or adjusting QQ route 的关系状态，比如好感度、信任度、主动性，以及重置关系状态。
metadata: {"openclaw":{"emoji":"💞","disableModelInvocation":true}}
---

# qq-relationship-manager

共享脚本来自 `qq-role-manager`：
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py show --route user:123456789
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py set-affinity --route user:123456789 --value 78
```

规则：
- 第一版关系状态以结构化数值为准，好感度范围 `0-100`。
- 不要通过自然语言猜测后直接落盘；先读当前值，再调整。
- 若用户要求“重置关系”，可直接走 `reset`，但要说明这会回到模板基线。
