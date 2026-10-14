// Lets Chief appear over the lock screen and wake the display when it starts itself
// (morning start, "Hey Chief").
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withChiefCompanion(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$["android:name"] === ".MainActivity");
    if (main) {
      main.$["android:showWhenLocked"] = "true";
      main.$["android:turnScreenOn"] = "true";
    }
    return cfg;
  });
};
