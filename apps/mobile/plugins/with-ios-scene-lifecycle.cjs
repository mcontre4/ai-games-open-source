const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

// SDK 54 needs a scene entry point when built against the iOS 27 SDK.
module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        }],
      },
    };
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift')
      throw new Error('The iOS scene lifecycle plugin requires a Swift AppDelegate.');
    let contents = mod.modResults.contents;
    if (contents.includes('// AI Games scene lifecycle')) return mod;
    const startup = /window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\(\s+withModuleName: "main",\s+in: window,\s+launchOptions: launchOptions\)/;
    if (!startup.test(contents) || !contents.includes('var window: UIWindow?'))
      throw new Error('The Expo AppDelegate template changed; review the scene lifecycle integration.');
    contents = contents.replace('var window: UIWindow?',
      'var window: UIWindow?\n  var reactNativeLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?');
    contents = contents.replace(startup, 'reactNativeLaunchOptions = launchOptions');
    const sceneDelegate = readFileSync(join(__dirname, 'native', 'SceneDelegate.swift'), 'utf8');
    mod.modResults.contents = `${contents}\n// AI Games scene lifecycle\n${sceneDelegate}`;
    return mod;
  });
};
