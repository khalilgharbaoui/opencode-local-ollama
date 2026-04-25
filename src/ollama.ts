import type { OpenCodeModel, ProviderID } from "./types.js"

const DEFAULT_HOST = "http://localhost:11434"
const DEFAULT_PROVIDER_ID = "ollama"
const DEFAULT_CONTEXT_LIMIT = 4096
const DEFAULT_OUTPUT_LIMIT = 4096
const DEFAULT_TIMEOUT_MS = 5_000
const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible"

export type PluginOptions = {
  host?: string
  baseURL?: string
  providerID?: string
  timeout?: number
  context?: number
  output?: number
  useModelInfoContext?: boolean
}

export type NormalizedOptions = {
  apiBaseURL: string
  openAIBaseURL: string
  providerID: string
  timeout: number
  context?: number
  output?: number
  useModelInfoContext: boolean
}

type Fetch = typeof fetch

type OllamaTagModel = {
  name?: unknown
  model?: unknown
  modified_at?: unknown
  details?: {
    family?: unknown
    families?: unknown
  }
}

type OllamaTagsResponse = {
  models?: unknown
}

export type OllamaShowResponse = {
  modelfile?: unknown
  parameters?: unknown
  template?: unknown
  details?: {
    family?: unknown
    families?: unknown
  }
  model_info?: Record<string, unknown>
  capabilities?: unknown
  modified_at?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionString(options: Record<string, unknown> | undefined, key: keyof PluginOptions) {
  const value = options?.[key]
  if (typeof value !== "string") return
  const trimmed = value.trim()
  if (!trimmed) return
  return trimmed
}

function optionPositiveInteger(options: Record<string, unknown> | undefined, key: keyof PluginOptions) {
  const value = options?.[key]
  if (typeof value !== "number") return
  if (!Number.isSafeInteger(value) || value <= 0) return
  return value
}

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, "")
}

function parseHost(value: string) {
  const raw = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value) ? value : `http://${value}`
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported Ollama URL protocol: ${url.protocol}`)
  }
  if (url.username || url.password) {
    throw new Error("Ollama URL credentials are not supported")
  }
  url.hash = ""
  url.search = ""
  return withoutTrailingSlash(url.toString())
}

export function normalizeOptions(raw?: Record<string, unknown>): NormalizedOptions {
  const base = parseHost(
    optionString(raw, "host") ?? optionString(raw, "baseURL") ?? process.env.OLLAMA_HOST ?? DEFAULT_HOST,
  )
  const apiBaseURL = base.endsWith("/v1") ? base.slice(0, -3) : base
  return {
    apiBaseURL,
    openAIBaseURL: base.endsWith("/v1") ? base : `${base}/v1`,
    providerID: optionString(raw, "providerID") ?? DEFAULT_PROVIDER_ID,
    timeout: optionPositiveInteger(raw, "timeout") ?? DEFAULT_TIMEOUT_MS,
    context: optionPositiveInteger(raw, "context"),
    output: optionPositiveInteger(raw, "output"),
    useModelInfoContext: raw?.useModelInfoContext === true,
  }
}

function endpoint(baseURL: string, path: string) {
  return `${withoutTrailingSlash(baseURL)}${path}`
}

async function fetchJSON(url: string, init: RequestInit, fetcher: Fetch, timeout: number) {
  const response = await fetcher(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  })
  if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`)
  return response.json()
}

function modelName(input: unknown) {
  if (!isRecord(input)) return
  const name = input.name ?? input.model
  if (typeof name !== "string") return
  const trimmed = name.trim()
  if (!trimmed) return
  return trimmed
}

function readCapabilities(show: OllamaShowResponse) {
  if (!Array.isArray(show.capabilities)) return new Set<string>()
  return new Set(show.capabilities.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase()))
}

function familyFrom(...items: unknown[]) {
  for (const item of items) {
    if (typeof item !== "string") continue
    const trimmed = item.trim()
    if (trimmed) return trimmed
  }
  return ""
}

function numberFromModelInfo(show: OllamaShowResponse, suffix: string) {
  if (!show.model_info) return
  for (const [key, value] of Object.entries(show.model_info)) {
    if (!key.endsWith(suffix)) continue
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value
  }
}

