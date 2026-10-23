const { withAndroidManifest } = require("@expo/config-plugins");

function ensureReceiver(application, receiver) {
  application.receiver = application.receiver || [];
  const exists = application.receiver.some(
    (item) => item.$?.["android:name"] === receiver.$["android:name"],
  );
  if (!exists) application.receiver.push(receiver);
}

module.exports = function withAgendaWidget(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) return mod;

    ensureReceiver(application, {
      $: {
        "android:name": ".AgendaWidgetSmallProvider",
        "android:exported": "true",
        "android:label": "@string/widget_small_name",
      },
      "intent-filter": [
        { action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] },
      ],
      "meta-data": [
        {
          $: {
            "android:name": "android.appwidget.provider",
            "android:resource": "@xml/agenda_widget_small_info",
          },
        },
      ],
    });

    ensureReceiver(application, {
      $: {
        "android:name": ".AgendaWidgetMonthProvider",
        "android:exported": "true",
        "android:label": "@string/widget_month_name",
      },
      "intent-filter": [
        { action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] },
      ],
      "meta-data": [
        {
          $: {
            "android:name": "android.appwidget.provider",
            "android:resource": "@xml/agenda_widget_month_info",
          },
        },
      ],
    });

    return mod;
  });
};
