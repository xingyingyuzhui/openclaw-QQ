#!/usr/bin/env python3
import argparse
import base64
import json
import os
import pathlib
import struct
import sys
from typing import Any

OPENCLAW_HOME = pathlib.Path(os.environ.get("OPENCLAW_HOME", str(pathlib.Path.home() / ".openclaw")))
OWNER_ROUTE = f"user:{os.environ.get('OPENCLAW_QQ_OWNER_ID', 'QQ_OWNER_ID').strip()}"


def route_agent_id(route: str) -> str:
    if route == OWNER_ROUTE:
        return "main"
    if route.startswith("user:"):
        return f"qq-user-{route.split(':', 1)[1]}"
    if route.startswith("group:"):
        return f"qq-group-{route.split(':', 1)[1]}"
    if route.startswith("guild:"):
        _, g, c = route.split(":", 2)
        return f"qq-guild-{g}-{c}"
    raise ValueError(f"invalid route: {route}")


def route_workspace(route: str) -> pathlib.Path:
    agent_id = route_agent_id(route)
    if agent_id == "main":
        return OPENCLAW_HOME / "workspace"
    return OPENCLAW_HOME / f"workspace-{agent_id}"


def paths(route: str) -> dict[str, pathlib.Path]:
    ws = route_workspace(route)
    return {
        "ws": ws,
        "persona": ws / "character" / "persona-core.json",
        "style": ws / "character" / "style.md",
        "examples": ws / "character" / "examples.md",
        "qq_rules": ws / "channel" / "qq-rules.md",
        "caps": ws / "channel" / "capabilities.md",
        "relationship": ws / "runtime" / "relationship.json",
        "preferences": ws / "runtime" / "preferences.json",
        "meta": ws / "runtime" / "role-pack.meta.json",
    }


def ensure_parent(p: pathlib.Path):
    p.parent.mkdir(parents=True, exist_ok=True)


def write_json(p: pathlib.Path, data: Any):
    ensure_parent(p)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_text(p: pathlib.Path, text: str):
    ensure_parent(p)
    p.write_text(text.rstrip() + "\n", encoding="utf-8")


def read_json(p: pathlib.Path, default: Any):
    try:
        return json.loads(p.read_text(encoding="utf-8") or "null")
    except Exception:
        return default


def now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def stage(affinity: int) -> str:
    if affinity >= 85:
        return "devoted"
    if affinity >= 65:
        return "close"
    if affinity >= 40:
        return "familiar"
    return "distant"


def default_template(route: str) -> str:
    return "default-companion" if route.startswith("user:") else "default-assistant"


def template_payload(template_id: str) -> dict[str, Any]:
    ts = now_iso()
    if template_id == "default-assistant":
        persona = {
            "version": 1,
            "templateId": template_id,
            "name": "未命名助理",
            "identity": "你是一个自然、克制、可靠的对话型助理角色。",
            "relationship": "优先清晰沟通、给结论、再补背景。",
            "tone": ["清晰", "克制", "高信息密度", "少模板感"],
            "boundaries": ["不跨 route 串流", "不泄露内部状态", "不强行亲密化"],
            "directives": ["先结论后细节", "尽量短句", "必要时再扩展"],
            "tags": ["assistant", "qq"],
            "source": {"kind": "template", "label": template_id, "importedAt": ts},
        }
        style = "- 优先给结论，再补必要说明。\n- 不要项目经理口吻。\n- 群聊中注意边界。"
    else:
        persona = {
            "version": 1,
            "templateId": template_id,
            "name": "未命名陪伴者",
            "identity": "你是一个有边界感、但带温度的陪伴型角色。",
            "relationship": "优先以熟人/亲近陪伴的方式交流，先接住情绪，再处理问题。",
            "tone": ["自然", "温柔", "短句", "少助手腔"],
            "boundaries": ["不跨 route 串流", "不无故说教", "不把内部状态原样发给用户"],
            "directives": ["先人后事", "优先自然回复", "必要时再调用能力"],
            "tags": ["companion", "qq"],
            "source": {"kind": "template", "label": template_id, "importedAt": ts},
        }
        style = "- 口吻自然，像熟人聊天。\n- 日常优先短句，不要汇报腔。\n- 对方有情绪先接住。"
    return {
        "persona": persona,
        "style": style,
        "examples": "用户：今天好烦。\n你：我在，先别硬扛。你跟我说说。",
        "relationship": {
            "affinity": 50,
            "affinity_stage": "familiar",
            "trust": 50,
            "initiative_level": "medium",
            "last_reset_at": None,
            "updated_at": ts,
        },
        "preferences": {
            "preferred_address": "你",
            "user_display_name": "",
            "emoji_style": "light",
            "updated_at": ts,
        },
        "meta": {
            "version": 1,
            "route": "",
            "agentId": "",
            "templateId": template_id,
            "source": "default",
            "importedFrom": template_id,
            "updatedAt": ts,
        },
    }


