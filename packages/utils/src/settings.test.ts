import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mergePiSettings, readMergedPiSettings, readPiProjectSettings, readPiUserSettings } from "./settings.js";

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

test("settings readers can read from explicit project and home directories", () => {
	const projectDir = mkdtempSync(join(tmpdir(), "pi-lab-explicit-project-settings-"));
	const homeDir = mkdtempSync(join(tmpdir(), "pi-lab-explicit-user-settings-"));
	try {
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
		mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({ permissions: { rules: [{ match: { tool: "read" }, action: "deny" }] } }),
		);
		writeFileSync(
			join(homeDir, ".pi", "agent", "settings.json"),
			JSON.stringify({ permissions: { rules: [{ match: { tool: "bash" }, action: "ask" }] } }),
		);

		assert.deepEqual(readPiProjectSettings(projectDir), {
			permissions: { rules: [{ match: { tool: "read" }, action: "deny" }] },
		});
		assert.deepEqual(readPiUserSettings(homeDir), {
			permissions: { rules: [{ match: { tool: "bash" }, action: "ask" }] },
		});
	} finally {
		rmSync(projectDir, { recursive: true, force: true });
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

test("mergePiSettings deep merges project settings over user settings", () => {
	const merged = mergePiSettings(
		{
			theme: "dark",
			xsearch: {
				model: "user-model",
				enableImageUnderstanding: true,
				allowedModels: ["a", "b"],
			},
		},
		{
			xsearch: {
				model: "project-model",
				allowedModels: ["c"],
			},
		},
	);

	assert.deepEqual(merged, {
		theme: "dark",
		xsearch: {
			model: "project-model",
			enableImageUnderstanding: true,
			allowedModels: ["c"],
		},
	});
});

test("readMergedPiSettings reads user and project settings and applies project overrides", () => {
	const projectDir = mkdtempSync(join(tmpdir(), "pi-lab-merged-project-settings-"));
	const homeDir = mkdtempSync(join(tmpdir(), "pi-lab-merged-user-settings-"));
	try {
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
		mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
		writeFileSync(
			join(homeDir, ".pi", "agent", "settings.json"),
			JSON.stringify({ xsearch: { model: "user-model", enableVideoUnderstanding: true } }),
		);
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({ xsearch: { model: "project-model" } }),
		);

		assert.deepEqual(readMergedPiSettings({ cwd: projectDir, home: homeDir }), {
			xsearch: {
				model: "project-model",
				enableVideoUnderstanding: true,
			},
		});
	} finally {
		rmSync(projectDir, { recursive: true, force: true });
		rmSync(homeDir, { recursive: true, force: true });
	}
});
