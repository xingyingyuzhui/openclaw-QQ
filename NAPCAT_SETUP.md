# NapCat Setup Guide (Docker / Non-Docker)

This guide is for integrating NapCat with this repository.

## 1. Recommended Versions
- NapCatQQ tested baseline: `v4.17.25`
- OpenClaw tested baseline: `2026.2.26+`

If you run newer NapCat, keep OneBot config semantics unchanged (especially `messagePostFormat`).

## 2. OneBot v11 Required Config
Reference source: NapCatQQ repo (`packages/napcat-develop/config/onebot11.json` and `packages/napcat-onebot/config/config.ts`).

Required server block:
```json
{
  "network": {
    "websocketServers": [
      {
        "enable": true,
        "name": "WebSocket",
        "host": "127.0.0.1",
        "port": 3001,
        "messagePostFormat": "array",
        "token": "YOUR_ONEBOT_TOKEN",
        "reportSelfMessage": false,
        "enableForcePushEvent": true,
        "debug": false,
        "heartInterval": 30000
      }
    ]
  }
}
```

Notes:
- `messagePostFormat` must be `array`.
- Keep `reportSelfMessage=false` to avoid self-loop noise.
- `token` should match OpenClaw `channels.qq.accessToken`.

## 3. Docker Deployment (NapCat-Docker)
Reference source: `NapNeko/NapCat-Docker` README and compose templates.

Example (`compose/ws.yml` equivalent):
```yaml
services:
  napcat:
    image: mlikiowa/napcat-docker:latest
    container_name: napcat
    restart: always
    network_mode: bridge
    environment:
      - NAPCAT_UID=${NAPCAT_UID}
      - NAPCAT_GID=${NAPCAT_GID}
    ports:
      - "3001:3001"   # OneBot WS
      - "6099:6099"   # NapCat WebUI
    volumes:
      - ./napcat/config:/app/napcat/config
      - ./ntqq:/app/.config/QQ
```

Run:
```bash
NAPCAT_UID=$(id -u) NAPCAT_GID=$(id -g) docker compose -f compose/ws.yml up -d
```

Important:
- Persist `/app/napcat/config` and `/app/.config/QQ`.
- Expose only required ports.
- If OpenClaw runs on host, set `channels.qq.wsUrl` to `ws://127.0.0.1:3001/`.
- If OpenClaw runs in another container, use container-network reachable address.

## 4. Non-Docker Deployment (NapCatQQ Release Package)
1. Download NapCatQQ from official releases.
2. Complete QR login in NapCat WebUI.
3. Configure OneBot v11 WebSocket server with `messagePostFormat=array`.
4. Confirm WS endpoint is reachable from OpenClaw host.

## 5. OpenClaw Side Mapping
In `${OPENCLAW_HOME}/openclaw.json`:
```json
{
  "channels": {
    "qq": {
      "wsUrl": "ws://127.0.0.1:3001/",
      "accessToken": "YOUR_ONEBOT_TOKEN"
    }
  }
}
```

## 6. Validation Checklist
- NapCat WebUI reachable and account logged in.
- OneBot WS server is enabled.
- OpenClaw gateway log includes:
  - `Connected to OneBot server`
  - `Logged in as:`
- Send one QQ private message and confirm inbound + outbound.

## 7. Common Pitfalls
- `messagePostFormat != array` causes unstable media parsing.
- Token mismatch leads to WS connect/auth failures.
- Wrong network route between containers causes timeout/refused connections.
- Exposing WebUI publicly without protection is unsafe.
