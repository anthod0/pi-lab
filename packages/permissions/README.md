# @pi-lab/permissions

A permission system extension for [pi coding agent](https://github.com/earendil-works/pi). Intercepts tool calls and enforces allow / deny / ask rules defined in a JSON config file.

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

## Events

The extension broadcasts observational events on `pi.events`. Listeners cannot change permission decisions, cache behavior, or blocked responses.

### Event names

- `permissions:deny` — emitted whenever a tool call is blocked
- `permissions:ask` — emitted immediately before a real user prompt is shown
- `permissions:user_select` — emitted after the prompt resolves

### Payloads

All payloads include the matched rule serialized with configured patterns only. Raw tool input is never broadcast.

```ts
type SerializedPermissionRule = {
  action: "allow" | "deny" | "ask";
  message?: string;
  priority?: number;
  match: {
    tool: string;
    params?: Record<string, string>;
    paths?: string[];
    pathParam?: string;
  };
};

type PermissionsDenyEvent = {
  toolCallId: string;
  toolName: string;
  reason: string;
  source: "rule" | "cache" | "user" | "no_ui";
  rule: SerializedPermissionRule;
};

type PermissionsAskEvent = {
  toolCallId: string;
  toolName: string;
  rule: SerializedPermissionRule;
  options: ["Allow", "Allow always", "Deny", "Deny always"];
};

type PermissionsUserSelectEvent = {
  toolCallId: string;
  toolName: string;
  selection: "Allow" | "Allow always" | "Deny" | "Deny always" | null;
  decision: "allow" | "deny";
  cached: boolean;
  rule: SerializedPermissionRule;
};
```

### Privacy guarantee

Event payloads never include `event.input` or derived raw argument values such as shell commands, file paths, or file contents. The `params` and `paths` fields contain only the configured rule patterns.

### Example listener

```ts
pi.events.on("permissions:deny", (event) => {
  console.log(event);
});
```