export function parseParameterNumber(show: OllamaShowResponse, name: string) {
  const raw = [show.parameters, show.modelfile].filter((item): item is string => typeof item === "string").join("\n")
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`(?:^|\\n)(?:PARAMETER\\s+)?${escaped}\\s+(\\d+)(?:\\s|$)`, "i").exec(raw)
  if (!match) return
  const value = Number(match[1])
  if (!Number.isSafeInteger(value) || value <= 0) return
  return value
}

function contextLimit(show: OllamaShowResponse, options: NormalizedOptions) {
  return (
    options.context ??
    parseParameterNumber(show, "num_ctx") ??
    (options.useModelInfoContext ? numberFromModelInfo(show, ".context_length") : undefined) ??
    DEFAULT_CONTEXT_LIMIT
  )
}

function outputLimit(context: number, options: NormalizedOptions) {
  return Math.min(context, options.output ?? DEFAULT_OUTPUT_LIMIT)
}

export function toOpenCodeModel(input: {
  name: string
  tag?: OllamaTagModel
  show: OllamaShowResponse
  options: NormalizedOptions
}): OpenCodeModel | undefined {
  const capabilities = readCapabilities(input.show)
  const supportsText = capabilities.has("completion") || capabilities.has("chat")
  if (!supportsText) return

  const supportsVision = capabilities.has("vision") || capabilities.has("image")
  const supportsReasoning = capabilities.has("thinking") || capabilities.has("reasoning")
  const context = contextLimit(input.show, input.options)

  return {
    id: input.name,
    providerID: input.options.providerID,
    api: {
      id: input.name,
      url: input.options.openAIBaseURL,
      npm: OPENAI_COMPATIBLE_NPM,
    },
    name: input.name,
    family: familyFrom(input.show.details?.family, input.tag?.details?.family),
    capabilities: {
      temperature: true,
      reasoning: supportsReasoning,
      attachment: supportsVision,
      toolcall: capabilities.has("tools"),
      input: {
        text: true,
        audio: false,
        image: supportsVision,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context,
      output: outputLimit(context, input.options),
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "",
    variants: {},
  }
}

async function listLocalModels(options: NormalizedOptions, fetcher: Fetch) {
  const json = (await fetchJSON(endpoint(options.apiBaseURL, "/api/tags"), { method: "GET" }, fetcher, options.timeout)) as OllamaTagsResponse
  if (!Array.isArray(json.models)) return []
  return json.models.filter(isRecord) as OllamaTagModel[]
}

async function showModel(name: string, options: NormalizedOptions, fetcher: Fetch) {
  return (await fetchJSON(
    endpoint(options.apiBaseURL, "/api/show"),
    {
      method: "POST",
      body: JSON.stringify({ model: name }),
    },
    fetcher,
    options.timeout,
  )) as OllamaShowResponse
}

export async function discoverModels(rawOptions?: Record<string, unknown>, fetcher: Fetch = fetch) {
  const options = normalizeOptions(rawOptions)
  try {
    const models = await Promise.all(
      (await listLocalModels(options, fetcher)).map(async (tag) => {
        const name = modelName(tag)
        if (!name) return
        try {
          return [name, toOpenCodeModel({ name, tag, show: await showModel(name, options, fetcher), options })] as const
        } catch {
          return
        }
      }),
    )

    return Object.fromEntries(
      models.filter((item): item is readonly [string, OpenCodeModel] => item !== undefined && item[1] !== undefined),
    )
  } catch {
    return {}
  }
}

export function providerConfig(
  options: NormalizedOptions,
  existing?: { name?: string; npm?: string; options?: Record<string, unknown>; models?: Record<string, unknown> },
) {
  return {
    name: existing?.name ?? "Ollama (local)",
    npm: existing?.npm ?? OPENAI_COMPATIBLE_NPM,
    options: {
      ...existing?.options,
      apiKey: typeof existing?.options?.apiKey === "string" ? existing.options.apiKey : "ollama",
      baseURL: options.openAIBaseURL,
    },
    models: existing?.models ?? {},
  }
}

export const defaults = {
  host: DEFAULT_HOST,
  providerID: DEFAULT_PROVIDER_ID,
  context: DEFAULT_CONTEXT_LIMIT,
  output: DEFAULT_OUTPUT_LIMIT,
}
