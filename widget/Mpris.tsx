import { createBinding, createComputed } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import Mpris from "gi://AstalMpris"
import Hyprland from "gi://AstalHyprland"

const MAX_TITLE = 35
const MAX_ARTIST = 25

// Безопасная обрезка строки с учетом Unicode/эмодзи
function truncate(str: string, max: number): string {
  if (str.length <= max) return str // Fast-path: не аллоцируем массив, если строка и так короткая
  const chars = [...str]
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : str
}

export default function MprisPlayer() {
  const hypr = Hyprland.get_default()
  const player = Mpris.Player.new("fooyin")

  const available = createBinding(player, "available")
  const status = createBinding(player, "playbackStatus")
  const title = createBinding(player, "title")
  const artist = createBinding(player, "artist")
  const album = createBinding(player, "album")

  const text = createComputed(() => {
    if (!available() || status() === Mpris.PlaybackStatus.STOPPED) return ""

    const shortTitle = truncate(title() || "Unknown", MAX_TITLE)
    const shortArtist = artist() ? ` - ${truncate(artist(), MAX_ARTIST)}` : ""

    // Экранируем спецсимволы уже после обрезки, чтобы не разрезать '&amp;' пополам
    const track = GLib.markup_escape_text(`${shortTitle}${shortArtist}`, -1)

    if (status() === Mpris.PlaybackStatus.PAUSED) {
      return `<span color="#a6adc8">󰏤 <i>${track}</i></span>`
    }
    return `<span color="#cba6f7">󰎈</span> ${track}`
  })

  const tooltip = createComputed(() => {
    if (!available()) return ""
    return [
      `󰎈 ${title() || "Неизвестно"}`,
      artist() && `󰠃 ${artist()}`,
      album() && `󰀥 ${album()}`,
    ].filter(Boolean).join("\n")
  })

  return (
    <button
      class="island island-mpris"
      visible={text(Boolean)}
      tooltipText={tooltip}
      onClicked={() => player.play_pause()}
    >
      <label useMarkup label={text} />

      <Gtk.EventControllerScroll
        flags={Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE}
        onScroll={(_, __, dy) => {
          if (dy < 0) player.next()
          else if (dy > 0) player.previous()
          return true
        }}
      />

      <Gtk.GestureClick
        button={3}
        propagationPhase={Gtk.PropagationPhase.CAPTURE}
        onPressed={() => {
          execAsync("fooyin").catch(() => { })
          hypr.message_async("dispatch hl.dsp.focus({ window = 'class:org.fooyin.fooyin' })", null)
        }}
      />
    </button>
  )
}