def apply_template(route: str, template_id: str):
    p = paths(route)
    payload = template_payload(template_id)
    payload["meta"]["route"] = route
    payload["meta"]["agentId"] = route_agent_id(route)
    write_json(p["persona"], payload["persona"])
    write_text(p["style"], payload["style"])
    write_text(p["examples"], payload["examples"])
    write_text(p["qq_rules"], "# QQ 通道规则\n\n- 绑定当前 route。\n- 不要跨 route 串流。\n- 不要调用通用 message 工具向其他 user:/group: 发消息。\n- 纯对话直接回复。\n- 需要发图片、语音、文件时，直接输出 MEDIA: 本地路径，由 QQ 插件代发。")
    write_text(p["caps"], "# QQ 能力域\n\n- 文本回复\n- 当前 QQ 会话绑定交付\n- 媒体与文件\n- 群资料与文件\n- 社交动作\n- 自动化与关系状态\n- 不把内部思考过程发给用户，只输出最终可见答复")
    write_json(p["relationship"], payload["relationship"])
    write_json(p["preferences"], payload["preferences"])
    write_json(p["meta"], payload["meta"])


def read_text(p: pathlib.Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except Exception:
        return ""


def parse_json_seed(raw: str, label: str) -> dict[str, Any]:
    data = json.loads(raw or "{}")
    if isinstance(data.get("data"), dict):
        data = data["data"]
    desc = data.get("description") or data.get("character_description") or data.get("personality") or ""
    scen = data.get("scenario") or data.get("world_scenario") or ""
    creator = data.get("creator_notes") or data.get("system_prompt") or data.get("post_history_instructions") or ""
    first = data.get("first_mes") or data.get("first_message") or ""
    example = data.get("mes_example") or data.get("example_dialogue") or data.get("example_dialogues") or ""
    return {
        "name": data.get("name") or data.get("character_name") or "未命名角色",
        "identity": (desc or scen or "你是一个需要保持稳定风格和关系边界的角色。").strip(),
        "relationship": (scen or creator or "根据当前会话关系自然交流，避免脱离上下文。").strip(),
        "style": "\n\n".join([x for x in [desc, creator] if x]).strip(),
        "examples": "\n\n".join([x for x in [first, example] if x]).strip(),
        "tags": data.get("tags") or [],
        "label": label,
    }


def parse_png_seed(raw: bytes, label: str) -> dict[str, Any]:
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        return {"name": "未命名角色", "identity": "", "relationship": "", "style": "", "examples": "", "tags": [], "label": label}
    offset = 8
    while offset + 12 <= len(raw):
        length = struct.unpack(">I", raw[offset:offset + 4])[0]
        ctype = raw[offset + 4:offset + 8]
        data_start = offset + 8
        data_end = data_start + length
        if data_end + 4 > len(raw):
            break
        if ctype in (b"tEXt", b"iTXt", b"zTXt"):
            text = raw[data_start:data_end].decode("latin1", errors="ignore")
            idx = text.find("chara")
            if idx != -1:
                maybe = text[idx + 5:].lstrip("\x00")
                try:
                    decoded = base64.b64decode(maybe.strip()).decode("utf-8", errors="ignore")
                    if decoded.strip().startswith("{"):
                        return parse_json_seed(decoded, label)
                except Exception:
                    pass
        offset = data_end + 4
        if ctype == b"IEND":
            break
    return {"name": "未命名角色", "identity": "", "relationship": "", "style": "", "examples": "", "tags": [], "label": label}


def import_source(route: str, *, text: str | None = None, file_path: str | None = None):
    p = paths(route)
    if file_path:
        src = pathlib.Path(file_path).expanduser().resolve()
        if src.suffix.lower() == ".json":
            seed = parse_json_seed(src.read_text(encoding="utf-8"), src.name)
        elif src.suffix.lower() == ".png":
            seed = parse_png_seed(src.read_bytes(), src.name)
        else:
            raw = src.read_text(encoding="utf-8")
            seed = {
                "name": "未命名角色",
                "identity": raw.strip()[:400],
                "relationship": raw.strip()[:240],
                "style": raw.strip(),
                "examples": raw.strip()[:400],
                "tags": [],
                "label": src.name,
            }
    else:
        raw = (text or "").strip()
        seed = {
            "name": "未命名角色",
            "identity": raw[:400],
            "relationship": raw[:240],
            "style": raw,
            "examples": raw[:400],
            "tags": [],
            "label": "inline-text",
        }
    ts = now_iso()
    persona = {
        "version": 1,
        "templateId": default_template(route),
        "name": seed["name"],
        "identity": seed["identity"] or "你是一个需要保持稳定风格和关系边界的角色。",
        "relationship": seed["relationship"] or "根据当前会话关系自然交流，避免脱离上下文。",
        "tone": [x.strip(" -") for x in seed["style"].splitlines() if x.strip()][:6],
        "boundaries": ["不跨 route 串流", "不把内部状态原样发给用户"],
        "directives": [x.strip(" -") for x in seed["style"].splitlines() if x.strip()][:6],
        "tags": seed["tags"][:12] if isinstance(seed["tags"], list) else [],
        "source": {"kind": "file" if file_path else "text", "label": seed["label"], "importedAt": ts},
    }
    write_json(p["persona"], persona)
    write_text(p["style"], seed["style"] or persona["identity"])
    write_text(p["examples"], seed["examples"])
    write_text(p["qq_rules"], "# QQ 通道规则\n\n- 绑定当前 route。\n- 不要跨 route 串流。\n- 不要调用通用 message 工具向其他 user:/group: 发消息。\n- 纯对话直接回复。\n- 需要发图片、语音、文件时，直接输出 MEDIA: 本地路径，由 QQ 插件代发。")
    write_text(p["caps"], "# QQ 能力域\n\n- 文本回复\n- 当前 QQ 会话绑定交付\n- 媒体与文件\n- 群资料与文件\n- 社交动作\n- 自动化与关系状态\n- 不把内部思考过程发给用户，只输出最终可见答复")
    write_json(p["relationship"], {
        "affinity": 50,
        "affinity_stage": "familiar",
        "trust": 50,
        "initiative_level": "medium",
        "last_reset_at": None,
        "updated_at": ts,
    })
    write_json(p["preferences"], {
        "preferred_address": "你",
        "user_display_name": "",
        "emoji_style": "light",
        "updated_at": ts,
    })
    write_json(p["meta"], {
        "version": 1,
        "route": route,
        "agentId": route_agent_id(route),
        "templateId": default_template(route),
        "source": "imported",
        "importedFrom": seed["label"],
        "updatedAt": ts,
    })


def set_affinity(route: str, value: int):
    p = paths(route)
    current = read_json(p["relationship"], None)
    if not current:
        apply_template(route, default_template(route))
        current = read_json(p["relationship"], {})
    value = max(0, min(100, int(value)))
    current["affinity"] = value
    current["affinity_stage"] = stage(value)
    current["updated_at"] = now_iso()
    write_json(p["relationship"], current)


def show(route: str):
    p = paths(route)
    persona = read_json(p["persona"], {})
    rel = read_json(p["relationship"], {})
    meta = read_json(p["meta"], {})
    print(json.dumps({
        "route": route,
        "workspace": str(p["ws"]),
        "name": persona.get("name", ""),
        "templateId": meta.get("templateId", ""),
        "identity": persona.get("identity", ""),
        "relationship": persona.get("relationship", ""),
        "affinity": rel.get("affinity", 0),
        "affinity_stage": rel.get("affinity_stage", ""),
        "trust": rel.get("trust", 0),
        "initiative_level": rel.get("initiative_level", ""),
    }, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    show_p = sub.add_parser("show")
    show_p.add_argument("--route", required=True)

    tpl_p = sub.add_parser("template")
    tpl_p.add_argument("--route", required=True)
    tpl_p.add_argument("--template", required=True)

    reset_p = sub.add_parser("reset")
    reset_p.add_argument("--route", required=True)

    imp_p = sub.add_parser("import")
    imp_p.add_argument("--route", required=True)
    imp_p.add_argument("--file")
    imp_p.add_argument("--text")

    aff_p = sub.add_parser("set-affinity")
    aff_p.add_argument("--route", required=True)
    aff_p.add_argument("--value", type=int, required=True)

    args = parser.parse_args()
    if args.cmd == "show":
        show(args.route)
    elif args.cmd == "template":
        apply_template(args.route, "default-assistant" if args.template in ("助手型", "default-assistant", "assistant") else "default-companion")
        show(args.route)
    elif args.cmd == "reset":
        apply_template(args.route, default_template(args.route))
        show(args.route)
    elif args.cmd == "import":
        import_source(args.route, text=args.text, file_path=args.file)
        show(args.route)
    elif args.cmd == "set-affinity":
        set_affinity(args.route, args.value)
        show(args.route)
    else:
        raise SystemExit(2)

if __name__ == "__main__":
    main()
