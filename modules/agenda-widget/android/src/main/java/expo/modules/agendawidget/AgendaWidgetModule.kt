package expo.modules.agendawidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AgendaWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AgendaWidget")

    Function("saveSnapshot") { json: String ->
      val context = appContext.reactContext ?: appContext.currentActivity ?: return@Function
      context
        .getSharedPreferences("agenda_widget", Context.MODE_PRIVATE)
        .edit()
        .putString("snapshot", json)
        .apply()
      refreshWidgets(context)
    }
  }

  private fun refreshWidgets(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    listOf("AgendaWidgetSmallProvider", "AgendaWidgetMonthProvider").forEach { className ->
      val name = ComponentName(context.packageName, "${context.packageName}.$className")
      val ids = manager.getAppWidgetIds(name)
      if (ids.isNotEmpty()) {
        val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
          component = name
          putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
        }
        context.sendBroadcast(intent)
      }
    }
  }
}
