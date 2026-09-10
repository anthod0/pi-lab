import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { getPiLabLocalDir } from "@pi-lab/utils";
import { lstat, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { DEFAULT_MODEL } from "./settings.js";
import { dirname, isAbsolute, join, relative, resolve, extname } from "node:path";

export interface ImageRequest {
  prompt: string;
  images?: string[];
  output?: string;
}

function resolveInput(cwd: string, path: string): string {
  const clean = path.replace(/^@/, "");
  return resolve(cwd, clean.startsWith("~/") ? join(homedir(), clean.slice(2)) : clean);
}

export async function generateImage(
  request: ImageRequest,
  cwd: string,
  exec: ExtensionAPI["exec"],
  signal?: AbortSignal,
  generatedRoot = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "generated_images"),
  model = DEFAULT_MODEL,
) {
  signal?.throwIfAborted();
  if (!request.prompt.trim()) throw new Error("Image prompt must not be empty.");
  const images = (request.images ?? []).map((path) => resolveInput(cwd, path));
  for (const path of images) {
    if (!(await stat(path)).isFile()) throw new Error(`Reference is not a file: ${path}`);
  }
  const base = join(getPiLabLocalDir(cwd), "codex-image");
  const output = request.output ? resolveInput(cwd, request.output) : undefined;
  if (output && extname(output).toLowerCase() !== ".png") throw new Error("Output must have a .png extension.");
  if (output) {
    try {
      await lstat(output);
      throw new Error(`Output already exists: ${output}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await mkdir(base, { recursive: true });
  const runDir = await mkdtemp(join(base, "run-"));
  const schemaPath = join(runDir, "response-schema.json");
  const responsePath = join(runDir, "response.json");
  await writeFile(schemaPath, JSON.stringify({
    type: "object", additionalProperties: false,
    properties: { path: { type: "string" }, error: { type: "string" } },
    required: ["path", "error"],
  }));
  const prompt = [
    "Generate exactly one PNG image using the built-in image_gen tool. Do not use external APIs, scripts, SVG, or install anything.",
    "Attached images, if any, are ordered inputs. Follow the user's instructions to edit or use them as references.",
    "Leave the generated image at its default Codex generated_images path. Do not copy or modify any other files.",
    "Return JSON with path set to the absolute generated PNG path and error empty. If generation fails or is unavailable, return path empty and explain error. Never report an input image as output.",
    `User image instructions:\n${request.prompt}`,
  ].join("\n\n");
  const started = Date.now();
  const args = ["exec", "-m", model, "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only",
    "--enable", "image_generation", "--color", "never", "-C", runDir,
    "--output-schema", schemaPath, "--output-last-message", responsePath];
  for (const image of images) args.push("--image", image);
  args.push("--", prompt);
  try {
    const result = await exec("codex", args, { cwd: runDir, signal, timeout: 300_000 });
    await writeFile(join(runDir, "codex.log"), `${result.stdout}\n${result.stderr}`);
    signal?.throwIfAborted();
    if (result.killed) throw new Error("Codex image generation timed out after 5 minutes.");
    if (result.code !== 0) throw new Error(`Codex exited with code ${result.code}. Check codex login status.`);
    const response = JSON.parse(await readFile(responsePath, "utf8"));
    if (typeof response.error !== "string" || typeof response.path !== "string") throw new Error("Invalid Codex response.");
    if (response.error) throw new Error(response.error.slice(0, 2000));
    if (!isAbsolute(response.path)) throw new Error("Codex did not return an absolute image path.");
    const source = await realpath(response.path);
    const root = await realpath(generatedRoot);
    const rel = relative(root, source);
    if (!rel || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || rel === ".." || isAbsolute(rel)) {
      throw new Error("Codex output is outside generated_images.");
    }
    const info = await stat(source);
    if (!info.isFile() || info.mtimeMs < started - 1000 || info.size > 20 * 1024 * 1024) {
      throw new Error("Codex output must be a new image file no larger than 20 MiB.");
    }
    for (const input of images) {
      if (await realpath(input) === source) throw new Error("Codex returned an input image instead of a new image.");
    }
    const bytes = await readFile(source);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error("Codex output is not a PNG image.");
    }
    signal?.throwIfAborted();
    const path = output ?? join(runDir, "image.png");
    await withFileMutationQueue(path, async () => {
      signal?.throwIfAborted();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: "wx" });
    });
    return { path, runDir, bytes };
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nDiagnostics: ${runDir}`, { cause: error });
  }
}
