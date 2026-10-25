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
  owner: string
  path: string
  id: string
  title: string
  menuPath: string | null
  itemIsMenu: boolean
  gicon: Gio.Icon | null
  menuModel: Gio.Menu | null
  actionGroup: Gio.SimpleActionGroup | null
}

const [items, setItems] = createState<TrayItemModel[]>([])
const itemsMap = new Map<string, TrayItemModel>()
const pendingLoads = new Set<string>()

const bus = Gio.DBus.session

function syncState() {
  setItems(Array.from(itemsMap.values()))
}

function resolveIcon(
  id: string,
  service: string,
  iconName: string,
  iconThemePath: string,
  iconPixmapRaw: any
): Gio.Icon | null {
  const isBoxflat = id.toLowerCase().includes("boxflat") || service.toLowerCase().includes("boxflat")
  if (isBoxflat && boxflatIcon) return boxflatIcon

  if (iconName && GLib.file_test(iconName, GLib.FileTest.EXISTS)) {
    return Gio.FileIcon.new(Gio.File.new_for_path(iconName))
  }

  if (iconName && iconThemePath) {
    for (const ext of [".png", ".svg", ""]) {
      const candidate = `${iconThemePath}/${iconName}${ext}`
      if (GLib.file_test(candidate, GLib.FileTest.EXISTS)) {
        return Gio.FileIcon.new(Gio.File.new_for_path(candidate))
      }
    }
  }

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

  if (iconName) return Gio.ThemedIcon.new(iconName)
  return null
}

function buildMenuSection(
  rawChildren: any[],
  service: string,
  menuPath: string,
  actionGroup: Gio.SimpleActionGroup
): Gio.Menu {
  const menu = new Gio.Menu()
  let currentSection = new Gio.Menu()

  for (const rawItem of rawChildren || []) {
    const item = unpack(rawItem)
    const id = item[0]
    const props: Record<string, any> = {}
    for (const [k, v] of Object.entries(item[1] || {})) {
      props[k] = unpack(v)
    }
    const subChildren = item[2] || []

    if (props["visible"] === false) continue

    if (props["type"] === "separator") {
      if (currentSection.get_n_items() > 0) {
        menu.append_section(null, currentSection)
        currentSection = new Gio.Menu()
      }
      continue
    }

    // Убираем мнемоники '_' из названий пунктов (например, "_Quit" -> "Quit")
    const rawLabel = props["label"] ? String(props["label"]).replace(/_/g, "") : `Item ${id}`
    const enabled = props["enabled"] !== false

    if (props["children-display"] === "submenu" && subChildren.length > 0) {
      const subMenu = buildMenuSection(subChildren, service, menuPath, actionGroup)
      currentSection.append_submenu(rawLabel, subMenu)
      continue
    }

    const actionName = `action_${id}`
    const action = new Gio.SimpleAction({ name: actionName, enabled })
    action.connect("activate", () => {
      bus.call(
        service,
        menuPath,
        "com.canonical.dbusmenu",
        "Event",
        new GLib.Variant("(isvu)", [id, "clicked", new GLib.Variant("i", 0), 0]),
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        null
      )
    })

    actionGroup.add_action(action)
    currentSection.append_item(Gio.MenuItem.new(rawLabel, `dbusmenu.${actionName}`))
  }

  if (currentSection.get_n_items() > 0) {
    menu.append_section(null, currentSection)
  }

  return menu
}

async function fetchMenu(service: string, menuPath: string): Promise<{ menu: Gio.Menu; actionGroup: Gio.SimpleActionGroup } | null> {
  try {
    // Сообщаем приложению, что нужно подготовить структуру меню
    await (bus.call as any)(
      service,
      menuPath,
      "com.canonical.dbusmenu",
      "AboutToShow",
      new GLib.Variant("(i)", [0]),
      null,
      Gio.DBusCallFlags.NONE,
      1000,
      null
    ).catch(() => {})

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
    const [, layout] = res.deepUnpack()
    const [, , children] = layout

    const actionGroup = new Gio.SimpleActionGroup()
    const menu = buildMenuSection(children, service, menuPath, actionGroup)

    return { menu, actionGroup }
  } catch (e) {
    console.warn(`Failed to fetch menu for ${service}:`, e)
    return null
  }
}

