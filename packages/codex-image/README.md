# @pi-lab/codex-image

Generate and edit images in [Pi](https://pi.dev) through Codex CLI, using your existing Codex login. Saves a PNG file and returns its path—no separate image API key required.

## Install

```bash
pi install npm:@pi-lab/codex-image
```

Requires `codex` on your PATH and an account with image-generation access, signed in via `codex login`.

## Usage

Ask Pi to generate an image:

> Generate a square illustration of an orange robot painting a blue circle on white. Save it to assets/robot.png.

Or edit an existing image:

> Edit assets/robot.png: change the blue circle to green, keeping everything else unchanged. Save it to assets/robot-green.png.

### Tool: `generate_image`

| Parameter | Required | Description |
| --- | --- | --- |
| `prompt` | Yes | Image instructions: subject, style, composition, or what to change and preserve. |
| `images` | No | Local reference or edit-target image paths. Describe each image's role in the prompt. |
| `output` | No | New `.png` path, absolute or relative to the current directory. Existing files are never overwritten. |

Without `output`, saves to `.pi/pi-lab/codex-image/run-*/image.png`. To refine a previous result, pass its saved path in `images`.

## Configuration

The default Codex model is `gpt-5.6-sol`. Override it in `~/.pi/agent/settings.json` or a trusted project's `.pi/settings.json`:

```json
{
  "codexImage": {
    "model": "gpt-5.6-sol"
  }
}
```

Choose a model with image-generation support—`gpt-5.3-codex-spark` does not expose the required tool.

## Notes

- Each call generates one PNG, with a five-minute timeout and cancellation support.
- Prompts and reference images are sent to Codex/OpenAI and consume your account's usage, even if you cancel after generation starts.
- Errors include a diagnostic directory. Logs may contain prompts and local paths; review them before sharing.
