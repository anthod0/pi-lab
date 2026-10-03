import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { buildWritePreview, safePreviewText, selectWritePermission } from "./preview.js";
import { askUser, SessionCache } from "./ask.js";

test("new-file preview retains complete multiline content without creating the file", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "permissions-preview-"));
	const content = "first line\n" + "中文 content\n".repeat(100) + "last line";
	assert.equal(await buildWritePreview({ path: "new.txt", content }, cwd), `New file: new.txt\n\n${content}`);
	await assert.rejects(readFile(join(cwd, "new.txt")), { code: "ENOENT" });
});

test("overwrite preview shows a diff and leaves existing content untouched", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "permissions-preview-"));
	await writeFile(join(cwd, "file.txt"), "unchanged\nold\n");
	const preview = await buildWritePreview({ path: "file.txt", content: "unchanged\nnew\n" }, cwd);
	assert.match(preview, /-old\n\+new/);
	assert.equal(await readFile(join(cwd, "file.txt"), "utf8"), "unchanged\nold\n");
	assert.match(await buildWritePreview({ path: "file.txt", content: "unchanged\nold\n" }, cwd), /No content changes/);
});

test("preview resolves built-in write path forms and does not read non-regular files", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "permissions-preview-"));
	await writeFile(join(cwd, "a b.txt"), "old\n");
	for (const path of ["@a b.txt", "a\u00a0b.txt", pathToFileURL(join(cwd, "a b.txt")).href]) {
		assert.match(await buildWritePreview({ path, content: "new\n" }, cwd), /-old\n\+new/);
	}
	assert.match(await buildWritePreview({ path: cwd, content: "new" }, cwd), /Non-regular destination/);
});

test("RPC approval includes the complete write preview", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "permissions-preview-"));
	const content = "line\n".repeat(100);
	const ctx = { cwd, mode: "rpc", ui: { async select(title: string) {
		assert.ok(title.includes(content));
		return "Allow";
	} } };
	assert.equal((await askUser("write", { path: "new.txt", content }, new SessionCache(), ctx as any)).decision, "allow");
});

test("preview escapes terminal controls but preserves readable multiline text", () => {
	assert.equal(safePreviewText("a\n\t中\x1b[2J\r"), "a\n\t中\\x1b[2J\\x0d");
});

test("combined TUI approval scrolls at narrow widths and Escape denies", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "permissions-preview-"));
	const ctx = {
		cwd, mode: "tui",
		ui: {
			async custom(factory: any) {
				return new Promise((done) => {
					const component = factory({ terminal: { rows: 12 }, requestRender() {} }, { fg: (_: string, text: string) => text }, {}, done);
					const initial = component.render(12);
					assert.ok(initial.length <= 12);
					component.handleInput("\x1b[F");
					assert.ok(component.render(12).join("\n").includes("last"));
					component.invalidate();
					component.handleInput("\x1b");
				});
			},
			async select() { throw new Error("must not prompt after cancelling preview"); },
		},
	};
	const result = await askUser("write", { path: "new.txt", content: "line\n".repeat(100) + "last" }, new SessionCache(), ctx as any);
	assert.deepEqual(result, { selection: null, decision: "deny", cached: false });
});

test("one Enter chooses Allow in the combined preview and approval dialog", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "permissions-preview-"));
	const ctx = { cwd, mode: "tui", ui: { async custom(factory: any) {
		return new Promise((done) => {
			const component = factory({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_: string, text: string) => text }, {}, done);
			assert.ok(component.render(80).join("\n").includes("Allow"));
			component.handleInput("\r");
		});
	}, async select() { throw new Error("must not open a second selection dialog"); } } };
	assert.deepEqual(await askUser("write", { path: "new.txt", content: "content" }, new SessionCache(), ctx as any),
		{ selection: "Allow", decision: "allow", cached: false });
});

test("combined dialog selection preserves all options including denial feedback", async () => {
	const selections = ["Allow", "Allow always", "Deny", "Deny always", "Deny with feedback"];
	for (let index = 0; index < selections.length; index++) {
		const ctx = { ui: { async custom(factory: any) {
			return new Promise((done) => {
				const component = factory({ requestRender() {} }, { fg: (_: string, text: string) => text }, {}, done);
				for (let step = 0; step < index; step++) component.handleInput("\x1b[B");
				component.handleInput("\r");
			});
		} } };
		assert.equal(await selectWritePermission("content", ctx as any), selections[index]);
	}
});
