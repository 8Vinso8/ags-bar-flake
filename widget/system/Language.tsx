import { createState } from "ags"
import Hyprland from "gi://AstalHyprland"

const hypr = Hyprland.get_default()
const parseLang = (str = "") => (str.toLowerCase().includes("ru") ? "RU" : "EN")

const [layout, setLayout] = createState("EN")

// Асинхронное чтение при старте
hypr.message_async("j/devices", (_, res) => {
  try {
    const kbs = JSON.parse(hypr.message_finish(res)).keyboards ?? []
    const main = kbs.find((k: any) => k.main) ?? kbs[0]
    if (main?.active_keymap) setLayout(parseLang(main.active_keymap))
  } catch {}
})

// Слушаем смену раскладки
hypr.connect("keyboard-layout", (_, __, name: string) => {
  if (name) setLayout(parseLang(name))
})

export default function Language() {
  return (
    <button
      class="system-module language"
      tooltipText="Сменить раскладку"
      onClicked={() => hypr.message_async("switchxkblayout all next", null)}
    >
      <label useMarkup label={layout(l => `<span color="#cba6f7">󰌌</span> ${l}`)} />
    </button>
  )
}
