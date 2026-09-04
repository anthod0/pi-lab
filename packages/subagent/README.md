# @pi-lab/subagent

A minimal synchronous subagent tool for [pi](https://pi.dev).

Each call runs one task in a headless `pi` child process and blocks until that child finishes. To run independent tasks concurrently, call the tool multiple times in the same response; pi executes sibling tool calls in parallel by default. In the TUI, the task prompt is shown when the tool call is expanded.

## Install

```bash
pi install npm:@pi-lab/subagent
```

## Tool

```json
{
  "task": "Inspect the authentication implementation and report risks."
}
```

For parallel work, emit multiple `subagent` calls in the same response, with one task per call.

Subagents inherit the current working directory, model, thinking level, active tools, extensions, context files, and system prompt configuration. The `subagent` tool itself is excluded in child processes to prevent recursion.

The extension adds no prompt snippets, guidelines, agent roles, or prompt templates. Only the tool schema is exposed to the model.
