import { createState, For } from "ags"
import { Gtk } from "ags/gtk4"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import GdkPixbuf from "gi://GdkPixbuf?version=2.0"

Gio._promisify(Gio.DBusConnection.prototype, "call", "call_finish")

function unpack(v: any): any {
  return v instanceof GLib.Variant ? v.deepUnpack() : v
}

const BOXFLAT_PATH = `${GLib.get_user_config_dir()}/icons/boxflat/steering-wheel.png`
const boxflatIcon = GLib.file_test(BOXFLAT_PATH, GLib.FileTest.EXISTS)
  ? Gio.FileIcon.new(Gio.File.new_for_path(BOXFLAT_PATH))
  : null

export interface TrayItemModel {
  key: string
  service: string
  path: string
  id: string
  title: string
  iconName: string
  iconThemePath: string
  menuPath: string | null
  itemIsMenu: boolean
  gicon: Gio.Icon | null
  menuModel: Gio.Menu | null
  actionGroup: Gio.SimpleActionGroup | null
}

const [items, setItems] = createState<TrayItemModel[]>([])
const itemsMap = new Map<string, TrayItemModel>()

const bus = Gio.DBus.session

function resolveIcon(
  id: string,
  service: string,
  iconName: string,
  iconThemePath: string,
  iconPixmapRaw: any
): Gio.Icon | null {
  const isBoxflat = id.toLowerCase().includes("boxflat") || service.toLowerCase().includes("boxflat")
  if (isBoxflat && boxflatIcon) {
    return boxflatIcon
  }

  // 1. Direct file path in iconName
  if (iconName && GLib.file_test(iconName, GLib.FileTest.EXISTS)) {
    return Gio.FileIcon.new(Gio.File.new_for_path(iconName))
  }

  // 2. Icon in IconThemePath
  if (iconName && iconThemePath) {
    for (const ext of [".png", ".svg", ""]) {
      const candidate = `${iconThemePath}/${iconName}${ext}`
      if (GLib.file_test(candidate, GLib.FileTest.EXISTS)) {
        return Gio.FileIcon.new(Gio.File.new_for_path(candidate))
      }
    }
  }

  // 3. IconPixmap (ARGB32 byte buffer)
  if (iconPixmapRaw && Array.isArray(iconPixmapRaw) && iconPixmapRaw.length > 0) {
    try {
      let best = iconPixmapRaw[0]
      for (const p of iconPixmapRaw) {
        if (p[0] > best[0]) best = p
      }
      const [w, h, rawBytes] = best
      if (w > 0 && h > 0 && rawBytes?.length >= w * h * 4) {
        const bytes = new Uint8Array(rawBytes)
        for (let i = 0; i < w * h * 4; i += 4) {
          const a = bytes[i]
          bytes[i] = bytes[i + 1]
          bytes[i + 1] = bytes[i + 2]
          bytes[i + 2] = bytes[i + 3]
          bytes[i + 3] = a
        }
        return GdkPixbuf.Pixbuf.new_from_bytes(
          new GLib.Bytes(bytes),
          GdkPixbuf.Colorspace.RGB,
          true,
          8,
          w,
          h,
          w * 4
        )
      }
    } catch (e) {
      console.warn("Failed to parse IconPixmap:", e)
    }
  }

  // 4. Themed icon
  if (iconName) {
    return Gio.ThemedIcon.new(iconName)
  }

  return null
}

async function fetchMenu(service: string, menuPath: string): Promise<{ menu: Gio.Menu; actionGroup: Gio.SimpleActionGroup } | null> {
  try {
    const res = await (bus.call as any)(
      service,
      menuPath,
      "com.canonical.dbusmenu",
      "GetLayout",
      new GLib.Variant("(iias)", [0, -1, []]),
      null,
      Gio.DBusCallFlags.NONE,
      2000,
      null
    )
    const [revision, layout] = res.deepUnpack()
    const [rootId, rootProps, children] = layout

    const menu = new Gio.Menu()
    const actionGroup = new Gio.SimpleActionGroup()

    for (const rawItem of children || []) {
      const item = unpack(rawItem)
      const id = item[0]
      const props = item[1] || {}

      const type = props["type"] ? unpack(props["type"]) : "standard"
      const visible = props["visible"] !== undefined ? unpack(props["visible"]) : true
      if (!visible) continue

      if (type === "separator") {
        menu.append_section(null, new Gio.Menu())
        continue
      }

      const label = props["label"] ? unpack(props["label"]) : `Item ${id}`
      const enabled = props["enabled"] !== undefined ? unpack(props["enabled"]) : true
      const actionName = `action_${id}`

      const action = new Gio.SimpleAction({ name: actionName, enabled })
      action.connect("activate", () => {
        bus.call(
          service,
          menuPath,
          "com.canonical.dbusmenu",
          "Event",
          new GLib.Variant("(isvu)", [id, "clicked", new GLib.Variant("s", ""), 0]),
          null,
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          () => {}
        )
      })

      actionGroup.add_action(action)
      menu.append_item(Gio.MenuItem.new(label, `dbusmenu.${actionName}`))
    }

    return { menu, actionGroup }
  } catch (e) {
    console.warn(`Failed to fetch menu for ${service}:`, e)
    return null
  }
}

