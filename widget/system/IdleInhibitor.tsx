import { createState } from "ags"
import Gio from "gi://Gio"
import GLib from "gi://GLib"

Gio._promisify(Gio.DBusProxy.prototype, "call", "call_finish")

// Глобальное состояние ингибитора для всех мониторов
const [active, setActive] = createState(false)
let cookie: number | null = null

const proxy = Gio.DBusProxy.new_for_bus_sync(
  Gio.BusType.SESSION,
  Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES | Gio.DBusProxyFlags.DO_NOT_CONNECT_SIGNALS,
  null,
  "org.freedesktop.ScreenSaver",
  "/org/freedesktop/ScreenSaver",
  "org.freedesktop.ScreenSaver",
  null
)

proxy.connect("notify::g-name-owner", () => {
  if (!proxy.gNameOwner && cookie !== null) {
    cookie = null
    setActive(false)
  }
})

let busy = false

const toggle = async () => {
  if (busy) return
  busy = true

  try {
    if (active()) {
      if (cookie !== null) {
        await proxy.call("UnInhibit", new GLib.Variant("(u)", [cookie]), Gio.DBusCallFlags.NONE, -1, null)
        cookie = null
      }
      setActive(false)
    } else {
      const res = await proxy.call("Inhibit", new GLib.Variant("(ss)", ["AGS", "Idle Inhibitor"]), Gio.DBusCallFlags.NONE, -1, null)
      const [c] = res.recursiveUnpack() as [number]
      cookie = c
      setActive(true)
    }
  } catch (e) {
    cookie = null
    setActive(false)
    console.error("IdleInhibitor D-Bus error:", e)
  } finally {
    busy = false
  }
}

export default function IdleInhibitor() {
  return (
    <button
      class={active(a => `idle-inhibitor${a ? " activated" : ""}`)}
      tooltipText={active(a => (a ? "Засыпание заблокировано" : "Засыпание разрешено"))}
      label={active(a => (a ? "󰒳" : "󰒲"))}
      onClicked={toggle}
    />
  )
}
