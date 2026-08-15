import { join } from "node:path";
import {
  getAgentDir,
  ModelRuntime,
  type ModelRegistry,
} from "@earendil-works/pi-coding-agent";

/**
 * Create an SDK model runtime that preserves providers registered by the parent
 * extension stack while loading credentials and model overrides from disk.
 */
export async function createChildModelRuntime(parent: ModelRegistry): Promise<ModelRuntime> {
  const agentDir = getAgentDir();
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  });

  for (const providerId of parent.getRegisteredProviderIds()) {
    const nativeProvider = parent.getRegisteredNativeProvider(providerId);
    if (nativeProvider) {
      runtime.registerNativeProvider(nativeProvider);
      continue;
    }

    const config = parent.getRegisteredProviderConfig(providerId);
    if (config) runtime.registerProvider(providerId, config);
  }

  return runtime;
}
