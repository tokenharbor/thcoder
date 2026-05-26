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

// THcoder's native auth store: ~/.local/share/thcoder/auth.json
// (Global.Path.data/auth.json), shape { [providerID]: { type:"api", key } }.
// This MUST match Global.Path.data (packages/core/src/global.ts `app`), which
// is where the native provider actually reads the key from — so the write path
// here and the provider read path resolve to the SAME file. login/logout and
// the balance/route panels all go through here, not just env/file.
const TH_PROVIDER_ID = "tokenharbor"
function dataHome(): string {
  return process.env["XDG_DATA_HOME"] || path.join(os.homedir(), ".local", "share")
}
// Current store — matches Global.Path.data after the "opencode" → "thcoder" rename.
function authJsonPath(): string {
  return path.join(dataHome(), "thcoder", "auth.json")
}
// Legacy store from when the data dir was "opencode". Read-only fallback so
// users who logged in before the rename aren't force-logged-out.
function legacyAuthJsonPath(): string {
  return path.join(dataHome(), "opencode", "auth.json")
}
function readAuthStore(): Record<string, { type?: string; key?: string }> {
  for (const p of [authJsonPath(), legacyAuthJsonPath()]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, { type?: string; key?: string }>
      if (parsed && typeof parsed === "object") return parsed
    } catch {
      // try next
    }
  }
  return {}
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

/** One-time forward migration: if the TH key only lives in the legacy
 *  ~/.local/share/opencode/auth.json but NOT in the new thcoder store, copy
 *  it forward. The native provider reads ONLY Global.Path.data/auth.json
 *  (= thcoder after the rename), so without this an old user would look
 *  "logged in" to the TUI panels while the provider couldn't find the key. */
function migrateLegacyAuthIfNeeded(): void {
  let current: Record<string, { type?: string; key?: string }> = {}
  try {
    current = JSON.parse(fs.readFileSync(authJsonPath(), "utf8"))
  } catch {
    // no current store yet
  }
  if (current && current[TH_PROVIDER_ID]?.key) return // already present in new store
  let legacy: Record<string, { type?: string; key?: string }> = {}
  try {
    legacy = JSON.parse(fs.readFileSync(legacyAuthJsonPath(), "utf8"))
  } catch {
    return // nothing to migrate
  }
  const entry = legacy?.[TH_PROVIDER_ID]
  if (entry?.type === "api" && entry.key) {
    const merged = { ...current, [TH_PROVIDER_ID]: entry }
    writeAuthStore(merged)
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

/** Sign out: clear the key from EVERY store — the native auth.json
 *  (where the provider actually reads it), the legacy opencode auth.json,
 *  ~/.thopen/key, and the env. After this, thReadKey() returns undefined so
 *  the prompt guard blocks new messages with a "sign in" notice. */
export function thLogout(): void {
  // Clear both the current (thcoder) and legacy (opencode) auth stores so a
  // stale key can't resurrect via the read fallback.
  for (const p of [authJsonPath(), legacyAuthJsonPath()]) {
    try {
      const store = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>
      if (store && typeof store === "object" && store[TH_PROVIDER_ID]) {
        delete store[TH_PROVIDER_ID]
        fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 })
      }
    } catch {
      // best effort — store may not exist
    }
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
  // Forward-migrate any pre-rename key so the native provider (which reads
  // ONLY the thcoder auth.json) sees it. Runs before we decide to prompt login.
  migrateLegacyAuthIfNeeded()
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
