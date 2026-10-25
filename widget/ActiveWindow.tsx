import { createBinding, createComputed } from "ags"
import Pango from "gi://Pango"
import Hyprland from "gi://AstalHyprland"

const MAX_CHARS = 40

export default function ActiveWindow() {
  const hypr = Hyprland.get_default()
  const focused = createBinding(hypr, "focusedClient")

  const title = createComputed(() => {
    const client = focused()
    // Читаем заголовок реактивно; если окна нет — возвращаем пустую строку
    return client ? (createBinding(client, "title")() ?? "") : ""
  })

  return (
    <box class="island island-window" visible={title(Boolean)}>
      <label
        label={title}
        maxWidthChars={MAX_CHARS}
        ellipsize={Pango.EllipsizeMode.END}
      />
    </box>
  )
}
