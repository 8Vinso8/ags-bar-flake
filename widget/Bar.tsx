import app from "ags/gtk4/app"
import { Astal, Gdk } from "ags/gtk4"
import ActiveWindow from "./ActiveWindow"
import Clock from "./Clock"
import MprisPlayer from "./Mpris"
import System from "./System"
import Tray from "./Tray"
import Workspaces from "./Workspaces"

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

  return (
    <window
      visible
      name="bar"
      class="Bar"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={TOP | LEFT | RIGHT}
      application={app}
    >
      <centerbox cssName="centerbox" class="bar-container">
        <box $type="start" class="modules-left">
          <Workspaces />
          <ActiveWindow />
        </box>

        <box $type="center" class="modules-center">
          <Clock />
        </box>

        <box $type="end" class="modules-right">
          <MprisPlayer />
          <System />
          <Tray />
        </box>
      </centerbox>
    </window>
  )
}
