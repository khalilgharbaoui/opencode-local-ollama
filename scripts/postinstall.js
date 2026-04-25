#!/usr/bin/env node

import { existsSync } from "fs"
import { join } from "path"

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434"

async function checkOllama() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  const isReachable = await checkOllama()
  if (!isReachable) {
    const { execSync } = await import("child_process")
    let ollamaInstalled = false
    try {
      execSync("which ollama", { stdio: "ignore" })
      ollamaInstalled = true
    } catch {
      // ollama not found in PATH
    }

    console.log(
      `\x1b[33m⚠️  opencode-local-ollama\x1b[0m: Ollama does not appear to be running at ${OLLAMA_HOST}`
    )
    if (!ollamaInstalled) {
      console.log("  Ollama is not installed or not in your PATH.")
      console.log("  Install from: https://ollama.com")
    } else {
      console.log("  Make sure Ollama is started: `ollama serve`")
    }
    console.log("  The plugin will still install. It will attempt to connect when OpenCode starts.\n")
  } else {
    console.log("\x1b[32m✓\x1b[0m  opencode-local-ollama: Ollama is reachable at " + OLLAMA_HOST)
    console.log()
  }
}

main()
