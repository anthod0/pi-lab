import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readSsmEnvConfig, type SsmEnvConfig } from "./config";
import {
  createSsmClient,
  fetchSsmEnv,
  type GetParametersSender,
} from "./ssm";

interface SsmClientResource extends GetParametersSender {
  destroy?: () => void;
}

export interface ManagedSsmEnvState {
  originalValues: Map<string, string | undefined>;
  managedKeys: Set<string>;
}

export interface SsmEnvExtensionOptions {
  target?: NodeJS.ProcessEnv;
  agentDir?: string;
  createClient?: (config: SsmEnvConfig) => SsmClientResource;
  state?: ManagedSsmEnvState;
  warn?: (message: string) => void;
}

const STATE_SYMBOL = Symbol.for("@pi-lab/ssm-env/managed-env");

function getDefaultState(): ManagedSsmEnvState {
  const store = globalThis as unknown as Record<PropertyKey, unknown>;
  const existing = store[STATE_SYMBOL] as ManagedSsmEnvState | undefined;
  if (existing !== undefined) return existing;

  const state: ManagedSsmEnvState = {
    originalValues: new Map(),
    managedKeys: new Set(),
  };
  store[STATE_SYMBOL] = state;
  return state;
}

function restoreManagedEnv(
  target: NodeJS.ProcessEnv,
  state: ManagedSsmEnvState,
): void {
  for (const key of state.managedKeys) {
    const originalValue = state.originalValues.get(key);
    if (originalValue === undefined) delete target[key];
    else target[key] = originalValue;
  }
  state.managedKeys.clear();
  state.originalValues.clear();
}

function applySsmEnv(
  values: Record<string, string>,
  target: NodeJS.ProcessEnv,
  state: ManagedSsmEnvState,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (target[key] !== undefined) continue;
    state.originalValues.set(key, undefined);
    state.managedKeys.add(key);
    target[key] = value;
  }
}

export function registerSsmEnvExtension(
  pi: ExtensionAPI,
  options: SsmEnvExtensionOptions = {},
): void {
  const target = options.target ?? process.env;
  const state = options.state ?? getDefaultState();
  const clientFactory = options.createClient ?? createSsmClient;

  pi.on("session_start", async (_event, ctx) => {
    restoreManagedEnv(target, state);

    let config: SsmEnvConfig | undefined;
    try {
      config = readSsmEnvConfig(ctx.cwd, options.agentDir, {
        includeProject: ctx.isProjectTrusted(),
      });
    } catch (error) {
      reportWarning(ctx, options.warn, formatError(error));
      return;
    }
    if (config === undefined) return;

    let client: SsmClientResource | undefined;
    try {
      client = clientFactory(config);
      const result = await fetchSsmEnv(client, config.parameters);
      applySsmEnv(result.values, target, state);

      if (result.missingParameters.length > 0) {
        reportWarning(
          ctx,
          options.warn,
          `SSM parameters not found: ${result.missingParameters.join(", ")}`,
        );
      }
    } catch (error) {
      reportWarning(ctx, options.warn, `Failed to load SSM environment: ${formatError(error)}`);
    } finally {
      client?.destroy?.();
    }
  });
}

function reportWarning(
  ctx: { hasUI?: boolean; ui?: { notify?: (message: string, level: "warning") => void } },
  warn: ((message: string) => void) | undefined,
  message: string,
): void {
  if (warn !== undefined) {
    warn(message);
    return;
  }
  if (ctx.hasUI && ctx.ui?.notify) {
    ctx.ui.notify(message, "warning");
    return;
  }
  console.warn(`[ssm-env] ${message}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function (pi: ExtensionAPI): void {
  registerSsmEnvExtension(pi);
}
