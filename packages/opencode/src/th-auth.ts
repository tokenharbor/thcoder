// Token Harbor browser OAuth — drop-in for the opencode entry path.
//
// Runs at the very top of src/index.ts BEFORE any Effect / Bus / config
// loads so the rest of the runtime sees a populated process.env.TH_API_KEY.
//
// Flow (mirrors lib/llm/orchestra-router.ts → /api/cli/auth/*):
//   1. POST https://tokenharbor.ai/api/cli/auth/init  → { auth_url, poll_url }
//   2. open(auth_url) in user's browser
//   3. GET poll_url every 2 s until status === "approved"
//   4. write key to ~/.thopen/key (chmod 0600)
//   5. set process.env.TH_API_KEY so the {env:TH_API_KEY} placeholder in
//      the global config's tokenharbor provider resolves correctly
//
// Skipped silently when TH_API_KEY is already in env, when a cached key
// exists at ~/.thopen/key, when stdin isn't a TTY (CI / pipes), or when
// the user is running a non-interactive subcommand (--help, --version,
// upgrade, serve, etc.).

import fs from "fs"
import os from "os"
import path from "path"

const TH_HOMEPAGE = "https://tokenharbor.ai"
const TH_AUTH_INIT_URL = `${TH_HOMEPAGE}/api/cli/auth/init`
const POLL_INTERVAL_MS = 2_000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

function keyPath(): string {
  return path.join(os.homedir(), ".thopen", "key")
}

// opencode's native auth store: ~/.local/share/opencode/auth.json
// (Global.Path.data/auth.json), shape { [providerID]: { type:"api", key } }.
// This is where the provider actually reads the key from, so login/logout
// and the balance/route panels must go through here — not just env/file.
const TH_PROVIDER_ID = "tokenharbor"
function authJsonPath(): string {
  const dataHome = process.env["XDG_DATA_HOME"] || path.join(os.homedir(), ".local", "share")
  return path.join(dataHome, "opencode", "auth.json")
}
function readAuthStore(): Record<string, { type?: string; key?: string }> {
  try {
    return JSON.parse(fs.readFileSync(authJsonPath(), "utf8")) as Record<string, { type?: string; key?: string }>
  } catch {
    return {}
  }
}
function writeAuthStore(data: Record<string, unknown>): void {
  const p = authJsonPath()
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 })
  } catch {
    // best effort
  }
}

/** Resolve the active Token Harbor key from any store, in priority order:
 *  env → opencode auth.json → ~/.thopen/key. Used by the TUI panels. */
export function thReadKey(): string | undefined {
  if (process.env["TH_API_KEY"]) return process.env["TH_API_KEY"]
  const entry = readAuthStore()[TH_PROVIDER_ID]
  if (entry && entry.type === "api" && entry.key) return entry.key
  try {
    const f = fs.readFileSync(keyPath(), "utf8").trim()
    if (f) return f
  } catch {
    // none
  }
  return undefined
}

function loadCachedKey(): string | null {
  try {
    const text = fs.readFileSync(keyPath(), "utf8").trim()
    return text || null
  } catch {
    return null
  }
}

function saveKey(key: string): string {
  const p = keyPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, key, { mode: 0o600 })
  return p
}

// Cross-platform "open URL in browser". macOS = `open`, Linux = `xdg-open`,
// Windows = `start`. Returns true if launched; false otherwise (we still
// print the URL so the user can paste it themselves).
function openInBrowser(url: string): boolean {
  const { spawn } = require("child_process") as typeof import("child_process")
  let cmd: string
  let args: string[]
  if (process.platform === "darwin") {
    cmd = "open"
    args = [url]
  } else if (process.platform === "win32") {
    cmd = "cmd"
    args = ["/c", "start", "", url]
  } else {
    cmd = "xdg-open"
    args = [url]
  }
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref()
    return true
  } catch {
    return false
  }
}

