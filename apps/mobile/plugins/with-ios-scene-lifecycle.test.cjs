const assert = require("node:assert/strict");
const test = require("node:test");

const { _internals } = require("./with-ios-scene-lifecycle.cjs");

test("patchAppDelegate moves React Native startup to SceneDelegate", () => {
  const source = `before\n${_internals.legacyStartupBlock}\nafter`;
  const patched = _internals.patchAppDelegate(source);

  assert.match(patched, /SceneDelegate creates the UIWindow/);
  assert.doesNotMatch(patched, /UIWindow\(frame: UIScreen\.main\.bounds\)/);
  assert.doesNotMatch(patched, /launchOptions: launchOptions/);
});

test("patchAppDelegate is idempotent", () => {
  const patched = _internals.patchAppDelegate(_internals.legacyStartupBlock);
  assert.equal(_internals.patchAppDelegate(patched), patched);
});

test("patchAppDelegate fails closed when the Expo template changes", () => {
  assert.throws(
    () => _internals.patchAppDelegate("class AppDelegate {}"),
    /template changed/,
  );
});

test("scene lifecycle artifacts include window ownership and link routing", () => {
  assert.equal(
    _internals.sceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0]
      .UISceneDelegateClassName,
    "$(PRODUCT_MODULE_NAME).SceneDelegate",
  );
  assert.match(_internals.sceneDelegateContents, /UIWindow\(windowScene: windowScene\)/);
  assert.match(_internals.sceneDelegateContents, /factory\.startReactNative/);
  assert.match(_internals.sceneDelegateContents, /ExpoAppDelegateSubscriberManager/);
  assert.match(_internals.sceneDelegateContents, /RCTLinkingManager/);
});