async function loadItem(service: string, path: string, owner: string): Promise<TrayItemModel | null> {
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
    const menuPath = typeof rawMenu === "string" && rawMenu.startsWith("/") ? rawMenu : null
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
      key: `${owner || service}${path}`,
      service,
      owner: owner || service,
      path,
      id,
      title,
      menuPath,
      itemIsMenu,
      gicon,
      menuModel,
      actionGroup,
    }
  } catch (e) {
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
    const idx = rawService.indexOf("/")
    busName = rawService.slice(0, idx)
    objPath = rawService.slice(idx)
  }

  if (!busName) return

  // Узнаем уникальный идентификатор процесса (:1.xxx), чтобы избегать дублей и точно удалять при выходе
  let owner = sender || busName
  if (!owner.startsWith(":")) {
    try {
      const res = await (bus.call as any)(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "GetNameOwner",
        new GLib.Variant("(s)", [busName]),
        null,
        Gio.DBusCallFlags.NONE,
        1000,
        null
      )
      owner = res.deepUnpack()[0]
    } catch {}
  }

  const key = `${owner}${objPath}`
  if (pendingLoads.has(key)) return
  pendingLoads.add(key)

  try {
    const item = await loadItem(busName, objPath, owner)
    if (item) {
      itemsMap.set(item.key, item)
      syncState()

      bus.emit_signal(
        null,
        "/StatusNotifierWatcher",
        "org.kde.StatusNotifierWatcher",
        "StatusNotifierItemRegistered",
        new GLib.Variant("(s)", [`${busName}${objPath}`])
      )
    }
  } finally {
    pendingLoads.delete(key)
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
      (_conn, sender, _path, _iface, method, params, invocation) => {
        if (method === "RegisterStatusNotifierItem") {
          const [service] = params.deepUnpack()
          registerItem(service, sender)
          invocation.return_value(null)
        } else if (method === "RegisterStatusNotifierHost") {
          invocation.return_value(null)
        }
      },
      (_conn, _sender, _path, _iface, prop) => {
        if (prop === "RegisteredStatusNotifierItems") {
          return new GLib.Variant("as", Array.from(itemsMap.values()).map(i => `${i.service}${i.path}`))
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
    () => {
      bus.emit_signal(
        null,
        "/StatusNotifierWatcher",
        "org.kde.StatusNotifierWatcher",
        "StatusNotifierHostRegistered",
        null
      )
    },
    null,
    null
  )

  // Подписка на обновление иконки или меню у запущенных апплетов
  for (const sig of ["NewIcon", "NewTitle", "NewStatus"]) {
    bus.signal_subscribe(
      null,
      "org.kde.StatusNotifierItem",
      sig,
      null,
      null,
      Gio.DBusSignalFlags.NONE,
      (_conn, sender, path) => {
        const existing = itemsMap.get(`${sender}${path}`)
        if (existing) registerItem(`${existing.service}${existing.path}`, sender)
      }
    )
  }

  // Удаление иконки при закрытии приложения
  bus.signal_subscribe(
    "org.freedesktop.DBus",
    "org.freedesktop.DBus",
    "NameOwnerChanged",
    "/org/freedesktop/DBus",
    null,
    Gio.DBusSignalFlags.NONE,
    (_conn, _sender, _path, _iface, _signal, params) => {
      const [name, oldOwner, newOwner] = params.deepUnpack()
      if (!newOwner) {
        let changed = false
        for (const [key, item] of itemsMap.entries()) {
          if (item.service === name || item.owner === oldOwner || item.owner === name) {
            itemsMap.delete(key)
            changed = true
          }
        }
        if (changed) syncState()
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
  let menuBtn: Gtk.MenuButton | null = null

  const callSNI = (method: string) => {
    bus.call(
      item.service,
      item.path,
      "org.kde.StatusNotifierItem",
      method,
      new GLib.Variant("(ii)", [0, 0]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      null
    )
  }

  const openMenu = async () => {
    if (!menuBtn) return

    if (item.menuPath) {
      const updated = await fetchMenu(item.service, item.menuPath)
      if (updated) {
        menuBtn.insert_action_group("dbusmenu", updated.actionGroup)
        menuBtn.set_menu_model(updated.menu)
      }
      menuBtn.popup()
    } else if (item.menuModel) {
      menuBtn.popup()
    } else {
      callSNI("ContextMenu")
    }
  }

  return (
    <menubutton
      class="tray-item"
      tooltipText={item.title}
      menuModel={item.menuModel}
      $={(self) => {
        menuBtn = self
        if (item.actionGroup) {
          self.insert_action_group("dbusmenu", item.actionGroup)
        }
      }}
    >
      <image gicon={item.gicon} />

      {/* ЛКМ: активируем окно (или открываем меню, если это апплет-меню) */}
      <Gtk.GestureClick
        button={1}
        propagationPhase={Gtk.PropagationPhase.CAPTURE}
        onPressed={(gesture) => {
          gesture.set_state(Gtk.EventSequenceState.CLAIMED)
          if (item.itemIsMenu) {
            openMenu()
          } else {
            callSNI("Activate")
          }
        }}
      />

      {/* СКМ: вторичное действие */}
      <Gtk.GestureClick
        button={2}
        propagationPhase={Gtk.PropagationPhase.CAPTURE}
        onPressed={(gesture) => {
          gesture.set_state(Gtk.EventSequenceState.CLAIMED)
          callSNI("SecondaryActivate")
        }}
      />

      {/* ПКМ: явно открываем поповер через menuBtn.popup() */}
      <Gtk.GestureClick
        button={3}
        propagationPhase={Gtk.PropagationPhase.CAPTURE}
        onPressed={(gesture) => {
          gesture.set_state(Gtk.EventSequenceState.CLAIMED)
          openMenu()
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