async function browserLogin(opts?: { quiet?: boolean }): Promise<string | null> {
  // In the TUI (quiet) we must NOT write to stderr — it corrupts the
  // alt-screen. The TUI /login command surfaces status via toasts.
  const say = (s: string) => {
    if (!opts?.quiet) process.stderr.write(s)
  }
  say("THcoder: starting browser login…\n")
  let initData: { auth_url?: string; poll_url?: string } = {}
  try {
    const initRes = await fetch(TH_AUTH_INIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_label: "thcoder" }),
    })
    if (!initRes.ok) throw new Error(`HTTP ${initRes.status}`)
    initData = (await initRes.json()) as typeof initData
  } catch (e) {
    say(
      `THcoder: could not reach ${TH_AUTH_INIT_URL}: ${(e as Error).message}\n`
        + `Set TH_API_KEY=thk_... yourself (get a key at ${TH_HOMEPAGE}/dashboard/api-keys).\n`,
    )
    return null
  }
  const { auth_url, poll_url } = initData
  if (!auth_url || !poll_url) {
    say("THcoder: bad response from auth server; aborting login.\n")
    return null
  }
  say(`Opening: ${auth_url}\n`)
  say("(if your browser doesn't open, paste the URL above)\n")
  openInBrowser(auth_url)

  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const pollRes = await fetch(poll_url)
      if (pollRes.ok) {
        const data = (await pollRes.json()) as { status?: string; key?: string }
        if (data.status === "approved" && data.key) {
          const path = saveKey(data.key)
          say(`THcoder: key approved + saved to ${path}\n`)
          return data.key
        }
        if (data.status === "expired" || data.status === "denied") {
          say(`THcoder: session ${data.status}. Re-run to try again.\n`)
          return null
        }
        // "pending" / "not_found" → keep waiting.
      }
    } catch {
      // transient network — keep polling.
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  say("THcoder: browser-login timed out after 10 minutes.\n")
  return null
}

/** Sign out: clear the key from EVERY store — opencode's auth.json
 *  (where the provider actually reads it), ~/.thopen/key, and the env.
 *  After this, thReadKey() returns undefined so the prompt guard blocks
 *  new messages with a "sign in" notice. */
export function thLogout(): void {
  try {
    const store = readAuthStore()
    if (store[TH_PROVIDER_ID]) {
      delete store[TH_PROVIDER_ID]
      writeAuthStore(store)
    }
  } catch {
    // best effort
  }
  try {
    fs.rmSync(keyPath(), { force: true })
  } catch {
    // already gone
  }
  delete process.env["TH_API_KEY"]
}

/** TUI-safe login: browser OAuth (no stderr), then persist the key to
 *  ALL stores — opencode auth.json (so the provider picks it up), the
 *  cache file, and the env. Returns the key or null. */
export async function thLogin(): Promise<string | null> {
  const key = await browserLogin({ quiet: true })
  if (key) {
    process.env["TH_API_KEY"] = key
    try {
      const store = readAuthStore()
      store[TH_PROVIDER_ID] = { type: "api", key }
      writeAuthStore(store)
    } catch {
      // best effort
    }
  }
  return key
}

// Subcommands that should NEVER trigger a browser flow: help, version,
// upgrade, serve daemons, generate scripts, etc. Anything that should
// just print and exit, or runs headless on a server.
const NON_INTERACTIVE_TOKENS = new Set([
  "--help", "-h", "help",
  "--version", "-v", "version",
  "upgrade", "uninstall",
  "generate", "stats", "models", "providers",
  "serve", "acp", "github", "pr", "import", "export",
  "session", "db", "debug",
])

function shouldRunAuth(): boolean {
  if (!process.stdin.isTTY) return false
  for (const arg of process.argv.slice(2)) {
    if (NON_INTERACTIVE_TOKENS.has(arg)) return false
  }
  return true
}

export async function ensureTokenHarborKey(): Promise<void> {
  if (process.env.TH_API_KEY) return
  const cached = loadCachedKey()
  if (cached) {
    process.env.TH_API_KEY = cached
    return
  }
  if (!shouldRunAuth()) return
  const key = await browserLogin()
  if (key) {
    process.env.TH_API_KEY = key
  }
}
