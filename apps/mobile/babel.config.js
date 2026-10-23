// Reanimated 4 compiles its animation callbacks with the worklets plugin, which
// must be last. babel-preset-expo would usually add it on its own, but pnpm's
// strict linking means it is only found when listed as a direct dependency.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  }
}
