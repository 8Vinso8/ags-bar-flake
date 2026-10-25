import { createBinding, For } from "ags"
import { Gtk } from "ags/gtk4"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import AstalTray from "gi://AstalTray"

const BOXFLAT_ICON = `${GLib.get_user_config_dir()}/icons/boxflat/steering-wheel.png`

function TrayItem({ item }: { item: AstalTray.TrayItem }) {
  const isBoxflat = item.id?.toLowerCase().includes("boxflat")
  const gicon = isBoxflat && GLib.file_test(BOXFLAT_ICON, GLib.FileTest.EXISTS)
    ? Gio.FileIcon.new(Gio.File.new_for_path(BOXFLAT_ICON))
    : createBinding(item, "gicon")

  const tooltip = createBinding(item, "tooltipMarkup")
  const menuModel = createBinding(item, "menuModel")

  const btn = (
    <menubutton
      class="tray-item"
      tooltipMarkup={tooltip}
      menuModel={menuModel}
    >
      <image gicon={gicon} />
    </menubutton>
  ) as Gtk.MenuButton

  const updateActions = () => {
    if (item.actionGroup) {
      btn.insert_action_group("dbusmenu", item.actionGroup)
    }
  }

  updateActions()
  item.connect("notify::action-group", updateActions)

  return btn
}

export default function Tray() {
  const tray = AstalTray.get_default()
  const items = createBinding(tray, "items")

  return (
    <box class="island island-tray" visible={items(list => (list ?? []).length > 0)}>
      <For each={items}>
        {(item: AstalTray.TrayItem) => <TrayItem item={item} />}
      </For>
    </box>
  )
}
