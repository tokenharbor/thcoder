import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { thReadKey } from "@/th-auth"

const id = "internal:sidebar-balance"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

type Balance = { balance_usd: number; gift_claimable_usd?: number }

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const [bal, setBal] = createSignal<Balance | null>(null)
  const [status, setStatus] = createSignal<string>("…")

  async function load() {
    const key = thReadKey()
    if (!key) {
      setStatus("not signed in")
      return
    }
    try {
      const r = await fetch("https://tokenharbor.ai/api/cli/balance", {
        headers: { authorization: `Bearer ${key}` },
      })
      if (r.ok) {
        setBal((await r.json()) as Balance)
        setStatus("")
      } else {
        setStatus(`error ${r.status}`)
      }
    } catch {
      setStatus("offline")
    }
  }

  onMount(() => {
    void load()
    const t = setInterval(() => void load(), 60_000)
    onCleanup(() => clearInterval(t))
  })

  // Low-balance is just a muted warning color — no upsell nag.
  const low = () => (bal()?.balance_usd ?? 1) < 1

  // Always render the panel; show a status line until the balance loads.
  return (
    <box>
      <text fg={theme().text}>
        <b>Balance</b>
      </text>
      <Show when={bal()} fallback={<text fg={theme().textMuted}>{status()}</text>}>
        <text fg={low() ? theme().warning : theme().textMuted}>{money.format(bal()!.balance_usd)}</text>
        {/* Nudge to claim gifts when any are unclaimed (replaces hours-left). */}
        <Show when={(bal()!.gift_claimable_usd ?? 0) > 0}>
          <text fg={theme().primary}>{money.format(bal()!.gift_claimable_usd!)} in gifts to claim</text>
        </Show>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 90,
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
