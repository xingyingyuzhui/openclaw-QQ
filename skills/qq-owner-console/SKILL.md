---
name: qq-owner-console
description: Use when the owner/main agent needs to manage other QQ route agents: 导入角色、切模板、查看关系状态、修复 agent 资源或自动化配置。
metadata: {"openclaw":{"emoji":"👑","disableModelInvocation":true}}
---

# qq-owner-console

owner/main 可以跨 route 管理，但必须显式带 route。

示例：
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py show --route user:123456789
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py template --route user:123456789 --template 助手型
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py set-affinity --route user:123456789 --value 70
```

规则：
- 只做管理，不直接破坏目标 route 的 sessions。
- `main` 自己的人设不要被普通 route 模板覆盖。
- 自动化配置仍以 `openclaw.json` 和 `qq-automation-manager` 为准。
