import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { thReadKey } from "@/th-auth"

const id = "internal:sidebar-route"

type Route = { role: string | null; model?: string | null; band?: string | null; confidence?: number | null }

// Title-case a role for display (coder → Coder).
function label(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [route, setRoute] = createSignal<Route | null>(null)
  const [status, setStatus] = createSignal<string>("…")

  async function load() {
    const key = thReadKey()
    if (!key) {
      setStatus("not signed in")
      return
    }
    try {
      const r = await fetch("https://tokenharbor.ai/api/cli/last-route", {
        headers: { authorization: `Bearer ${key}` },
      })
      if (r.ok) {
        const d = (await r.json()) as Route
        setRoute(d)
        setStatus(d.role ? "" : "no turns yet")
      } else {
        setStatus(`error ${r.status}`)
      }
    } catch {
      setStatus("offline")
    }
  }

  onMount(() => {
    void load()
    const t = setInterval(() => void load(), 8_000)
    onCleanup(() => clearInterval(t))
  })

  const bandColor = () => {
    const b = route()?.band
    if (b === "high") return theme().success
    if (b === "medium") return theme().warning
    return theme().textMuted
  }

  return (
    <box>
      <text fg={theme().text}>
        <b>Orchestra</b>
      </text>
      <Show when={route()?.role} fallback={<text fg={theme().textMuted}>{status()}</text>}>
        <text>
          <span style={{ fg: theme().primary }}>{label(route()!.role!)}</span>
          <Show when={route()!.model}>
            <span style={{ fg: theme().textMuted }}> → {route()!.model}</span>
          </Show>
        </text>
        <Show when={route()!.band}>
          <text fg={bandColor()}>
            {route()!.band}
            <Show when={typeof route()!.confidence === "number"}>
              <span style={{ fg: theme().textMuted }}> {route()!.confidence!.toFixed(2)}</span>
            </Show>
          </text>
        </Show>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 95,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
