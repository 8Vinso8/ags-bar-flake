import { createBinding, createComputed } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import Wp from "gi://AstalWp"
import Hyprland from "gi://AstalHyprland"

const hypr = Hyprland.get_default()
const wp = Wp.get_default()
const speaker = wp?.defaultSpeaker
const mic = wp?.defaultMicrophone

const speakerMute = speaker ? createBinding(speaker, "mute") : () => false
const micMute = mic ? createBinding(mic, "mute") : () => false

// Вычисляем разметку один раз глобально для всех мониторов
const text = createComputed(() => {
  const speakerIcon = speakerMute()
    ? '<span color="#f38ba8">󰝟</span>'
    : '<span color="#cba6f7">󰕾</span>'

  const micIcon = micMute()
    ? '<span color="#f38ba8">󰍭</span>'
    : '<span color="#cba6f7">󰍬</span>'

  return `${speakerIcon}  ${micIcon}`
})

function togglePavucontrol() {
  const isOpen = (hypr.clients ?? hypr.get_clients() ?? []).some(c =>
    c.class?.toLowerCase().includes("pavucontrol")
  )

  if (isOpen) {
    hypr.message_async(
      "dispatch hl.dsp.window.close({ window = 'class:org.pulseaudio.pavucontrol' })",
      null
    )
  } else {
    execAsync("pavucontrol").catch(console.error)
  }
}

export default function Audio() {
  return (
    <button
      class="system-module audio"
      tooltipText="ЛКМ: Pavucontrol | ПКМ: Mute аудио | СКМ: Mute микрофон"
      onClicked={togglePavucontrol}
    >
      <label useMarkup label={text} />

      {/* ПКМ: toggle-audio (мьют звука с OSD) */}
      <Gtk.GestureClick
        button={3}
        propagationPhase={Gtk.PropagationPhase.CAPTURE}
        onPressed={() => execAsync("toggle-audio").catch(console.error)}
      />

      {/* СКМ: toggle-microphone (мьют микрофона с OSD) */}
      <Gtk.GestureClick
        button={2}
        propagationPhase={Gtk.PropagationPhase.CAPTURE}
        onPressed={() => execAsync("toggle-microphone").catch(console.error)}
      />
    </button>
  )
}
