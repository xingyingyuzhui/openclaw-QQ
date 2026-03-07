---
name: qq-agent-admin
description: Use when inspecting or repairing QQ route 与专属 agent 的绑定状态，包括 workspace、角色包是否存在、是否需要补齐默认文件。
metadata: {"openclaw":{"emoji":"🛠️","disableModelInvocation":true}}
---

# qq-agent-admin

先查 route 对应角色包：
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py show --route user:123456789
```

再查 agent 可见性：
```bash
openclaw agents list --json
```

规则：
- 不要改 route -> agent 的既有绑定规则。
- 修复优先级：角色包缺失 > workspace 缺文件 > agent 不可见。
- owner route `user:QQ_OWNER_ID` 始终视为 `main` 特例。
