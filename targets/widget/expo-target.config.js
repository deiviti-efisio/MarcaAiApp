/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "AgendaWidget",
  displayName: "MeuShow",
  deploymentTarget: "16.0",
  bundleIdentifier: ".widget",
  colors: {
    $accent: "#6173EF",
    $widgetBackground: "#6173EF",
  },
  entitlements: {
    "com.apple.security.application-groups":
      config.ios?.entitlements?.["com.apple.security.application-groups"] || [
        "group.com.marcaai.app",
      ],
  },
});
