# @pi-lab/subagent

A minimal synchronous subagent extension for [pi](https://pi.dev).

## Install

```bash
pi install npm:@pi-lab/subagent
```

## Features

- **Schema only** — no system-prompt injection
- **No role files** — no `*.md` specialists; the task string is the brief. The child uses the same model, tools, and project conventions as the main agent
- **Simple lifecycle** — one task per call; parallel execution uses Pi's native tool concurrency
- **Trigger policy is yours** — this tool does not tell the model when to delegate. It follows whatever you define

## Use when

**Isolate context. Add no orchestrator.**  
You need a tool that just isolates context, not an orchestrator.

**Wrap headless `pi`.**  
You only want a thin wrapper around headless `pi`.

**One config for parent and child.**  
The child behaves like the parent. No extra implicit instructions.

## Not for

Reusable roles, async/steer/fleet, or a workflow DSL.
If you need these features, use a larger extension.
