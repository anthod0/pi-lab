import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readPiProjectSettings, readPiUserSettings } from "./settings.js";

function withCwd<T>(cwd: string, fn: () => T): T {
	const previousCwd = process.cwd();
	process.chdir(cwd);
	try {
		return fn();
	} finally {
		process.chdir(previousCwd);
	}
}

function withHome<T>(home: string, fn: () => T): T {
	const previousHome = process.env.HOME;
	process.env.HOME = home;
	try {
		return fn();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
	}
}

test("readPiProjectSettings parses .pi/settings.json from the current project", () => {
	const projectDir = mkdtempSync(join(tmpdir(), "pi-lab-project-settings-"));
	try {
		mkdirSync(join(projectDir, ".pi"));
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({ defaultModel: "sonnet", compaction: { enabled: false } }),
		);

		const settings = withCwd(projectDir, () => readPiProjectSettings());

		assert.deepEqual(settings, {
			defaultModel: "sonnet",
			compaction: { enabled: false },
		});
	} finally {
		rmSync(projectDir, { recursive: true, force: true });
	}
});

test("readPiUserSettings parses ~/.pi/agent/settings.json", () => {
	const homeDir = mkdtempSync(join(tmpdir(), "pi-lab-user-settings-"));
	try {
		mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
		writeFileSync(
			join(homeDir, ".pi", "agent", "settings.json"),
			JSON.stringify({ theme: "dark", enabledModels: ["claude-*"] }),
		);

		const settings = withHome(homeDir, () => readPiUserSettings());

		assert.deepEqual(settings, {
			theme: "dark",
			enabledModels: ["claude-*"],
		});
	} finally {
		rmSync(homeDir, { recursive: true, force: true });
	}
});

test("settings readers return empty objects when settings.json is missing", () => {
	const projectDir = mkdtempSync(join(tmpdir(), "pi-lab-missing-project-settings-"));
	const homeDir = mkdtempSync(join(tmpdir(), "pi-lab-missing-user-settings-"));
	try {
		assert.deepEqual(withCwd(projectDir, () => readPiProjectSettings()), {});
		assert.deepEqual(withHome(homeDir, () => readPiUserSettings()), {});
	} finally {
		rmSync(projectDir, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
	}
});

test("settings readers throw invalid JSON errors", () => {
	const projectDir = mkdtempSync(join(tmpdir(), "pi-lab-invalid-project-settings-"));
	try {
		mkdirSync(join(projectDir, ".pi"));
		writeFileSync(join(projectDir, ".pi", "settings.json"), "{");

		assert.throws(() => withCwd(projectDir, () => readPiProjectSettings()), SyntaxError);
	} finally {
		rmSync(projectDir, { recursive: true, force: true });
	}
});
