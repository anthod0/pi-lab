# @pi-lab/input-history [![NPM Version](https://img.shields.io/npm/v/@pi-lab/input-history)](https://www.npmjs.com/package/@pi-lab/input-history)

Extends the up arrow key history from session-level to project-level.

## Install

```bash
pi install npm:@pi-lab/input-history
```

## What it does

By default, pressing `↑` in pi's input box only recalls messages from the current session. This plugin persists last submitted inputs to disk and shares them across every session in the same project.

**Before:** `↑` cycles through messages from the current session only.
**After:** `↑` cycles through the last 100 submitted messages in the project, across all sessions.

The behavior is otherwise identical — text is placed directly into the editor, one entry at a time.