async function loadItem(service: string, path: string): Promise<TrayItemModel | null> {
  try {
    const res = await (bus.call as any)(
      service,
      path,
      "org.freedesktop.DBus.Properties",
      "GetAll",
      new GLib.Variant("(s)", ["org.kde.StatusNotifierItem"]),
      null,
      Gio.DBusCallFlags.NONE,
      3000,
      null
    )
    const [rawProps] = res.deepUnpack()
    const props: Record<string, any> = {}
    for (const [k, v] of Object.entries(rawProps)) {
      props[k] = unpack(v)
    }

    const id = props["Id"] ? String(props["Id"]) : service
    const title = props["Title"] ? String(props["Title"]) : id
    const iconName = props["IconName"] ? String(props["IconName"]) : ""
    const iconThemePath = props["IconThemePath"] ? String(props["IconThemePath"]) : ""
    const rawMenu = props["Menu"]
    const menuPath = (typeof rawMenu === "string" && rawMenu.startsWith("/")) ? rawMenu : null
    const itemIsMenu = Boolean(props["ItemIsMenu"])

    const gicon = resolveIcon(id, service, iconName, iconThemePath, props["IconPixmap"])

    let menuModel: Gio.Menu | null = null
    let actionGroup: Gio.SimpleActionGroup | null = null

    if (menuPath) {
      const dbusMenu = await fetchMenu(service, menuPath)
      if (dbusMenu) {
        menuModel = dbusMenu.menu
        actionGroup = dbusMenu.actionGroup
      }
    }

    return {
      key: `${service}${path}`,
      service,
      path,
      id,
      title,
      iconName,
      iconThemePath,
      menuPath,
      itemIsMenu,
      gicon,
      menuModel,
      actionGroup,
    }
  } catch (e) {
    console.warn(`Failed to read properties for ${service}:`, e)
    return null
  }
}

async function registerItem(rawService: string, sender?: string) {
  let busName = rawService
  let objPath = "/StatusNotifierItem"

  if (rawService.startsWith("/")) {
    objPath = rawService
    busName = sender || ""
  } else if (rawService.includes("/")) {
    const parts = rawService.split("/")
    busName = parts[0]
    objPath = "/" + parts.slice(1).join("/")
  }

  if (!busName) return

  const item = await loadItem(busName, objPath)
  if (item) {
    itemsMap.set(item.key, item)
    setItems(Array.from(itemsMap.values()))
  }
}

const WATCHER_XML = `
<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem">
      <arg name="service" type="s" direction="in"/>
    </method>
    <method name="RegisterStatusNotifierHost">
      <arg name="service" type="s" direction="in"/>
    </method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
    <signal name="StatusNotifierItemRegistered">
      <arg name="service" type="s"/>
    </signal>
    <signal name="StatusNotifierItemUnregistered">
      <arg name="service" type="s"/>
    </signal>
    <signal name="StatusNotifierHostRegistered"/>
    <signal name="StatusNotifierHostUnregistered"/>
  </interface>
</node>
`

let watcherInitialized = false

