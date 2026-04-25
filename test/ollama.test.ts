import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  normalizeOptions,
  parseParameterNumber,
  toOpenCodeModel,
  providerConfig,
  discoverModels,
  defaults,
} from "../src/ollama.js"
import type { OllamaShowResponse, NormalizedOptions } from "../src/ollama.js"

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function baseOptions(overrides?: Partial<NormalizedOptions>): NormalizedOptions {
  return {
    apiBaseURL: "http://localhost:11434",
    openAIBaseURL: "http://localhost:11434/v1",
    providerID: "ollama",
    timeout: 5000,
    useModelInfoContext: false,
    ...overrides,
  }
}

function chatShow(overrides?: Partial<OllamaShowResponse>): OllamaShowResponse {
  return { capabilities: ["chat"], ...overrides }
}

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> }
function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request, _init?: RequestInit): Promise<FetchResponse> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.includes(pattern)) return { ok: true, status: 200, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

// ---------------------------------------------------------------------------
// normalizeOptions
// ---------------------------------------------------------------------------

describe("normalizeOptions", () => {
  it("returns defaults when called with no arguments", () => {
    const opts = normalizeOptions()
    assert.equal(opts.apiBaseURL, "http://localhost:11434")
    assert.equal(opts.openAIBaseURL, "http://localhost:11434/v1")
    assert.equal(opts.providerID, "ollama")
    assert.equal(opts.timeout, 5000)
    assert.equal(opts.useModelInfoContext, false)
    assert.equal(opts.context, undefined)
    assert.equal(opts.output, undefined)
  })

  it("host takes precedence over baseURL", () => {
    const opts = normalizeOptions({ host: "http://a:1111", baseURL: "http://b:2222" })
    assert.equal(opts.apiBaseURL, "http://a:1111")
  })

  it("baseURL is used when host is not set", () => {
    const opts = normalizeOptions({ baseURL: "http://b:2222" })
    assert.equal(opts.apiBaseURL, "http://b:2222")
  })

  it("strips /v1 suffix from baseURL to derive apiBaseURL", () => {
    const opts = normalizeOptions({ baseURL: "http://proxy:8080/v1" })
    assert.equal(opts.apiBaseURL, "http://proxy:8080")
    assert.equal(opts.openAIBaseURL, "http://proxy:8080/v1")
  })

  it("appends /v1 to openAIBaseURL when missing", () => {
    const opts = normalizeOptions({ host: "http://localhost:11434" })
    assert.equal(opts.openAIBaseURL, "http://localhost:11434/v1")
  })

  it("strips trailing slashes", () => {
    const opts = normalizeOptions({ host: "http://localhost:11434///" })
    assert.equal(opts.apiBaseURL, "http://localhost:11434")
  })

  it("respects OLLAMA_HOST env when no options given", () => {
    const prev = process.env.OLLAMA_HOST
    try {
      process.env.OLLAMA_HOST = "http://envhost:9999"
      const opts = normalizeOptions()
      assert.equal(opts.apiBaseURL, "http://envhost:9999")
    } finally {
      if (prev === undefined) delete process.env.OLLAMA_HOST
      else process.env.OLLAMA_HOST = prev
    }
  })

  it("host option overrides OLLAMA_HOST env", () => {
    const prev = process.env.OLLAMA_HOST
    try {
      process.env.OLLAMA_HOST = "http://envhost:9999"
      const opts = normalizeOptions({ host: "http://explicit:1234" })
      assert.equal(opts.apiBaseURL, "http://explicit:1234")
    } finally {
      if (prev === undefined) delete process.env.OLLAMA_HOST
      else process.env.OLLAMA_HOST = prev
    }
  })

  it("prepends http:// to bare hostnames", () => {
    const opts = normalizeOptions({ host: "myhost:7777" })
    assert.equal(opts.apiBaseURL, "http://myhost:7777")
  })

  it("rejects unsupported protocols", () => {
    assert.throws(() => normalizeOptions({ host: "ftp://localhost:11434" }), /Unsupported/)
  })

  it("rejects URLs with credentials", () => {
    assert.throws(() => normalizeOptions({ host: "http://user:pass@localhost:11434" }), /credentials/)
  })

  it("coerces useModelInfoContext to boolean", () => {
    assert.equal(normalizeOptions({ useModelInfoContext: true }).useModelInfoContext, true)
    assert.equal(normalizeOptions({ useModelInfoContext: "yes" as unknown }).useModelInfoContext, false)
    assert.equal(normalizeOptions({}).useModelInfoContext, false)
  })

  it("reads context and output as positive integers", () => {
    const opts = normalizeOptions({ context: 8192, output: 2048 })
    assert.equal(opts.context, 8192)
    assert.equal(opts.output, 2048)
  })

  it("ignores non-positive or non-integer context/output", () => {
    assert.equal(normalizeOptions({ context: -1 }).context, undefined)
    assert.equal(normalizeOptions({ context: 0 }).context, undefined)
    assert.equal(normalizeOptions({ context: 1.5 }).context, undefined)
    assert.equal(normalizeOptions({ output: "big" as unknown }).output, undefined)
  })

  it("reads providerID", () => {
    assert.equal(normalizeOptions({ providerID: "my-ollama" }).providerID, "my-ollama")
  })

  it("reads timeout", () => {
    assert.equal(normalizeOptions({ timeout: 10000 }).timeout, 10000)
  })
})

// ---------------------------------------------------------------------------
// parseParameterNumber
// ---------------------------------------------------------------------------

describe("parseParameterNumber", () => {
  it("extracts num_ctx from parameters string", () => {
    assert.equal(parseParameterNumber({ parameters: "num_ctx 8192" }, "num_ctx"), 8192)
  })

  it("extracts PARAMETER num_ctx from modelfile", () => {
    const show: OllamaShowResponse = {
      modelfile: 'FROM llama3\nPARAMETER num_ctx 16384\nPARAMETER temperature 0.7',
    }
    assert.equal(parseParameterNumber(show, "num_ctx"), 16384)
  })

  it("checks parameters before modelfile", () => {
    const show: OllamaShowResponse = {
      parameters: "num_ctx 1000",
      modelfile: "PARAMETER num_ctx 2000",
    }
    assert.equal(parseParameterNumber(show, "num_ctx"), 1000)
  })

  it("returns undefined when parameter is missing", () => {
    assert.equal(parseParameterNumber({ parameters: "temperature 0.7" }, "num_ctx"), undefined)
  })

  it("returns undefined when no parameters or modelfile", () => {
    assert.equal(parseParameterNumber({}, "num_ctx"), undefined)
  })

  it("returns undefined for non-positive values", () => {
    assert.equal(parseParameterNumber({ parameters: "num_ctx 0" }, "num_ctx"), undefined)
  })

  it("handles multiline parameters", () => {
    const show: OllamaShowResponse = {
      parameters: "temperature 0.7\nnum_ctx 4096\ntop_p 0.9",
    }
    assert.equal(parseParameterNumber(show, "num_ctx"), 4096)
  })
})

// ---------------------------------------------------------------------------
// toOpenCodeModel
// ---------------------------------------------------------------------------

describe("toOpenCodeModel", () => {
  it("returns a model for chat-capable models", () => {
    const model = toOpenCodeModel({
      name: "llama3:latest",
      show: chatShow(),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.id, "llama3:latest")
    assert.equal(model.name, "llama3:latest")
    assert.equal(model.providerID, "ollama")
    assert.equal(model.capabilities.input.text, true)
    assert.equal(model.status, "active")
  })

  it("returns undefined for non-chat models", () => {
    const model = toOpenCodeModel({
      name: "embed-model",
      show: { capabilities: ["embedding"] },
      options: baseOptions(),
    })
    assert.equal(model, undefined)
  })

  it("returns undefined when capabilities is empty", () => {
    const model = toOpenCodeModel({
      name: "unknown",
      show: { capabilities: [] },
      options: baseOptions(),
    })
    assert.equal(model, undefined)
  })

  it("returns undefined when capabilities is missing", () => {
    const model = toOpenCodeModel({
      name: "unknown",
      show: {},
      options: baseOptions(),
    })
    assert.equal(model, undefined)
  })

  it("maps completion capability", () => {
    const model = toOpenCodeModel({
      name: "completionmodel",
      show: { capabilities: ["completion"] },
      options: baseOptions(),
    })
    assert.ok(model)
  })

  it("maps tools capability", () => {
    const model = toOpenCodeModel({
      name: "toolmodel",
      show: chatShow({ capabilities: ["chat", "tools"] }),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.capabilities.toolcall, true)
  })

  it("maps vision capability", () => {
    const model = toOpenCodeModel({
      name: "visionmodel",
      show: chatShow({ capabilities: ["chat", "vision"] }),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.capabilities.attachment, true)
    assert.equal(model.capabilities.input.image, true)
  })

  it("maps image capability as vision", () => {
    const model = toOpenCodeModel({
      name: "imgmodel",
      show: chatShow({ capabilities: ["chat", "image"] }),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.capabilities.input.image, true)
  })

  it("maps thinking capability", () => {
    const model = toOpenCodeModel({
      name: "thinkmodel",
      show: chatShow({ capabilities: ["chat", "thinking"] }),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.capabilities.reasoning, true)
  })

  it("maps reasoning capability", () => {
    const model = toOpenCodeModel({
      name: "reasonmodel",
      show: chatShow({ capabilities: ["chat", "reasoning"] }),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.capabilities.reasoning, true)
  })

  it("disables capabilities not reported by Ollama", () => {
    const model = toOpenCodeModel({
      name: "baremodel",
      show: chatShow(),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.capabilities.toolcall, false)
    assert.equal(model.capabilities.reasoning, false)
    assert.equal(model.capabilities.attachment, false)
    assert.equal(model.capabilities.input.image, false)
  })

  it("uses explicit context option over num_ctx", () => {
    const model = toOpenCodeModel({
      name: "m",
      show: chatShow({ parameters: "num_ctx 32000" }),
      options: baseOptions({ context: 8192 }),
    })
    assert.ok(model)
    assert.equal(model.limit.context, 8192)
  })

  it("uses num_ctx from parameters when no explicit context", () => {
    const model = toOpenCodeModel({
      name: "m",
      show: chatShow({ parameters: "num_ctx 16384" }),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.limit.context, 16384)
  })

  it("uses model_info context_length only when useModelInfoContext is true", () => {
    const show = chatShow({
      model_info: { "general.context_length": 131072 },
    })
    const without = toOpenCodeModel({ name: "m", show, options: baseOptions({ useModelInfoContext: false }) })
    assert.ok(without)
    assert.equal(without.limit.context, 4096)

    const withFlag = toOpenCodeModel({ name: "m", show, options: baseOptions({ useModelInfoContext: true }) })
    assert.ok(withFlag)
    assert.equal(withFlag.limit.context, 131072)
  })

  it("defaults context to 4096", () => {
    const model = toOpenCodeModel({
      name: "m",
      show: chatShow(),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.limit.context, 4096)
  })

  it("clamps output to context", () => {
    const model = toOpenCodeModel({
      name: "m",
      show: chatShow(),
      options: baseOptions({ context: 2048, output: 8192 }),
    })
    assert.ok(model)
    assert.equal(model.limit.output, 2048)
  })

  it("uses explicit output when smaller than context", () => {
    const model = toOpenCodeModel({
      name: "m",
      show: chatShow(),
      options: baseOptions({ context: 8192, output: 1024 }),
    })
    assert.ok(model)
    assert.equal(model.limit.output, 1024)
  })

  it("defaults output to 4096", () => {
    const model = toOpenCodeModel({
      name: "m",
      show: chatShow({ parameters: "num_ctx 32000" }),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.limit.output, 4096)
  })

  it("sets zero cost for local models", () => {
    const model = toOpenCodeModel({ name: "m", show: chatShow(), options: baseOptions() })
    assert.ok(model)
    assert.equal(model.cost.input, 0)
    assert.equal(model.cost.output, 0)
  })

  it("sets openAIBaseURL as api url", () => {
    const model = toOpenCodeModel({
      name: "m",
      show: chatShow(),
      options: baseOptions({ openAIBaseURL: "http://proxy:8080/v1" }),
    })
    assert.ok(model)
    assert.equal(model.api.url, "http://proxy:8080/v1")
  })

  it("reads family from show details", () => {
    const model = toOpenCodeModel({
      name: "m",
      show: chatShow({ details: { family: "llama" } }),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.family, "llama")
  })

  it("falls back to tag details family", () => {
    const model = toOpenCodeModel({
      name: "m",
      tag: { details: { family: "gemma" } },
      show: chatShow(),
      options: baseOptions(),
    })
    assert.ok(model)
    assert.equal(model.family, "gemma")
  })
})

// ---------------------------------------------------------------------------
// providerConfig
// ---------------------------------------------------------------------------

describe("providerConfig", () => {
  it("returns default provider config", () => {
    const config = providerConfig(baseOptions())
    assert.equal(config.name, "Ollama (local)")
    assert.equal(config.npm, "@ai-sdk/openai-compatible")
    assert.equal(config.options.apiKey, "ollama")
    assert.equal(config.options.baseURL, "http://localhost:11434/v1")
  })

  it("preserves existing name", () => {
    const config = providerConfig(baseOptions(), { name: "My Ollama" })
    assert.equal(config.name, "My Ollama")
  })

  it("preserves existing npm", () => {
    const config = providerConfig(baseOptions(), { npm: "custom-npm" })
    assert.equal(config.npm, "custom-npm")
  })

  it("preserves existing apiKey", () => {
    const config = providerConfig(baseOptions(), { options: { apiKey: "secret" } })
    assert.equal(config.options.apiKey, "secret")
  })

  it("always overwrites baseURL", () => {
    const config = providerConfig(
      baseOptions({ openAIBaseURL: "http://new:1111/v1" }),
      { options: { baseURL: "http://old:2222/v1" } },
    )
    assert.equal(config.options.baseURL, "http://new:1111/v1")
  })

  it("preserves existing models", () => {
    const models = { "llama3:latest": {} }
    const config = providerConfig(baseOptions(), { models })
    assert.deepEqual(config.models, models)
  })

  it("defaults models to empty object", () => {
    const config = providerConfig(baseOptions())
    assert.deepEqual(config.models, {})
  })
})

// ---------------------------------------------------------------------------
// discoverModels
// ---------------------------------------------------------------------------

describe("discoverModels", () => {
  it("returns models keyed by name", async () => {
    const fetcher = fakeFetch({
      "/api/tags": { models: [{ name: "llama3:latest" }, { name: "qwen:7b" }] },
      "/api/show": { capabilities: ["chat"] },
    })
    const models = await discoverModels({}, fetcher)
    assert.ok("llama3:latest" in models)
    assert.ok("qwen:7b" in models)
    assert.equal(Object.keys(models).length, 2)
  })

  it("filters out non-chat models", async () => {
    let callCount = 0
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes("/api/tags")) {
        return { ok: true, status: 200, json: async () => ({ models: [{ name: "embed" }, { name: "chat" }] }) }
      }
      if (url.includes("/api/show")) {
        callCount++
        const body = JSON.parse((init?.body as string) ?? "{}")
        const caps = body.model === "chat" ? ["chat"] : ["embedding"]
        return { ok: true, status: 200, json: async () => ({ capabilities: caps }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    const models = await discoverModels({}, fetcher)
    assert.equal(Object.keys(models).length, 1)
    assert.ok("chat" in models)
    assert.equal(callCount, 2)
  })

  it("swallows per-model /api/show errors", async () => {
    let showCalls = 0
    const fetcher = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes("/api/tags")) {
        return { ok: true, status: 200, json: async () => ({ models: [{ name: "good" }, { name: "bad" }] }) }
      }
      if (url.includes("/api/show")) {
        showCalls++
        if (showCalls === 1) return { ok: true, status: 200, json: async () => ({ capabilities: ["chat"] }) }
        return { ok: false, status: 500, json: async () => ({}) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch

    const models = await discoverModels({}, fetcher)
    assert.equal(Object.keys(models).length, 1)
  })

  it("returns empty object when /api/tags fails", async () => {
    const fetcher = fakeFetch({})
    const models = await discoverModels({}, fetcher)
    assert.deepEqual(models, {})
  })

  it("returns empty object when models array is missing", async () => {
    const fetcher = fakeFetch({ "/api/tags": {} })
    const models = await discoverModels({}, fetcher)
    assert.deepEqual(models, {})
  })

  it("skips entries without a name", async () => {
    const fetcher = fakeFetch({
      "/api/tags": { models: [{ name: "valid" }, { notname: "x" }, {}] },
      "/api/show": { capabilities: ["chat"] },
    })
    const models = await discoverModels({}, fetcher)
    assert.equal(Object.keys(models).length, 1)
    assert.ok("valid" in models)
  })
})

// ---------------------------------------------------------------------------
// defaults export
// ---------------------------------------------------------------------------

describe("defaults", () => {
  it("exports expected default values", () => {
    assert.equal(defaults.host, "http://localhost:11434")
    assert.equal(defaults.providerID, "ollama")
    assert.equal(defaults.context, 4096)
    assert.equal(defaults.output, 4096)
  })
})
