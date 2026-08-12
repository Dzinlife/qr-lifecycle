import ExpoModulesCore
import Photos
import UniformTypeIdentifiers
import Vision

public final class PhotoQrScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PhotoQrScanner")

    AsyncFunction("requestPermission") { () async -> [String: Any] in
      let status = await withCheckedContinuation { continuation in
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { authorizationStatus in
          continuation.resume(returning: authorizationStatus)
        }
      }
      return Self.permissionPayload(status)
    }

    AsyncFunction("scanSince") {
      (lastCreationTime: Double?, seenAssetIds: [String]) async throws -> [String: Any] in
      let authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
      guard authorization == .authorized || authorization == .limited else {
        throw PhotoQrScannerError.permissionDenied
      }

      return try await PhotoQrScanWorker().scan(
        lastCreationTime: lastCreationTime,
        seenAssetIds: seenAssetIds
      )
    }

    AsyncFunction("analyzeImage") { (imageUri: String) async throws -> [String: Any] in
      try PhotoQrScanWorker().analyzeImage(imageUri: imageUri)
    }
  }

  private static func permissionPayload(_ status: PHAuthorizationStatus) -> [String: Any] {
    switch status {
    case .authorized:
      return ["status": "granted", "canAskAgain": false]
    case .limited:
      return ["status": "limited", "canAskAgain": false]
    case .notDetermined:
      return ["status": "denied", "canAskAgain": true]
    case .denied, .restricted:
      return ["status": "denied", "canAskAgain": false]
    @unknown default:
      return ["status": "denied", "canAskAgain": false]
    }
  }
}

private enum PhotoQrScannerError: LocalizedError {
  case permissionDenied
  case assetUnavailable
  case invalidImageUri

  var errorDescription: String? {
    switch self {
    case .permissionDenied:
      return "ERR_PHOTO_PERMISSION_DENIED: Photo library permission is required"
    case .assetUnavailable:
      return "ERR_ASSET_UNAVAILABLE: Photo data could not be loaded"
    case .invalidImageUri:
      return "ERR_INVALID_IMAGE_URI: A readable local image URI is required"
    }
  }
}

private struct AssetData {
  let data: Data
  let typeIdentifier: String?
}

private struct RecognizedTextLine {
  let text: String
  let confidence: Float
  let boundingBox: CGRect
}

private struct VisionScanResult {
  let qrPayloads: [String]
  let textLines: [RecognizedTextLine]
}

private final class PhotoQrScanWorker {
  private let imageManager = PHImageManager.default()
  private let batchSize = 100

  func scan(lastCreationTime: Double?, seenAssetIds: [String]) async throws -> [String: Any] {
    let assets = fetchAssets(lastCreationTime: lastCreationTime)
    let previouslySeen = Set(seenAssetIds)
    var candidates: [[String: Any]] = []
    var maxCreationTime = lastCreationTime
    var idsAtMaxCreationTime = seenAssetIds

    for asset in assets {
      let creationTime = asset.creationDate.map { $0.timeIntervalSince1970 * 1_000 }
      if let lastCreationTime,
         let creationTime,
         creationTime <= lastCreationTime,
         previouslySeen.contains(asset.localIdentifier) {
        continue
      }

      if let creationTime {
        if maxCreationTime == nil || creationTime > maxCreationTime! {
          maxCreationTime = creationTime
          idsAtMaxCreationTime = [asset.localIdentifier]
        } else if creationTime == maxCreationTime && !idsAtMaxCreationTime.contains(asset.localIdentifier) {
          idsAtMaxCreationTime.append(asset.localIdentifier)
        }
      }

      guard let assetData = try? await loadData(for: asset) else { continue }
      let visionResult = try recognizeContent(in: assetData.data)
      guard !visionResult.qrPayloads.isEmpty else { continue }
      let imageUri = try exportToCache(assetData)

      for payload in visionResult.qrPayloads {
        let candidate: [String: Any] = [
          "assetId": asset.localIdentifier,
          "creationTime": creationTime ?? NSNull(),
          "payload": payload,
          "imageUri": imageUri.absoluteString,
          "ocrLines": visionResult.textLines.map(Self.textLinePayload),
        ]
        candidates.append(candidate)
      }
    }

    var cursor: [String: Any] = ["seenAssetIds": idsAtMaxCreationTime]
    if let maxCreationTime { cursor["lastCreationTime"] = maxCreationTime }

    return [
      "candidates": candidates,
      "cursor": cursor,
      "hasIncrementalChanges": lastCreationTime != nil,
    ]
  }

