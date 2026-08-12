const {
  IOSConfig,
  createRunOncePlugin,
  withAppDelegate,
  withEntitlementsPlist,
  withInfoPlist,
  withPodfileProperties,
  withXcodeProject,
} = require("expo/config-plugins");

const pluginName = "with-ios-scene-lifecycle";
const pluginVersion = "1.1.0";
const appDelegateMarker = "SceneDelegate creates the UIWindow and starts React Native.";

const legacyStartupBlock = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

const sceneStartupComment = `    // SceneDelegate creates the UIWindow and starts React Native. iOS 27
    // requires the scene-based lifecycle for apps built with the iOS 27 SDK.`;

const sceneDelegateContents = `internal import Expo
internal import ExpoModulesCore
import React

@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory else {
      fatalError("SceneDelegate could not access the Expo React Native factory")
    }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // Scene connections carry cold-start links instead of app delegate launch options.
    let browsingWebActivity = connectionOptions.userActivities.first {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: Self.launchOptions(
        url: connectionOptions.urlContexts.first?.url,
        userActivity: browsingWebActivity
      )
    )

    Self.route(urlContexts: connectionOptions.urlContexts)
    connectionOptions.userActivities.forEach { Self.route(userActivity: $0) }
  }

  func sceneDidDisconnect(_ scene: UIScene) {
    window = nil
  }

  // UIKit no longer calls the matching UIApplicationDelegate methods after scene adoption.
  func sceneDidBecomeActive(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    ExpoAppDelegateSubscriberManager.applicationDidEnterBackground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    Self.route(urlContexts: URLContexts)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    Self.route(userActivity: userActivity)
  }
}

extension SceneDelegate {
  static func launchOptions(
    url: URL?,
    userActivity: NSUserActivity?
  ) -> [UIApplication.LaunchOptionsKey: Any]? {
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url {
      launchOptions[UIApplication.LaunchOptionsKey(rawValue: "UIApplicationLaunchOptionsURLKey")] = url
    }
    if let userActivity {
      launchOptions[UIApplication.LaunchOptionsKey(
        rawValue: "UIApplicationLaunchOptionsUserActivityDictionaryKey"
      )] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": userActivity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": userActivity,
      ]
    }
    return launchOptions.isEmpty ? nil : launchOptions
  }

  static func route(urlContexts: Set<UIOpenURLContext>) {
    for context in urlContexts {
      let options = openURLOptions(from: context.options)
      _ = ExpoAppDelegateSubscriberManager.application(
        UIApplication.shared,
        open: context.url,
        options: options
      )
      RCTLinkingManager.application(
        UIApplication.shared,
        open: context.url,
        options: options
      )
    }
  }

  static func route(userActivity: NSUserActivity) {
    _ = ExpoAppDelegateSubscriberManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }

  private static func openURLOptions(
    from sceneOptions: UIScene.OpenURLOptions
  ) -> [UIApplication.OpenURLOptionsKey: Any] {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    if let sourceApplication = sceneOptions.sourceApplication {
      options[.sourceApplication] = sourceApplication
    }
    if let annotation = sceneOptions.annotation {
      options[.annotation] = annotation
    }
    options[.openInPlace] = sceneOptions.openInPlace
    return options
  }
}
`;

const sceneManifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: "Default Configuration",
        UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
      },
    ],
  },
};

function patchAppDelegate(contents) {
  if (contents.includes(appDelegateMarker)) {
    return contents;
  }
  if (!contents.includes(legacyStartupBlock)) {
    throw new Error(
      `${pluginName}: Expo's generated AppDelegate template changed; refusing to apply an unsafe iOS scene-lifecycle patch.`,
    );
  }
  return contents.replace(legacyStartupBlock, sceneStartupComment);
}

function pushEnvironmentForConfiguration(name) {
  return String(name).replaceAll('"', "") === "Release" ? "production" : "development";
}

function withIosSceneLifecycle(config) {
  config = withPodfileProperties(config, (configWithProperties) => {
    // Expo's precompiled modules are linked against the prebuilt dynamic
    // React.framework. React Native can legitimately fall back to a source
    // build when that artifact is unavailable, which would leave the app with
    // static React code but precompiled Expo frameworks that still require the
    // missing dynamic framework at launch. Building Expo modules from source
    // keeps the linkage model consistent with React Native's actual choice.
    configWithProperties.modResults.EXPO_USE_PRECOMPILED_MODULES = "false";
    return configWithProperties;
  });

  config = withInfoPlist(config, (configWithPlist) => {
    configWithPlist.modResults.UIApplicationSceneManifest = sceneManifest;
    return configWithPlist;
  });

  config = withAppDelegate(config, (configWithDelegate) => {
    if (configWithDelegate.modResults.language !== "swift") {
      throw new Error(`${pluginName}: only the Expo Swift AppDelegate template is supported.`);
    }
    configWithDelegate.modResults.contents = patchAppDelegate(
      configWithDelegate.modResults.contents,
    );
    return configWithDelegate;
  });

  config = withEntitlementsPlist(config, (configWithEntitlements) => {
    // A checked-in literal cannot represent both development-client and Ad Hoc
    // signing. Xcode expands this per configuration from the settings below.
    configWithEntitlements.modResults["aps-environment"] = "$(APS_ENVIRONMENT)";
    return configWithEntitlements;
  });

  config = withXcodeProject(config, (configWithProject) => {
    const configurations = configWithProject.modResults.pbxXCBuildConfigurationSection();
    for (const configuration of Object.values(configurations)) {
      if (!configuration || typeof configuration !== "object" || !("buildSettings" in configuration)) {
        continue;
      }
      configuration.buildSettings.APS_ENVIRONMENT = pushEnvironmentForConfiguration(
        "name" in configuration ? configuration.name : "Debug",
      );
    }
    return configWithProject;
  });

  return IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
    filePath: "SceneDelegate.swift",
    contents: sceneDelegateContents,
    overwrite: true,
  });
}

const plugin = createRunOncePlugin(withIosSceneLifecycle, pluginName, pluginVersion);
plugin._internals = {
  legacyStartupBlock,
  patchAppDelegate,
  pushEnvironmentForConfiguration,
  sceneDelegateContents,
  sceneManifest,
};

module.exports = plugin;
