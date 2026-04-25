# OpenCode Local Ollama Provider

Native Ollama model discovery for OpenCode.

`opencode-local-ollama` is a native OpenCode provider plugin. It discovers the models you already have in Ollama and registers them as `ollama/<model>` in OpenCode, so they show up in `/models` without a manual sync step.

## Why

Existing Ollama/OpenCode helpers usually generate config files or require a separate sync command. This plugin runs during OpenCode startup and uses OpenCode's provider hook directly.

## Features

- Discovers local models from Ollama on OpenCode boot.
- Uses `/api/tags` to list local models.
- Uses `/api/show` for exact model metadata.
- Registers models under the `ollama` provider.
- Uses Ollama's OpenAI-compatible endpoint at `/v1`.
- Respects `OLLAMA_HOST` and plugin options.
- Model agnostic: no hardcoded Qwen, Llama, Gemma, Mistral, or DeepSeek rules.
- Strict by default: no guessed capabilities.
- Skips non-chat models when Ollama does not report `completion` or `chat` capability.

## Install

```bash
npm install -g opencode-local-ollama
```

Then add it to your OpenCode config:

```json
{
   "plugin": ["opencode-local-ollama"]
}
```

Restart OpenCode and run:

```text
/models
```

You should see entries like:

```text
ollama/llama3.2:latest
ollama/gemma4:31b
ollama/qwen3.5:35b
```

## Usage

Pull a model with Ollama:

```bash
ollama pull llama3.2
```

Restart OpenCode. The model becomes available as:

```text
ollama/llama3.2:latest
```

## Configuration

Default behavior uses `OLLAMA_HOST` if set, otherwise `http://localhost:11434`.

```json
{
   "plugin": [
      [
        "opencode-local-ollama",
        {
          "host": "http://localhost:11434"
        }
      ]
    ]
}
```

Options:

| Option | Default | Description |
| --- | --- | --- |
| `host` | `OLLAMA_HOST` or `http://localhost:11434` | Ollama API host. May include a proxy path. |
| `baseURL` | unset | Alias for `host`. If it ends in `/v1`, the plugin derives the Ollama API base from it. |
| `providerID` | `ollama` | OpenCode provider ID to register. |
| `timeout` | `5000` | Ollama request timeout in milliseconds. |
| `context` | `4096` | Explicit context limit to expose to OpenCode. |
| `output` | `4096` | Explicit output token limit to expose to OpenCode. |
| `useModelInfoContext` | `false` | Use GGUF architecture context from `model_info` when `num_ctx` is not configured. Disabled by default because it can be larger than the runtime context Ollama actually uses. |

## Capability Mapping

The plugin treats Ollama as the source of truth.

| Ollama capability | OpenCode mapping |
| --- | --- |
| `completion` or `chat` | text input/output model |
| `tools` | tool calling enabled |
| `vision` or `image` | image attachments enabled |
| `thinking` or `reasoning` | reasoning enabled |

If Ollama does not report a capability, this plugin does not invent it from the model name.

## Context Limits

Ollama model metadata can report very large architecture context windows, such as `131072`, while runtime `num_ctx` may still be much smaller. To avoid overfilling local models, this plugin uses this priority:

1. Explicit plugin `context` option
2. `num_ctx` from `/api/show` parameters or Modelfile
3. `model_info.*.context_length` only when `useModelInfoContext` is `true`
4. Safe default `4096`

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## License

MIT