  func analyzeImage(imageUri: String) throws -> [String: Any] {
    guard let url = URL(string: imageUri), url.isFileURL,
          let data = try? Data(contentsOf: url, options: .mappedIfSafe) else {
      throw PhotoQrScannerError.invalidImageUri
    }
    let result = try recognizeContent(in: data)
    return [
      "payloads": result.qrPayloads,
      "ocrLines": result.textLines.map(Self.textLinePayload),
    ]
  }

  private static func textLinePayload(_ line: RecognizedTextLine) -> [String: Any] {
    [
      "text": line.text,
      "confidence": Double(line.confidence),
    ]
  }

  private func fetchAssets(lastCreationTime: Double?) -> [PHAsset] {
    let options = PHFetchOptions()
    options.fetchLimit = batchSize

    if let lastCreationTime {
      let date = Date(timeIntervalSince1970: lastCreationTime / 1_000)
      options.predicate = NSPredicate(format: "creationDate >= %@", date as NSDate)
      options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
    } else {
      options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    }

    let result = PHAsset.fetchAssets(with: .image, options: options)
    var assets: [PHAsset] = []
    result.enumerateObjects { asset, _, _ in assets.append(asset) }
    return assets
  }

  private func loadData(for asset: PHAsset) async throws -> AssetData {
    try await withCheckedThrowingContinuation { continuation in
      let options = PHImageRequestOptions()
      options.isNetworkAccessAllowed = true
      options.deliveryMode = .highQualityFormat
      options.version = .current

      imageManager.requestImageDataAndOrientation(for: asset, options: options) {
        data, typeIdentifier, _, info in
        if let error = info?[PHImageErrorKey] as? Error {
          continuation.resume(throwing: error)
        } else if let data {
          continuation.resume(returning: AssetData(data: data, typeIdentifier: typeIdentifier))
        } else {
          continuation.resume(throwing: PhotoQrScannerError.assetUnavailable)
        }
      }
    }
  }

  private func recognizeContent(in data: Data) throws -> VisionScanResult {
    let barcodeRequest = VNDetectBarcodesRequest()
    barcodeRequest.symbologies = [.qr]

    let textRequest = VNRecognizeTextRequest()
    textRequest.recognitionLevel = .accurate
    textRequest.usesLanguageCorrection = true
    textRequest.recognitionLanguages = ["zh-Hans", "en-US"]

    let handler = VNImageRequestHandler(data: data, options: [:])
    try handler.perform([barcodeRequest, textRequest])

    let payloads = barcodeRequest.results?.compactMap(\.payloadStringValue) ?? []
    let textLines = (textRequest.results ?? [])
      .compactMap { observation -> RecognizedTextLine? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return RecognizedTextLine(
          text: String(text.prefix(500)),
          confidence: candidate.confidence,
          boundingBox: observation.boundingBox
        )
      }
      .prefix(200)
      .sorted { lhs, rhs in
        let verticalDistance = abs(lhs.boundingBox.maxY - rhs.boundingBox.maxY)
        if verticalDistance > 0.02 {
          return lhs.boundingBox.maxY > rhs.boundingBox.maxY
        }
        return lhs.boundingBox.minX < rhs.boundingBox.minX
      }

    return VisionScanResult(
      qrPayloads: Array(Set(payloads)).sorted(),
      textLines: Array(textLines)
    )
  }

  private func exportToCache(_ assetData: AssetData) throws -> URL {
    let cacheRoot = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("PhotoQrScanner", isDirectory: true)
    try FileManager.default.createDirectory(at: cacheRoot, withIntermediateDirectories: true)

    let fileExtension = assetData.typeIdentifier
      .flatMap(UTType.init)
      .flatMap(\.preferredFilenameExtension) ?? "jpg"
    let destination = cacheRoot
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension(fileExtension)
    try assetData.data.write(to: destination, options: .atomic)
    return destination
  }
}
