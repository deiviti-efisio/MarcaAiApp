package com.marcaaipro.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

data class WidgetSnapshot(
  val artistName: String,
  val dates: Set<String>,
  val nextName: String?,
  val nextYmd: String?,
  val nextTime: String?,
  val nextPlace: String?,
)

object AgendaWidgetStore {
  const val PREFS = "agenda_widget"
  const val KEY = "snapshot"

  private val ptBr = Locale("pt", "BR")
  private val weekdayFmt = SimpleDateFormat("EEEE", ptBr)
  private val monthFmt = SimpleDateFormat("MMMM yyyy", ptBr)
  private val dayFmt = SimpleDateFormat("d", ptBr)
  private val shortDateFmt = SimpleDateFormat("dd/MM", ptBr)

  fun load(context: Context): WidgetSnapshot {
    val file = java.io.File(context.filesDir, "agenda_widget.json")
    val raw = if (file.exists()) {
      try {
        file.readText()
      } catch (_: Exception) {
        null
      }
    } else {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
    }
    if (raw.isNullOrBlank()) {
      return WidgetSnapshot("", emptySet(), null, null, null, null)
    }
    return try {
      val json = JSONObject(raw)
      val dates = mutableSetOf<String>()
      val arr = json.optJSONArray("dates")
      if (arr != null) {
        for (i in 0 until arr.length()) {
          dates.add(arr.optString(i))
        }
      }
      WidgetSnapshot(
        artistName = json.optString("artistName"),
        dates = dates,
        nextName = json.optString("nextName").ifBlank { null },
        nextYmd = json.optString("nextYmd").ifBlank { null },
        nextTime = json.optString("nextTime").ifBlank { null },
        nextPlace = json.optString("nextPlace").ifBlank { null },
      )
    } catch (_: Exception) {
      WidgetSnapshot("", emptySet(), null, null, null, null)
    }
  }

  fun openAppIntent(context: Context): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("marcaai://agenda")).apply {
      setPackage(context.packageName)
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  fun todayYmd(): String {
    val c = Calendar.getInstance()
    return String.format(
      Locale.US,
      "%04d-%02d-%02d",
      c.get(Calendar.YEAR),
      c.get(Calendar.MONTH) + 1,
      c.get(Calendar.DAY_OF_MONTH),
    )
  }

  fun parseYmd(ymd: String): Calendar? {
    val parts = ymd.split("-")
    if (parts.size < 3) return null
    return try {
      Calendar.getInstance().apply {
        set(Calendar.YEAR, parts[0].toInt())
        set(Calendar.MONTH, parts[1].toInt() - 1)
        set(Calendar.DAY_OF_MONTH, parts[2].toInt())
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
      }
    } catch (_: Exception) {
      null
    }
  }

  fun bindSmall(views: RemoteViews, snap: WidgetSnapshot) {
    val now = Calendar.getInstance()
    val weekday = weekdayFmt.format(now.time).replaceFirstChar { it.uppercase(ptBr) }
    views.setTextViewText(R.id.today_weekday, weekday)
    views.setTextViewText(R.id.today_day, dayFmt.format(now.time))
    if (snap.artistName.isNotBlank()) {
      views.setViewVisibility(R.id.artist_name, View.VISIBLE)
      views.setTextViewText(R.id.artist_name, snap.artistName)
    } else {
      views.setViewVisibility(R.id.artist_name, View.GONE)
    }

    val today = todayYmd()
    if (snap.nextName.isNullOrBlank() || snap.nextYmd.isNullOrBlank()) {
      views.setTextViewText(R.id.next_label, "Próximo show")
      views.setTextViewText(R.id.next_title, "Nenhum show próximo")
      views.setTextViewText(R.id.next_meta, "Adicione na agenda do app")
      return
    }

    val isToday = snap.nextYmd == today
    views.setTextViewText(R.id.next_label, if (isToday) "Hoje" else "Próximo show")
    views.setTextViewText(R.id.next_title, snap.nextName)
    val datePart = if (isToday) {
      null
    } else {
      parseYmd(snap.nextYmd)?.let { shortDateFmt.format(it.time) }
    }
    val meta = listOfNotNull(datePart, snap.nextTime, snap.nextPlace)
      .filter { it.isNotBlank() }
      .joinToString(" · ")
    views.setTextViewText(R.id.next_meta, meta.ifBlank { "Toque para abrir a agenda" })
  }

  fun bindMonth(context: Context, parent: RemoteViews, snap: WidgetSnapshot) {
    val cal = Calendar.getInstance()
    val today = todayYmd()
    parent.setTextViewText(
      R.id.month_title,
      monthFmt.format(cal.time).replaceFirstChar { it.uppercase(ptBr) },
    )
    parent.removeAllViews(R.id.weeks_container)

    val cursor = cal.clone() as Calendar
    cursor.set(Calendar.DAY_OF_MONTH, 1)
    val year = cursor.get(Calendar.YEAR)
    val month = cursor.get(Calendar.MONTH)
    val firstWeekday = cursor.get(Calendar.DAY_OF_WEEK)
    val leading = firstWeekday - Calendar.SUNDAY
    val lastDay = cursor.getActualMaximum(Calendar.DAY_OF_MONTH)

    var dayNum = 1 - leading
    for (week in 0 until 6) {
      val row = RemoteViews(context.packageName, R.layout.agenda_widget_week_row)
      for (dow in 0 until 7) {
        val cell = RemoteViews(context.packageName, R.layout.agenda_widget_day)
        if (dayNum in 1..lastDay) {
          val ymd = String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, dayNum)
          cell.setTextViewText(R.id.day_text, dayNum.toString())
          val isToday = ymd == today
          val hasEvent = snap.dates.contains(ymd)
          if (isToday) {
            cell.setInt(R.id.day_text, "setBackgroundResource", R.drawable.widget_day_today)
            cell.setTextColor(R.id.day_text, 0xFF4C51BF.toInt())
          } else {
            cell.setInt(R.id.day_text, "setBackgroundResource", android.R.color.transparent)
            cell.setTextColor(R.id.day_text, 0xFFFFFFFF.toInt())
          }
          cell.setViewVisibility(
            R.id.day_dot,
            if (hasEvent) View.VISIBLE else View.INVISIBLE,
          )
        } else {
          cell.setTextViewText(R.id.day_text, "")
          cell.setViewVisibility(R.id.day_dot, View.INVISIBLE)
        }
        row.addView(R.id.week_row, cell)
        dayNum += 1
      }
      parent.addView(R.id.weeks_container, row)
    }
  }
}
