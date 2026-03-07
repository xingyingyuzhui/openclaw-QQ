#!/usr/bin/env python3
import argparse
import json
from copy import deepcopy
import os
from pathlib import Path
from typing import Any, Dict, List

OPENCLAW_HOME = Path(os.environ.get("OPENCLAW_HOME", str(Path.home() / ".openclaw")))
WORKSPACE_ROOT = OPENCLAW_HOME / "workspace"
CONFIG_PATH = OPENCLAW_HOME / "openclaw.json"
PLUGIN_ID = "qq-automation-manager"


def load_config() -> Dict[str, Any]:
    raw = CONFIG_PATH.read_text(encoding="utf-8")
    return json.loads(raw)


def save_config(cfg: Dict[str, Any]) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ensure_manager_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    plugins = cfg.setdefault("plugins", {})
    entries = plugins.setdefault("entries", {})
    manager_entry = entries.setdefault(PLUGIN_ID, {"enabled": True, "config": {}})
    if "enabled" not in manager_entry:
        manager_entry["enabled"] = True
    manager_cfg = manager_entry.setdefault("config", {})
    manager_cfg.setdefault("enabled", True)
    manager_cfg.setdefault("configVersion", 1)
    manager_cfg.setdefault("reconcileOnStartup", True)
    manager_cfg.setdefault("reconcileIntervalMs", 120000)
    manager_cfg.setdefault("pruneOrphans", False)
    manager_cfg.setdefault("targets", [])
    if not isinstance(manager_cfg["targets"], list):
        manager_cfg["targets"] = []
    return manager_cfg


def route_to_default_id(route: str) -> str:
    return route.replace(":", "-")


def validate_route(route: str) -> None:
    if not route.startswith(("user:", "group:", "guild:")):
        raise SystemExit(f"invalid route: {route}")


def build_target(args: argparse.Namespace) -> Dict[str, Any]:
    validate_route(args.route)
    target_id = args.id or route_to_default_id(args.route)
    return {
        "id": target_id,
        "enabled": args.enabled,
        "route": args.route,
        "executionMode": "agent-only",
        "job": {
            "type": "cron-agent-turn",
            "schedule": {
                "kind": "cron",
                "expr": args.cron,
                "tz": args.tz,
            },
            "message": args.message,
            "thinking": args.thinking,
            "timeoutSeconds": args.timeout_seconds,
            "smart": {
                "enabled": True,
                "minSilenceMinutes": args.min_silence,
                "activeConversationMinutes": args.active_window,
                "randomIntervalMinMinutes": args.random_min,
                "randomIntervalMaxMinutes": args.random_max,
                "maxChars": args.max_chars,
            },
        },
    }


def list_targets(targets: List[Dict[str, Any]]) -> None:
    rows = []
    for t in targets:
        schedule = (t.get("job", {}).get("schedule", {}) or {}).get("expr", "")
        enabled = bool(t.get("enabled", False))
        route = t.get("route", "")
        rows.append(
            {
                "id": t.get("id", ""),
                "enabled": enabled,
                "route": route,
                "cron": schedule,
            }
        )
    print(json.dumps({"targets": rows}, ensure_ascii=False, indent=2))


def upsert_target(targets: List[Dict[str, Any]], item: Dict[str, Any]) -> str:
    item_id = item["id"]
    for i, t in enumerate(targets):
        if str(t.get("id", "")) == item_id:
            targets[i] = item
            return "updated"
    targets.append(item)
    return "created"


def disable_target(targets: List[Dict[str, Any]], target_id: str) -> bool:
    for t in targets:
        if str(t.get("id", "")) == target_id:
            t["enabled"] = False
            return True
    return False


def remove_target(targets: List[Dict[str, Any]], target_id: str) -> bool:
    for i, t in enumerate(targets):
        if str(t.get("id", "")) == target_id:
            del targets[i]
            return True
    return False


def migrate_agent_only(targets: List[Dict[str, Any]]) -> int:
    changed = 0
    for t in targets:
        if t.get("executionMode") != "agent-only":
            t["executionMode"] = "agent-only"
            changed += 1
        if "delivery" in t:
            t.pop("delivery", None)
            changed += 1
    return changed


def audit_targets(targets: List[Dict[str, Any]]) -> Dict[str, Any]:
    issues = []
    for t in targets:
        tid = str(t.get("id", ""))
        if t.get("executionMode") != "agent-only":
            issues.append({"id": tid, "issue": "executionMode_not_agent_only"})
        if "delivery" in t:
            issues.append({"id": tid, "issue": "delivery_present"})
    return {"ok": len(issues) == 0, "issues": issues}


def route_meta_dir(route: str) -> Path:
    direct = WORKSPACE_ROOT / "qq_sessions" / route / "meta"
    normalized = WORKSPACE_ROOT / "qq_sessions" / route.replace(":", "__") / "meta"
    return direct if direct.exists() else normalized


