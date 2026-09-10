import { mergePiSettings, readPiProjectSettings, readPiUserSettings } from "@pi-lab/utils";

export const DEFAULT_MODEL = "gpt-5.6-sol";

export function readImageModel(cwd: string, projectTrusted: boolean, home?: string): string {
  const settings = mergePiSettings(
    readPiUserSettings(home),
    projectTrusted ? readPiProjectSettings(cwd) : {},
  );
  const config = settings.codexImage;
  if (config === undefined) return DEFAULT_MODEL;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("codexImage must be an object in Pi settings.");
  }
  const model = (config as Record<string, unknown>).model;
  if (model === undefined) return DEFAULT_MODEL;
  if (typeof model !== "string" || !model.trim()) {
    throw new Error("codexImage.model must be a non-empty string in Pi settings.");
  }
  return model.trim();
}