function initWatcher() {
  if (watcherInitialized) return
  watcherInitialized = true

  const nodeInfo = Gio.DBusNodeInfo.new_for_xml(WATCHER_XML)
  const ifaceInfo = nodeInfo.interfaces[0]

  try {
    bus.register_object(
      "/StatusNotifierWatcher",
      ifaceInfo,
      (conn, sender, path, iface, method, params, invocation) => {
        if (method === "RegisterStatusNotifierItem") {
          const [service] = params.deepUnpack()
          registerItem(service, sender)
          invocation.return_value(null)
        } else if (method === "RegisterStatusNotifierHost") {
          invocation.return_value(null)
        }
      },
      (conn, sender, path, iface, prop) => {
        if (prop === "RegisteredStatusNotifierItems") {
          return new GLib.Variant("as", Array.from(itemsMap.keys()))
        } else if (prop === "IsStatusNotifierHostRegistered") {
          return new GLib.Variant("b", true)
        } else if (prop === "ProtocolVersion") {
          return new GLib.Variant("i", 0)
        }
        return null
      },
      null
    )
  } catch (e) {
    console.warn("Could not register /StatusNotifierWatcher object:", e)
  }

  Gio.bus_own_name(
    Gio.BusType.SESSION,
    "org.kde.StatusNotifierWatcher",
    Gio.BusNameOwnerFlags.NONE,
    null,
    null,
    null
  )

  bus.signal_subscribe(
    "org.freedesktop.DBus",
    "org.freedesktop.DBus",
    "NameOwnerChanged",
    "/org/freedesktop/DBus",
    null,
    Gio.DBusSignalFlags.NONE,
    (conn, sender, path, iface, signal, params) => {
      const [name, oldOwner, newOwner] = params.deepUnpack()
      if (!newOwner) {
        let changed = false
        for (const [key, item] of itemsMap.entries()) {
          if (item.service === name) {
            itemsMap.delete(key)
            changed = true
          }
        }
        if (changed) {
          setItems(Array.from(itemsMap.values()))
        }
      }
    }
  )

  bus.call(
    "org.freedesktop.DBus",
    "/org/freedesktop/DBus",
    "org.freedesktop.DBus",
    "ListNames",
    null,
    null,
    Gio.DBusCallFlags.NONE,
    -1,
    null,
    (conn, res) => {
      try {
        const reply = conn.call_finish(res)
        const [names] = reply.deepUnpack()
        for (const name of names) {
          if (name.startsWith("org.kde.StatusNotifierItem-")) {
            registerItem(name)
          }
        }
      } catch (e) {
        console.warn("ListNames failed:", e)
      }
    }
  )
}

initWatcher()

function TrayItem({ item }: { item: TrayItemModel }) {
  const activate = () => {
    bus.call(
      item.service,
      item.path,
      "org.kde.StatusNotifierItem",
      "Activate",
      new GLib.Variant("(ii)", [0, 0]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      () => {}
    )
  }

  const secondaryActivate = () => {
    bus.call(
      item.service,
      item.path,
      "org.kde.StatusNotifierItem",
      "SecondaryActivate",
      new GLib.Variant("(ii)", [0, 0]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      () => {}
    )
  }

  const contextMenu = () => {
    bus.call(
      item.service,
      item.path,
      "org.kde.StatusNotifierItem",
      "ContextMenu",
      new GLib.Variant("(ii)", [0, 0]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      () => {}
    )
  }

  return (
    <menubutton
      class="tray-item"
      tooltipText={item.title}
      menuModel={item.menuModel}
      $={(self) => {
        if (item.actionGroup) {
          self.insert_action_group("dbusmenu", item.actionGroup)
        }
      }}
    >
      <image gicon={item.gicon} />

      {/* ЛКМ: если это не меню, перехватываем клик и активируем окно */}
      <Gtk.GestureClick
        button={1}
        propagationPhase={Gtk.PropagationPhase.CAPTURE}
        onPressed={(gesture) => {
          if (!item.itemIsMenu) {
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)
            activate()
          }
        }}
      />

      {/* СКМ: вторичное действие */}
      <Gtk.GestureClick
        button={2}
        propagationPhase={Gtk.PropagationPhase.CAPTURE}
        onPressed={(gesture) => {
          gesture.set_state(Gtk.EventSequenceState.CLAIMED)
          secondaryActivate()
        }}
      />

      {/* ПКМ: если меню нет, вызываем ContextMenu D-Bus */}
      <Gtk.GestureClick
        button={3}
        propagationPhase={Gtk.PropagationPhase.CAPTURE}
        onPressed={(gesture) => {
          if (!item.menuModel) {
            gesture.set_state(Gtk.EventSequenceState.CLAIMED)
            contextMenu()
          }
        }}
      />
    </menubutton>
  )
}

export default function Tray() {
  return (
    <box class="island island-tray" visible={items(list => list.length > 0)}>
      <For each={items}>
        {(item) => <TrayItem item={item} />}
      </For>
    </box>
  )
}
