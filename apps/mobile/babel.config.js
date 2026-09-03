// Reanimated 4 (a dependency of react-native-keyboard-controller) requires the
// worklets Babel plugin, and it MUST be the last plugin in the list. Expo apps
// otherwise pick up babel-preset-expo automatically; declaring the config
// explicitly is required once a worklets-based library is added.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
