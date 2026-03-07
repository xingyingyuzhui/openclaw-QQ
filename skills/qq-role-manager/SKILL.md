---
name: qq-role-manager
description: Use when managing QQ route角色卡/人设包: 导入角色卡、切换模板、重置角色、查看当前角色摘要。适用于专属 QQ agent 的角色层管理。
metadata: {"openclaw":{"emoji":"🎭","disableModelInvocation":true}}
---

# qq-role-manager

用这个 skill 管理 QQ route 的角色包，不要直接散改多个文件。

共享脚本：
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py show --route user:123456789
```

常用操作：
```bash
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py template --route user:123456789 --template 陪伴型
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py import --route user:123456789 --file /absolute/path/to/card.json
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py import --route user:123456789 --text "角色设定文本"
python3 ${OPENCLAW_HOME}/workspace/skills/qq-role-manager/scripts/qq_role_admin.py reset --route user:123456789
```

规则：
- 角色导入后，运行时只认 OpenClaw 原生角色包，不直接把外部角色卡当事实源。
- 优先保留 route 绑定，不要改 agentId 与 route 的对应关系。
- 若用户只说“调一下人设”，先 `show`，再最小改动。
