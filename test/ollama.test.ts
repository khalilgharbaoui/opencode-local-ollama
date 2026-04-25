import assert from "node:assert/strict"
import { describe, test } from "node:test"
import plugin, {
  discoverModels,
  normalizeOptions,
  parseParameterNumber,
  providerConfig,
  toOpenCodeModel,
} from "../src/index.js"

const options = normalizeOptions({ host: "http://127.0.0.1:11434" })

describe("normalizeOptions", () => {
  test("normalizes Ollama host and OpenAI-compatible base URL", () => {
    assert.deepEqual(
      {
        apiBaseURL: normalizeOptions({ host: "localhost:11434/" }).apiBaseURL,
        openAIBaseURL: normalizeOptions({ host: "localhost:11434/" }).openAIBaseURL,
        providerID: normalizeOptions({ host: "localhost:11434/" }).providerID,
      },
      {
        apiBaseURL: "http://localhost:11434",
        openAIBaseURL: "http://localhost:11434/v1",
        providerID: "ollama",
      },
    )

    assert.deepEqual(
      {
        apiBaseURL: normalizeOptions({ host: "https://ollama.example.test/proxy/v1" }).apiBaseURL,
        openAIBaseURL: normalizeOptions({ host: "https://ollama.example.test/proxy/v1" }).openAIBaseURL,
      },
      {
        apiBaseURL: "https://ollama.example.test/proxy",
        openAIBaseURL: "https://ollama.example.test/proxy/v1",
      },
    )
  })
})

describe("toOpenCodeModel", () => {
  test("maps only capabilities reported by Ollama", () => {
    const model = toOpenCodeModel({
      name: "llama3.2:latest",
      options,
      show: {
        parameters: 'num_ctx                       8192\nstop                          "<|eot_id|>"',
        details: { family: "llama" },
        model_info: { "llama.context_length": 131072 },
        capabilities: ["completion", "tools"],
      },
    })

    assert.ok(model)
    assert.equal(model.capabilities.toolcall, true)
    assert.equal(model.capabilities.reasoning, false)
    assert.equal(model.capabilities.attachment, false)
    assert.equal(model.capabilities.input.image, false)
    assert.equal(model.limit.context, 8192)
    assert.equal(model.family, "llama")
  })

  test("skips models without a completion or chat capability", () => {
    assert.equal(
      toOpenCodeModel({
        name: "nomic-embed-text:latest",
        options,
        show: { capabilities: ["embedding"] },
      }),
      undefined,
    )
  })

  test("uses safe context unless runtime num_ctx or explicit option is present", () => {
    assert.equal(
      toOpenCodeModel({
        name: "large-context:latest",
        options,
        show: {
          capabilities: ["completion"],
          model_info: { "llama.context_length": 131072 },
        },
      })?.limit.context,
      4096,
    )

    assert.equal(
      toOpenCodeModel({
        name: "configured:latest",
        options: normalizeOptions({ context: 16384 }),
        show: { capabilities: ["completion"] },
      })?.limit.context,
      16384,
    )
  })
})

describe("parseParameterNumber", () => {
  test("reads num_ctx from parameters or Modelfile", () => {
    assert.equal(parseParameterNumber({ parameters: "num_ctx                       12288" }, "num_ctx"), 12288)
    assert.equal(parseParameterNumber({ modelfile: "PARAMETER num_ctx 16384" }, "num_ctx"), 16384)
  })
})

describe("discoverModels", () => {
  test("discovers local models through /api/tags and /api/show", async () => {
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith("/api/tags")) {
        return Response.json({
          models: [
            { name: "tool-model:latest", details: { family: "test" } },
            { name: "embedding-model:latest", details: { family: "nomic" } },
          ],
        })
      }

      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string }
      if (body.model === "tool-model:latest") {
        return Response.json({ capabilities: ["completion", "tools"], parameters: "num_ctx 8192" })
      }
      return Response.json({ capabilities: ["embedding"] })
    }

    assert.deepEqual(Object.keys(await discoverModels({ host: "http://127.0.0.1:11434" }, fetcher)), [
      "tool-model:latest",
    ])
  })

  test("fails closed when Ollama is unavailable", async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error("connection refused")
    }

    assert.deepEqual(await discoverModels({ host: "http://127.0.0.1:11434" }, fetcher), {})
  })
})

describe("plugin", () => {
  test("registers an Ollama provider in OpenCode config", async () => {
    const hooks = await plugin.server({}, { host: "http://127.0.0.1:11434", providerID: "local-ollama" })
    const config = {}
    await hooks.config?.(config)

    assert.deepEqual(config, {
      provider: {
        "local-ollama": providerConfig(normalizeOptions({ host: "http://127.0.0.1:11434", providerID: "local-ollama" })),
      },
    })
  })
})
