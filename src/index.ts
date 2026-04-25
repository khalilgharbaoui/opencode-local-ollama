import { discoverModels, normalizeOptions, providerConfig } from "./ollama.js"
import type { OpenCodePlugin } from "./types.js"

export { defaults, discoverModels, normalizeOptions, parseParameterNumber, providerConfig, toOpenCodeModel } from "./ollama.js"
export type { NormalizedOptions, OllamaShowResponse, PluginOptions } from "./ollama.js"

const server: OpenCodePlugin = async (_input, options) => {
  const normalized = normalizeOptions(options)

  return {
    config: async (config) => {
      config.provider ??= {}
      const existing = config.provider[normalized.providerID]
      config.provider[normalized.providerID] = {
        ...existing,
        ...providerConfig(normalized, existing),
      }
    },
    provider: {
      id: normalized.providerID,
      models: async () => discoverModels(options),
    },
  }
}

export default {
  id: "opencode-local-ollama",
  server,
}
