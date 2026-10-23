import SwiftUI
import WidgetKit

private let appGroupId = "group.com.marcaai.app"
private let snapshotKey = "agendaWidget"

struct AgendaSnapshot: Codable {
  var artistName: String
  var dates: [String]
  var nextName: String?
  var nextYmd: String?
  var nextTime: String?
  var nextPlace: String?
}

private func loadSnapshot() -> AgendaSnapshot {
  let defaults = UserDefaults(suiteName: appGroupId)
  guard
    let json = defaults?.string(forKey: snapshotKey),
    let data = json.data(using: .utf8),
    let snap = try? JSONDecoder().decode(AgendaSnapshot.self, from: data)
  else {
    return AgendaSnapshot(artistName: "", dates: [], nextName: nil, nextYmd: nil, nextTime: nil, nextPlace: nil)
  }
  return snap
}

private func todayYmd(_ date: Date = Date()) -> String {
  let comps = Calendar.current.dateComponents([.year, .month, .day], from: date)
  return String(format: "%04d-%02d-%02d", comps.year ?? 0, comps.month ?? 0, comps.day ?? 0)
}

private let ptBr = Locale(identifier: "pt_BR")

struct AgendaEntry: TimelineEntry {
  let date: Date
  let snapshot: AgendaSnapshot
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> AgendaEntry {
    AgendaEntry(date: Date(), snapshot: loadSnapshot())
  }

  func getSnapshot(in context: Context, completion: @escaping (AgendaEntry) -> Void) {
    completion(AgendaEntry(date: Date(), snapshot: loadSnapshot()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<AgendaEntry>) -> Void) {
    let entry = AgendaEntry(date: Date(), snapshot: loadSnapshot())
    let next = Calendar.current.nextDate(
      after: Date(),
      matching: DateComponents(hour: 0, minute: 5),
      matchingPolicy: .nextTime
    ) ?? Date().addingTimeInterval(3600)
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

struct NextShowView: View {
  var entry: AgendaEntry

  var body: some View {
    let snap = entry.snapshot
    let weekday = entry.date.formatted(.dateTime.weekday(.wide).locale(ptBr))
    let day = entry.date.formatted(.dateTime.day().locale(ptBr))
    let today = todayYmd(entry.date)

    VStack(alignment: .leading, spacing: 2) {
      if !snap.artistName.isEmpty {
        Text(snap.artistName)
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.85))
          .lineLimit(1)
      }
      Text(weekday.capitalized)
        .font(.caption)
        .fontWeight(.semibold)
        .foregroundStyle(.white)
      Text(day)
        .font(.system(size: 32, weight: .bold))
        .foregroundStyle(.white)

      Spacer(minLength: 6)

      if let name = snap.nextName, let ymd = snap.nextYmd, !name.isEmpty {
        Text(ymd == today ? "Hoje" : "Próximo show")
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.8))
        Text(name)
          .font(.subheadline)
          .fontWeight(.bold)
          .foregroundStyle(.white)
          .lineLimit(2)
        Text(metaLine(snap: snap, today: today))
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.9))
          .lineLimit(1)
      } else {
        Text("Próximo show")
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.8))
        Text("Nenhum show próximo")
          .font(.subheadline)
          .fontWeight(.bold)
          .foregroundStyle(.white)
        Text("Adicione na agenda do app")
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.9))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private func metaLine(snap: AgendaSnapshot, today: String) -> String {
    var parts: [String] = []
    if let ymd = snap.nextYmd, ymd != today {
      let bits = ymd.split(separator: "-")
      if bits.count >= 3 {
        parts.append("\(bits[2])/\(bits[1])")
      }
    }
    if let time = snap.nextTime, !time.isEmpty { parts.append(time) }
    if let place = snap.nextPlace, !place.isEmpty { parts.append(place) }
    return parts.isEmpty ? "Toque para abrir a agenda" : parts.joined(separator: " · ")
  }
}

struct MonthView: View {
  var entry: AgendaEntry

