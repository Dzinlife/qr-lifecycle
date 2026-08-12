package com.fallinlife.qrlifecycle.photoqrscanner

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PhotoQrScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PhotoQrScanner")
    Events("onScanProgress")

    AsyncFunction("requestPermission") {
      throw UnsupportedOperationException(
        "ERR_UNSUPPORTED_PLATFORM: Android photo QR scanning is not implemented yet"
      )
    }

    AsyncFunction("scanSince") { _: String, _: Double?, _: List<String>, _: Int ->
      throw UnsupportedOperationException(
        "ERR_UNSUPPORTED_PLATFORM: Android photo QR scanning is not implemented yet"
      )
    }

    AsyncFunction("analyzeImage") { _: String, _: String ->
      throw UnsupportedOperationException(
        "ERR_UNSUPPORTED_PLATFORM: Android photo QR scanning is not implemented yet"
      )
    }

    Function("cancelScan") { _: String -> Unit }
  }
}
