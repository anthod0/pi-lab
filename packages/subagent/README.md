# @pi-lab/subagent

A minimal synchronous, parallel subagent tool for [pi](https://pi.dev).

Each task runs in a headless `pi` child process. Calls block the parent agent until every child finishes, while tasks within one call run in parallel. In the TUI, each task is shown with a compact, single-line prompt summary.

## Install

```bash
pi install npm:@pi-lab/subagent
```

## Tool

```json
{
  "tasks": [
    "Inspect the authentication implementation and report risks.",
    "Inspect the authentication tests and identify missing coverage."
  ]
}
```

A single task uses the same interface with one array element.

Subagents inherit the current working directory, model, thinking level, active tools, extensions, context files, and system prompt configuration. The `subagent` tool itself is excluded in child processes to prevent recursion.

The extension adds no prompt snippets, guidelines, agent roles, or prompt templates. Only the tool schema is exposed to the model.