  var body: some View {
    let cal = Calendar.current
    let monthTitle = entry.date.formatted(.dateTime.month(.wide).year().locale(ptBr)).capitalized
    let today = todayYmd(entry.date)
    let marked = Set(entry.snapshot.dates)
    let days = monthCells(for: entry.date, calendar: cal)
    let weekdays = ["D", "S", "T", "Q", "Q", "S", "S"]

    VStack(alignment: .leading, spacing: 6) {
      Text(monthTitle)
        .font(.headline)
        .foregroundStyle(.white)

      HStack(spacing: 0) {
        ForEach(Array(weekdays.enumerated()), id: \.offset) { _, label in
          Text(label)
            .font(.caption2)
            .fontWeight(.bold)
            .foregroundStyle(.white.opacity(0.7))
            .frame(maxWidth: .infinity)
        }
      }

      let rows = days.chunked(into: 7)
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        HStack(spacing: 0) {
          ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
            dayCell(cell, today: today, marked: marked)
              .frame(maxWidth: .infinity)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
  }

  @ViewBuilder
  private func dayCell(_ cell: String?, today: String, marked: Set<String>) -> some View {
    if let ymd = cell {
      let day = String(ymd.suffix(2)).replacingOccurrences(of: "^0", with: "", options: .regularExpression)
      let isToday = ymd == today
      let hasEvent = marked.contains(ymd)
      VStack(spacing: 2) {
        Text(day)
          .font(.caption2)
          .fontWeight(isToday ? .bold : .regular)
          .foregroundStyle(isToday ? Color(red: 76 / 255, green: 81 / 255, blue: 191 / 255) : .white)
          .frame(width: 22, height: 22)
          .background(isToday ? Color.white : Color.clear)
          .clipShape(Circle())
        Circle()
          .fill(hasEvent ? Color.white : Color.clear)
          .frame(width: 4, height: 4)
      }
    } else {
      VStack(spacing: 2) {
        Text(" ")
          .font(.caption2)
          .frame(width: 22, height: 22)
        Circle().fill(Color.clear).frame(width: 4, height: 4)
      }
    }
  }

  private func monthCells(for date: Date, calendar: Calendar) -> [String?] {
    let comps = calendar.dateComponents([.year, .month], from: date)
    guard let start = calendar.date(from: DateComponents(year: comps.year, month: comps.month, day: 1)),
          let range = calendar.range(of: .day, in: .month, for: start)
    else { return [] }

    let weekday = calendar.component(.weekday, from: start) // 1 = Sunday
    let leading = weekday - 1
    var cells: [String?] = Array(repeating: nil, count: leading)
    for day in range {
      cells.append(String(format: "%04d-%02d-%02d", comps.year ?? 0, comps.month ?? 0, day))
    }
    while cells.count % 7 != 0 { cells.append(nil) }
    return cells
  }
}

struct AgendaWidgetView: View {
  var entry: AgendaEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    Group {
      if family == .systemLarge {
        MonthView(entry: entry)
      } else {
        NextShowView(entry: entry)
      }
    }
    .widgetURL(URL(string: "marcaai://agenda"))
  }
}

struct AgendaWidget: Widget {
  let kind: String = "AgendaWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      if #available(iOS 17.0, *) {
        AgendaWidgetView(entry: entry)
          .containerBackground(for: .widget) {
            Color(red: 97 / 255, green: 115 / 255, blue: 239 / 255)
          }
      } else {
        AgendaWidgetView(entry: entry)
          .padding()
          .background(Color(red: 97 / 255, green: 115 / 255, blue: 239 / 255))
      }
    }
    .configurationDisplayName("Agenda")
    .description("Hoje e o próximo show, ou o calendário do mês. Toque para abrir a agenda.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct AgendaWidgetBundle: WidgetBundle {
  var body: some Widget {
    AgendaWidget()
  }
}

private extension Array {
  func chunked(into size: Int) -> [[Element]] {
    stride(from: 0, to: count, by: size).map {
      Array(self[$0..<Swift.min($0 + size, count)])
    }
  }
}