def verify_target(targets: List[Dict[str, Any]], target_id: str = "", route: str = "") -> Dict[str, Any]:
    selected = None
    if target_id:
        selected = next((t for t in targets if str(t.get("id", "")) == target_id), None)
    elif route:
        selected = next((t for t in targets if str(t.get("route", "")) == route), None)
    elif targets:
        selected = targets[0]

    if not selected:
        return {"ok": False, "error": "target_not_found", "target_id": target_id, "route": route}

    s = selected.get("job", {}).get("schedule", {}) or {}
    meta = route_meta_dir(str(selected.get("route", "")))
    latest = meta / "automation-latest.json"
    ndjson = meta / "automation-state.ndjson"

    latest_ok = False
    latest_fields_ok = False
    latest_preview: Dict[str, Any] = {}
    if latest.exists():
        try:
            payload = json.loads(latest.read_text(encoding="utf-8"))
            required = {"triggered", "produced", "skipped", "sent_by_channel", "trace"}
            latest_ok = True
            latest_fields_ok = required.issubset(set(payload.keys()))
            latest_preview = {k: payload.get(k) for k in ["ts", "target_id", "triggered", "produced", "skipped", "sent_by_channel", "trace"]}
        except Exception:
            latest_ok = False

    return {
        "ok": True,
        "target": {
            "id": selected.get("id"),
            "enabled": selected.get("enabled"),
            "route": selected.get("route"),
            "executionMode": selected.get("executionMode"),
            "schedule_kind": s.get("kind"),
            "schedule": s,
        },
        "checks": {
            "agent_only": selected.get("executionMode") == "agent-only",
            "no_delivery": "delivery" not in selected,
            "meta_dir": str(meta),
            "automation_latest_exists": latest_ok,
            "automation_latest_required_fields": latest_fields_ok,
            "automation_state_ndjson_exists": ndjson.exists(),
        },
        "latest_preview": latest_preview,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage qq-automation-manager targets in openclaw.json")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list")

    upsert = sub.add_parser("upsert")
    upsert.add_argument("--id", default="")
    upsert.add_argument("--route", required=True)
    upsert.add_argument("--cron", required=True, help='e.g. "*/30 9-22 * * 1-5"')
    upsert.add_argument("--tz", default="Asia/Shanghai")
    upsert.add_argument("--message", required=True)
    upsert.add_argument("--thinking", default="low")
    upsert.add_argument("--timeout-seconds", type=int, default=600)
    upsert.add_argument("--enabled", action=argparse.BooleanOptionalAction, default=True)
    upsert.add_argument("--min-silence", type=int, default=30)
    upsert.add_argument("--active-window", type=int, default=25)
    upsert.add_argument("--random-min", type=int, default=30)
    upsert.add_argument("--random-max", type=int, default=60)
    upsert.add_argument("--max-chars", type=int, default=36)

    disable = sub.add_parser("disable")
    disable.add_argument("--id", required=True)

    remove = sub.add_parser("remove")
    remove.add_argument("--id", required=True)

    sub.add_parser("migrate-agent-only")
    sub.add_parser("audit")
    verify = sub.add_parser("verify")
    verify.add_argument("--id", default="")
    verify.add_argument("--route", default="")

    args = parser.parse_args()
    cfg = load_config()
    original = deepcopy(cfg)
    manager_cfg = ensure_manager_config(cfg)
    targets = manager_cfg["targets"]

    if args.cmd == "list":
        list_targets(targets)
        return

    if args.cmd == "audit":
        print(json.dumps(audit_targets(targets), ensure_ascii=False, indent=2))
        return

    if args.cmd == "migrate-agent-only":
        changed = migrate_agent_only(targets)
        save_config(cfg)
        print(json.dumps({"ok": True, "action": "migrated", "changed": changed}, ensure_ascii=False))
        return

    if args.cmd == "verify":
        print(json.dumps(verify_target(targets, target_id=args.id, route=args.route), ensure_ascii=False, indent=2))
        return

    if args.cmd == "upsert":
        if args.random_max < args.random_min:
            raise SystemExit("--random-max must be >= --random-min")
        target = build_target(args)
        action = upsert_target(targets, target)
        save_config(cfg)
        print(json.dumps({"ok": True, "action": action, "id": target["id"], "route": target["route"]}, ensure_ascii=False))
        return

    if args.cmd == "disable":
        ok = disable_target(targets, args.id)
        if not ok:
            raise SystemExit(f"target not found: {args.id}")
        save_config(cfg)
        print(json.dumps({"ok": True, "action": "disabled", "id": args.id}, ensure_ascii=False))
        return

    if args.cmd == "remove":
        ok = remove_target(targets, args.id)
        if not ok:
            raise SystemExit(f"target not found: {args.id}")
        save_config(cfg)
        print(json.dumps({"ok": True, "action": "removed", "id": args.id}, ensure_ascii=False))
        return

    if cfg != original:
        save_config(cfg)


if __name__ == "__main__":
    main()
