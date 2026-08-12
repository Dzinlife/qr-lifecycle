Pod::Spec.new do |s|
  s.name           = 'AppIdentity'
  s.version        = '0.1.0'
  s.summary        = 'Verified StoreKit app identity for Fallinlife'
  s.description    = 'Exposes the App Store signed AppTransaction JWS to the official service.'
  s.author         = 'Fallinlife contributors'
  s.homepage       = 'https://github.com/fallinlife/qr-lifecycle'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'StoreKit'
  s.source_files   = '**/*.swift'
  s.swift_version  = '5.9'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
