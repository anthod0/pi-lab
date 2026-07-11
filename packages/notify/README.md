# @pi-lab/notify [![NPM Version](https://img.shields.io/npm/v/@pi-lab/notify)](https://www.npmjs.com/package/@pi-lab/notify)

Desktop notification extension for [pi coding agent](https://github.com/earendil-works/pi).

## Install

```bash
pi install npm:@pi-lab/notify
```

## Behavior

This extension sends a desktop notification for two events:

- `agent_settled` — title `Pi`, message `Ready for input`
- `permissions:ask` — title `Pi`, message `Permission required: <toolName>`

`permissions:ask` is emitted by [`@pi-lab/permissions`](https://www.npmjs.com/package/@pi-lab/permissions) immediately before a permission prompt is shown.

## Notification backend

The built-in notification backend is auto-detected:

- Windows Terminal / WSL: PowerShell toast
- Kitty: OSC 99
- Other terminals: OSC 777

Click handling is not implemented by the built-in backend. Use the script hook for terminal- or OS-specific click behavior.

## Configuration

Configuration files:

- Global: `~/.pi/agent/pi-lab/notify.json`
- Local: `<cwd>/.pi/pi-lab/notify.json`

Local config overrides global config.

### Disable built-in notifications

```json
{
  "notify": {
    "enable": false
  }
}
```

`enable` defaults to `true` and only controls built-in desktop notifications. Script hooks still run when `enable` is `false`.

### Script hook

```json
{
  "notify": {
    "script": "~/.pi/agent/pi-lab/notify.sh"
  }
}
```

When configured, the script is executed for every notify event in addition to the built-in notification. The script receives a JSON payload on stdin and has a fixed 5 second timeout. Failures are warned in Pi and do not affect agent execution or permission prompts.

Example payload for `agent_settled`:

```json
{
  "event": "agent_settled",
  "notificationId": "pi-agent-settled-1778220000000",
  "title": "Pi",
  "message": "Ready for input",
  "timestamp": 1778220000000,
  "cwd": "/home/user/project",
  "pid": 12345,
  "terminal": {
    "term": "xterm-kitty",
    "termProgram": "kitty",
    "kittyWindowId": "1"
  }
}
```

Example payload for `permissions:ask`:

```json
{
  "event": "permission_ask",
  "notificationId": "pi-permission-ask-1778220000000",
  "title": "Pi",
  "message": "Permission required: bash",
  "timestamp": 1778220000000,
  "cwd": "/home/user/project",
  "pid": 12345,
  "terminal": {
    "term": "xterm-kitty",
    "termProgram": "kitty",
    "kittyWindowId": "1"
  }
}
```

Unavailable terminal fields are omitted from the JSON sent to the script.

The script payload intentionally does not include raw tool input, permission rules, options, or tool call identifiers.

Example script:

```bash
#!/usr/bin/env bash
set -euo pipefail
payload="$(cat)"
message="$(jq -r .message <<<"$payload")"
notify-send "Pi" "$message"
```
