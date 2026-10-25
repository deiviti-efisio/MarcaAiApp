import ExpoModulesCore
import WidgetKit

public class AgendaWidgetModule: Module {
  private let appGroupId = "group.com.marcaai.app"
  private let snapshotKey = "agendaWidget"
  private let widgetKind = "AgendaWidget"

  public func definition() -> ModuleDefinition {
    Name("AgendaWidget")

    Function("saveSnapshot") { (json: String) in
      guard let defaults = UserDefaults(suiteName: self.appGroupId) else { return }
      defaults.set(json, forKey: self.snapshotKey)
      defaults.synchronize()
      WidgetCenter.shared.reloadTimelines(ofKind: self.widgetKind)
    }
  }
}
