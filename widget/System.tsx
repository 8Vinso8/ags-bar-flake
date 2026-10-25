import Audio from "./system/Audio"
import Brightness from "./system/Brightness"
import IdleInhibitor from "./system/IdleInhibitor"
import Language from "./system/Language"

export default function System() {
  return (
    <box class="island island-system">
      <IdleInhibitor />
      <Brightness />
      <Language />
      <Audio />
    </box>
  )
}
