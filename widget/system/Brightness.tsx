import { createState } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { monitorFile, readFile } from "ags/file"
import GLib from "gi://GLib"

const CACHE_FILE = `${GLib.get_user_config_dir()}/last_brightness`

// Возвращаем null при 0 байт (O_TRUNC), чтобы не ловить 80%
function readBrightness(): number | null {
  try {
    const content = readFile(CACHE_FILE).trim()
    if (!content) return null
    const val = parseInt(content, 10)
    if (!isNaN(val)) return Math.max(0, Math.min(100, val))
  } catch {}
  return null
}

const [brightness, setBrightness] = createState(readBrightness() ?? 80)

function syncBrightness() {
  const val = readBrightness()
  if (val !== null) setBrightness(val)
}

// monitorFile из ags/file держит ссылку и слушает изменения
monitorFile(CACHE_FILE, syncBrightness)

function getIcon(val: number): string {
  if (val <= 25) return "󰃞"
  if (val <= 50) return "󰃝"
  if (val <= 75) return "󰃟"
  return "󰃠"
}

export default function Brightness() {
  const change = (dir: "up" | "down") => {
    // Не лочим интерфейс: скрипт сам запишет кэш за 3 мс и отдебаунсит ddcutil
    execAsync(`ddc-brightness ${dir}`).catch(console.error)
  }

  return (
    <box class="system-module brightness">
      <label
        useMarkup
        label={brightness(b => `<span color="#cba6f7">${getIcon(b)}</span> ${b}%`)}
      />

      <Gtk.EventControllerScroll
        flags={Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE}
        onScroll={(_, __, dy) => {
          if (dy < 0) change("up")
          else if (dy > 0) change("down")
          return true
        }}
      />
    </box>
  )
}
