package com.dzinlife.qrlifecycle.photoqrscanner

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PhotoQrScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PhotoQrScanner")

    AsyncFunction("requestPermission") {
      throw UnsupportedOperationException(
        "ERR_UNSUPPORTED_PLATFORM: Android photo QR scanning is not implemented yet"
      )
    }

    AsyncFunction("scanSince") { _: Double?, _: List<String> ->
      throw UnsupportedOperationException(
        "ERR_UNSUPPORTED_PLATFORM: Android photo QR scanning is not implemented yet"
      )
    }
  }
}
