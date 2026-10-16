package com.aigames.offline
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
class OfflineGameModule : Module() {
 override fun definition() = ModuleDefinition {
  Name("OfflineGame")
  View(OfflineGameView::class) {
   Events("onMessage", "onError")
   Prop("directory") { view: OfflineGameView, directory: String -> view.loadDirectory(directory) }
   Prop("response") { view: OfflineGameView, response: String -> view.reply(response) }
   Prop("command") { view: OfflineGameView, command: String -> view.command(command) }
  }
 }
}
