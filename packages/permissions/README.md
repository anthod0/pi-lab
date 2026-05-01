# @pi-lab/permissions

A permission system extension for [pi coding agent](https://github.com/badlogic/pi-mono). Intercepts tool calls and enforces allow / deny / ask rules defined in a JSON config file.

## Install

```bash
pi install npm:@pi-lab/permissions
```

## Configuration

Rules are configured in pi settings and merged into a single list:

- `~/.pi/agent/settings.json` — global
- `.pi/settings.json` — project

Example `settings.json`:

```json
{
  "permissions": {
    "rules": [
      {
        "message": "Block rm -rf",
        "priority": 10,
        "match": { "tool": "bash", "params": { "command": "rm\\s+-rf" } },
        "action": "deny"
      },
      {
        "match": { "tool": "bash", "params": { "command": "sudo" } },
        "action": "ask"
      },
      {
        "message": "Only allow reading files inside the project",
        "priority": 10,
        "match": { "tool": "read", "paths": ["~/projects/my-app/**"] },
        "action": "allow"
      },
      {
        "message": "read is restricted to allowed paths only",
        "match": { "tool": "read" },
        "action": "deny"
      }
    ]
  }
}
```

### Rule fields

| Field             | Type     | Required | Description                                                                                                                                                                                             |
| ----------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `match.tool`      | string   | ✓        | Tool name, or `"*"` to match all tools                                                                                                                                                                  |
| `match.params`    | object   | —        | Param name → regex pattern. All conditions must match.                                                                                                                                                  |
| `match.paths`     | string[] | —        | Path patterns the tool's path argument must fall within. Supports glob (`**`, `*`) and plain directory prefixes. Supports `~` expansion. Pairs with a higher-priority `allow` rule to form a whitelist. |
| `match.pathParam` | string   | —        | Which input key holds the path. Defaults to `"path"`.                                                                                                                                                   |
| `action`          | string   | ✓        | `allow`, `deny`, or `ask`                                                                                                                                                                               |
| `priority`        | number   | —        | Defaults to `0`. Higher values are evaluated first.                                                                                                                                                     |
| `message`         | string   | —        | Reason returned to the LLM when a call is blocked.                                                                                                                                                      |

### Matching order

1. Rules sorted by `priority` descending
2. Same priority: `deny` > `ask` > `allow`

No match defaults to `allow`.

### ask mode

A dialog prompts the user with four options:

- **Allow** — allow this call once
- **Allow always** — allow identical calls for the rest of the session (not persisted)
- **Deny** — deny this call once
- **Deny always** — deny identical calls for the rest of the session (not persisted)
