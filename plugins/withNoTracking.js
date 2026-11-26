// Guarantees the iOS binary never ships the ATT usage string or a "tracking" privacy manifest.
// LetsJam does not track users (App Store 5.1.2).
const { withInfoPlist } = require('expo/config-plugins');
module.exports = (config) => withInfoPlist(config, (c) => {
  delete c.modResults.NSUserTrackingUsageDescription;
  return c;
});
