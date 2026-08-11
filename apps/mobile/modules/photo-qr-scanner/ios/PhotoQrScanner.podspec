Pod::Spec.new do |s|
  s.name           = 'PhotoQrScanner'
  s.version        = '0.1.0'
  s.summary        = 'Local PhotoKit and Vision QR scanner for QR Lifecycle'
  s.description    = 'Scans newly inserted photo assets for QR codes on-device.'
  s.author         = 'QR Lifecycle contributors'
  s.homepage       = 'https://github.com/dzinlife/qr-lifecycle'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'Photos', 'Vision', 'UniformTypeIdentifiers'
  s.source_files   = '**/*.swift'
  s.swift_version  = '5.9'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
