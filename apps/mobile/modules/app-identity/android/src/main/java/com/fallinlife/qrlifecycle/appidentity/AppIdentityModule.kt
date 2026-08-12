package com.fallinlife.qrlifecycle.appidentity

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AppIdentityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppIdentity")

    AsyncFunction("getAppTransactionJws") {
      null
    }
  }
}
