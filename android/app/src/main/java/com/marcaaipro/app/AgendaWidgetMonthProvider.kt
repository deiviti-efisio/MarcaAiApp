package com.marcaaipro.app

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

class AgendaWidgetMonthProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    val snap = AgendaWidgetStore.load(context)
    val click = AgendaWidgetStore.openAppIntent(context)
    for (id in appWidgetIds) {
      val views = RemoteViews(context.packageName, R.layout.agenda_widget_month)
      AgendaWidgetStore.bindMonth(context, views, snap)
      views.setOnClickPendingIntent(R.id.widget_root, click)
      appWidgetManager.updateAppWidget(id, views)
    }
  }
}
