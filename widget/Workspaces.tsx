import { createBinding, createComputed, For } from "ags"
import Hyprland from "gi://AstalHyprland"

const BASE_WORKSPACES = [1, 2, 3, 4, 5]

export default function Workspaces() {
  const hypr = Hyprland.get_default()

  const focused = createBinding(hypr, "focusedWorkspace")
  const workspaces = createBinding(hypr, "workspaces")
  const clients = createBinding(hypr, "clients")

  const wsIds = createComputed(() => {
    const ids = new Set(BASE_WORKSPACES)
    for (const ws of workspaces() ?? []) if (ws.id > 0) ids.add(ws.id)
    const cur = focused()?.id
    if (cur && cur > 0) ids.add(cur)
    return Array.from(ids).sort((a, b) => a - b)
  })

  return (
    <box class="island island-workspaces">
      <For each={wsIds}>
        {(id) => {
          const btnClass = createComputed(() => {
            const isActive = focused()?.id === id
            clients() // Подписка на изменение окон
            const isOccupied = (hypr.get_workspace(id)?.get_clients().length ?? 0) > 0

            return [
              "workspace-btn",
              isActive && "active",
              !isActive && !isOccupied && "empty",
            ].filter(Boolean).join(" ")
          })

          return (
            <button
              class={btnClass}
              label={String(id)}
              onClicked={() => hypr.message_async(`dispatch hl.dsp.focus({ workspace = ${id} })`, null)}
            />
          )
        }}
      </For>
    </box>
  )
}
