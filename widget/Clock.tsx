import { Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"
import GLib from "gi://GLib"

const FORMAT = '<span color="#cba6f7">󰥔</span> %H:%M  <span color="#cba6f7">󰸗</span> %a %d.%m.%Y'

// Один общий таймер вне компонента
const time = createPoll("", 1000, () =>
  GLib.DateTime.new_now_local().format(FORMAT) ?? ""
)

export default function Clock() {
  return (
    <menubutton class="island island-clock">
      <label useMarkup label={time} />
      <popover
        onNotifyVisible={({ visible, child }) => {
          if (visible && child instanceof Gtk.Calendar) {
            child.date = GLib.DateTime.new_now_local()
          }
        }}
      >
        <Gtk.Calendar />
      </popover>
    </menubutton>
  )
}
