import ExpoModulesCore
import ImageIO
import Photos
import UIKit
import Vision

public final class PhotoQrScannerModule: Module {
  private let imageManager = PHImageManager.default()
  private let jobs = ScanJobRegistry()

  public func definition() -> ModuleDefinition {
    Name("PhotoQrScanner")
    Events("onScanProgress")

    AsyncFunction("requestPermission") { () async -> [String: Any] in
      let status = await withCheckedContinuation { continuation in
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { authorizationStatus in
          continuation.resume(returning: authorizationStatus)
        }
      }
      return Self.permissionPayload(status)
    }

    AsyncFunction("scanSince") {
      (
        jobId: String,
        lastCreationTime: Double?,
        seenAssetIds: [String],
        requestedLimit: Int
      ) async throws -> [String: Any] in
      let authorization = PHPhotoLibrary.authorizationStatus(for: .readWrite)
      guard authorization == .authorized || authorization == .limited else {
        throw PhotoQrScannerError.permissionDenied
      }

      self.jobs.begin(jobId)
      defer { self.jobs.finish(jobId) }
      let worker = PhotoQrScanWorker(imageManager: self.imageManager, jobs: self.jobs)
      return try await worker.scan(
        jobId: jobId,
        lastCreationTime: lastCreationTime,
        seenAssetIds: seenAssetIds,
        limit: max(1, min(requestedLimit, 100)),
        onProgress: { [weak self] progress in
          self?.sendEvent("onScanProgress", progress)
        }
      )
    }

    AsyncFunction("analyzeImage") {
      (jobId: String, imageUri: String) async throws -> [String: Any] in
      self.jobs.begin(jobId)
      defer { self.jobs.finish(jobId) }
      let worker = PhotoQrScanWorker(imageManager: self.imageManager, jobs: self.jobs)
      return try worker.analyzeImage(
        jobId: jobId,
        imageUri: imageUri,
        onProgress: { [weak self] progress in
          self?.sendEvent("onScanProgress", progress)
        }
      )
    }

    Function("cancelScan") { (jobId: String) in
      let requests = self.jobs.cancel(jobId)
      requests.imageRequestIds.forEach { self.imageManager.cancelImageRequest($0) }
      requests.visionRequests.forEach { $0.cancel() }
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
  case cancelled

  var errorDescription: String? {
    switch self {
    case .permissionDenied:
      return "ERR_PHOTO_PERMISSION_DENIED: Photo library permission is required"
    case .assetUnavailable:
      return "ERR_ASSET_UNAVAILABLE: Photo data could not be loaded"
    case .invalidImageUri:
      return "ERR_INVALID_IMAGE_URI: A readable local image URI is required"
    case .cancelled:
      return "ERR_SCAN_CANCELLED: Scan cancelled"
    }
  }
}

private struct RecognizedTextLine {
  let text: String
  let confidence: Float
  let boundingBox: CGRect
}

private struct ScanJobState {
  var cancelled = false
  var requestIds = Set<PHImageRequestID>()
  var visionRequests: [ObjectIdentifier: VNRequest] = [:]
}

private struct CancelledRequests {
  let imageRequestIds: [PHImageRequestID]
  let visionRequests: [VNRequest]
}

private final class ScanJobRegistry: @unchecked Sendable {
  private let lock = NSLock()
  private var states: [String: ScanJobState] = [:]

  func begin(_ jobId: String) {
    lock.lock()
    states[jobId] = ScanJobState()
    lock.unlock()
  }

  func finish(_ jobId: String) {
    lock.lock()
    states.removeValue(forKey: jobId)
    lock.unlock()
  }

  func check(_ jobId: String) throws {
    lock.lock()
    let cancelled = states[jobId]?.cancelled ?? true
    lock.unlock()
    if cancelled { throw PhotoQrScannerError.cancelled }
  }

  func isCancelled(_ jobId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return states[jobId]?.cancelled ?? true
  }

  func register(_ requestId: PHImageRequestID, for jobId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard var state = states[jobId], !state.cancelled else { return false }
    state.requestIds.insert(requestId)
    states[jobId] = state
    return true
  }

  func unregister(_ requestId: PHImageRequestID, for jobId: String) {
    lock.lock()
    if var state = states[jobId] {
      state.requestIds.remove(requestId)
      states[jobId] = state
    }
    lock.unlock()
  }

  func register(_ request: VNRequest, for jobId: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard var state = states[jobId], !state.cancelled else { return false }
    state.visionRequests[ObjectIdentifier(request)] = request
    states[jobId] = state
    return true
  }

  func unregister(_ request: VNRequest, for jobId: String) {
    lock.lock()
    if var state = states[jobId] {
      state.visionRequests.removeValue(forKey: ObjectIdentifier(request))
      states[jobId] = state
    }
    lock.unlock()
  }

  func cancel(_ jobId: String) -> CancelledRequests {
    lock.lock()
    defer { lock.unlock() }
    guard var state = states[jobId] else {
      return CancelledRequests(imageRequestIds: [], visionRequests: [])
    }
    state.cancelled = true
    states[jobId] = state
    return CancelledRequests(
      imageRequestIds: Array(state.requestIds),
      visionRequests: Array(state.visionRequests.values)
    )
  }
}

private final class ImageRequestGate: @unchecked Sendable {
  private let lock = NSLock()
  private var completed = false
  private var storedRequestId = PHInvalidImageRequestID

  func setRequestId(_ requestId: PHImageRequestID) {
    lock.lock()
    storedRequestId = requestId
    lock.unlock()
  }

  func requestId() -> PHImageRequestID {
    lock.lock()
    defer { lock.unlock() }
    return storedRequestId
  }

  func runOnce(_ body: () -> Void) {
    lock.lock()
    guard !completed else {
      lock.unlock()
      return
    }
    completed = true
    lock.unlock()
    body()
  }
}

private extension UIImage.Orientation {
  var cgImageOrientation: CGImagePropertyOrientation {
    switch self {
    case .up: return .up
    case .upMirrored: return .upMirrored
    case .down: return .down
    case .downMirrored: return .downMirrored
    case .left: return .left
    case .leftMirrored: return .leftMirrored
    case .right: return .right
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}

private final class PhotoQrScanWorker {
  private let imageManager: PHImageManager
  private let jobs: ScanJobRegistry

  init(imageManager: PHImageManager, jobs: ScanJobRegistry) {
    self.imageManager = imageManager
    self.jobs = jobs
  }

  func scan(
    jobId: String,
    lastCreationTime: Double?,
    seenAssetIds: [String],
    limit: Int,
    onProgress: ([String: Any]) -> Void
  ) async throws -> [String: Any] {
    // PhotoKit's creationDate is the image's authored/captured date, not a reliable
    // "added to this library" date. Images saved from community apps can therefore
    // arrive with an old creationDate and were permanently missed by the old
    // timestamp predicate. Observe bounded recent windows from both creationDate and
    // modificationDate, then use asset identifiers as the incremental source of truth.
    let observedAssets = fetchRecentAssets(windowSize: 40)
    let previouslySeen = Set(seenAssetIds)
    let isIncremental = lastCreationTime != nil || !seenAssetIds.isEmpty
    let assets = Array(
      (isIncremental
        ? observedAssets.filter { !previouslySeen.contains($0.localIdentifier) }
        : observedAssets
      ).prefix(limit)
    )
    var candidates: [[String: Any]] = []

    for (index, asset) in assets.enumerated() {
      try jobs.check(jobId)
      let creationTime = asset.creationDate.map {
        ($0.timeIntervalSince1970 * 1_000).rounded(.towardZero)
      }

      do {
        // Never accept PhotoKit's degraded callback here. It can be much smaller than
        // the requested target and makes the automatic path miss QR codes that the
        // full-resolution image picker recognizes correctly.
        let preview = try await loadImage(
          asset,
          jobId: jobId,
          maxDimension: 1_600,
          deliveryMode: .highQualityFormat,
          resizeMode: .fast,
          acceptDegraded: false
        )
        let payloads = try recognizeQr(in: preview, jobId: jobId)
        guard !payloads.isEmpty else {
          onProgress(Self.progress(jobId, "detecting", index + 1, assets.count))
          continue
        }

        try jobs.check(jobId)
        onProgress(Self.progress(jobId, "recognizing", index, assets.count))
        let detailedImage = try await loadImage(
          asset,
          jobId: jobId,
          maxDimension: 2_400,
          deliveryMode: .highQualityFormat,
          resizeMode: .exact,
          acceptDegraded: false
        )
        let textLines = try recognizeText(in: detailedImage, jobId: jobId)
        try jobs.check(jobId)
        let imageUri = try exportToCache(detailedImage)

        for payload in payloads {
          candidates.append([
            "assetId": asset.localIdentifier,
            "creationTime": creationTime ?? NSNull(),
            "payload": payload,
            "imageUri": imageUri.absoluteString,
            "ocrLines": textLines.map(Self.textLinePayload),
          ])
        }
      } catch PhotoQrScannerError.cancelled {
        throw PhotoQrScannerError.cancelled
      } catch {
        // One unavailable or corrupted photo must not stop the remaining incremental batch.
      }

      onProgress(Self.progress(jobId, "detecting", index + 1, assets.count))
    }

    try jobs.check(jobId)
    let observationIds = observedAssets.map(\.localIdentifier)
    let maxObservedTime = observedAssets.compactMap(Self.activityTime).max()
    var cursor: [String: Any] = ["seenAssetIds": observationIds]
    if let maxObservedTime { cursor["lastCreationTime"] = maxObservedTime }

    return [
      "candidates": candidates,
      "cursor": cursor,
      "hasIncrementalChanges": isIncremental && !assets.isEmpty,
      "observedAssetCount": observedAssets.count,
      "scannedAssetCount": assets.count,
    ]
  }

  func analyzeImage(
    jobId: String,
    imageUri: String,
    onProgress: ([String: Any]) -> Void
  ) throws -> [String: Any] {
    try jobs.check(jobId)
    guard let url = URL(string: imageUri), url.isFileURL,
          let image = UIImage(contentsOfFile: url.path) else {
      throw PhotoQrScannerError.invalidImageUri
    }

    let payloads = try recognizeQr(in: image, jobId: jobId)
    onProgress(Self.progress(jobId, "detecting", 1, 1))
    guard !payloads.isEmpty else {
      return ["payloads": [], "ocrLines": []]
    }

    try jobs.check(jobId)
    onProgress(Self.progress(jobId, "recognizing", 0, 1))
    let textLines = try recognizeText(in: image, jobId: jobId)
    try jobs.check(jobId)
    onProgress(Self.progress(jobId, "recognizing", 1, 1))
    return [
      "payloads": payloads,
      "ocrLines": textLines.map(Self.textLinePayload),
    ]
  }

  private static func progress(
    _ jobId: String,
    _ stage: String,
    _ processed: Int,
    _ total: Int
  ) -> [String: Any] {
    ["jobId": jobId, "stage": stage, "processed": processed, "total": total]
  }

  private static func textLinePayload(_ line: RecognizedTextLine) -> [String: Any] {
    ["text": line.text, "confidence": Double(line.confidence)]
  }

  private static func activityTime(_ asset: PHAsset) -> Double? {
    let date = [asset.creationDate, asset.modificationDate]
      .compactMap { $0 }
      .max()
    return date.map { ($0.timeIntervalSince1970 * 1_000).rounded(.towardZero) }
  }

  private func fetchRecentAssets(windowSize: Int) -> [PHAsset] {
    var assets: [PHAsset] = []
    var identifiers = Set<String>()
    func append(_ asset: PHAsset) {
      if identifiers.insert(asset.localIdentifier).inserted { assets.append(asset) }
    }

    // The Recently Added smart album is the only public PhotoKit surface whose
    // collection order reflects library insertion rather than image metadata. Its
    // edge direction is not documented, so sample both ends in an interleaved order.
    let collections = PHAssetCollection.fetchAssetCollections(
      with: .smartAlbum,
      subtype: .smartAlbumRecentlyAdded,
      options: nil
    )
    if let recentlyAdded = collections.firstObject {
      let options = PHFetchOptions()
      options.predicate = NSPredicate(
        format: "mediaType == %d",
        PHAssetMediaType.image.rawValue
      )
      let result = PHAsset.fetchAssets(in: recentlyAdded, options: options)
      let edgeCount = min(windowSize, result.count)
      for offset in 0..<edgeCount {
        append(result.object(at: result.count - offset - 1))
        append(result.object(at: offset))
      }
    }

    for sortKey in ["creationDate", "modificationDate"] {
      let options = PHFetchOptions()
      options.fetchLimit = windowSize
      options.sortDescriptors = [NSSortDescriptor(key: sortKey, ascending: false)]
      let result = PHAsset.fetchAssets(with: .image, options: options)
      result.enumerateObjects { asset, _, _ in
        append(asset)
      }
    }

    return assets
  }

  private func loadImage(
    _ asset: PHAsset,
    jobId: String,
    maxDimension: CGFloat,
    deliveryMode: PHImageRequestOptionsDeliveryMode,
    resizeMode: PHImageRequestOptionsResizeMode,
    acceptDegraded: Bool
  ) async throws -> UIImage {
    try jobs.check(jobId)
    return try await withCheckedThrowingContinuation { continuation in
      let options = PHImageRequestOptions()
      options.isNetworkAccessAllowed = true
      options.deliveryMode = deliveryMode
      options.resizeMode = resizeMode
      options.version = .current
      let gate = ImageRequestGate()
      let target = CGSize(width: maxDimension, height: maxDimension)

      let requestId = imageManager.requestImage(
        for: asset,
        targetSize: target,
        contentMode: .aspectFit,
        options: options
      ) { image, info in
        let degraded = info?[PHImageResultIsDegradedKey] as? Bool ?? false
        if degraded && !acceptDegraded { return }
        let currentRequestId = gate.requestId()
        if currentRequestId != PHInvalidImageRequestID {
          self.jobs.unregister(currentRequestId, for: jobId)
        }
        gate.runOnce {
          if self.jobs.isCancelled(jobId)
             || info?[PHImageCancelledKey] as? Bool == true {
            continuation.resume(throwing: PhotoQrScannerError.cancelled)
          } else if let error = info?[PHImageErrorKey] as? Error {
            continuation.resume(throwing: error)
          } else if let image {
            continuation.resume(returning: image)
          } else {
            continuation.resume(throwing: PhotoQrScannerError.assetUnavailable)
          }
        }
      }
      gate.setRequestId(requestId)
      guard jobs.register(requestId, for: jobId) else {
        imageManager.cancelImageRequest(requestId)
        gate.runOnce { continuation.resume(throwing: PhotoQrScannerError.cancelled) }
        return
      }
    }
  }

  private func imageHandler(_ image: UIImage) throws -> VNImageRequestHandler {
    guard let cgImage = image.cgImage else { throw PhotoQrScannerError.assetUnavailable }
    return VNImageRequestHandler(
      cgImage: cgImage,
      orientation: image.imageOrientation.cgImageOrientation,
      options: [:]
    )
  }

  private func recognizeQr(in image: UIImage, jobId: String) throws -> [String] {
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    guard jobs.register(request, for: jobId) else { throw PhotoQrScannerError.cancelled }
    defer { jobs.unregister(request, for: jobId) }
    try imageHandler(image).perform([request])
    try jobs.check(jobId)
    return Array(Set(request.results?.compactMap(\.payloadStringValue) ?? [])).sorted()
  }

  private func recognizeText(in image: UIImage, jobId: String) throws -> [RecognizedTextLine] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    guard jobs.register(request, for: jobId) else { throw PhotoQrScannerError.cancelled }
    defer { jobs.unregister(request, for: jobId) }
    try imageHandler(image).perform([request])
    try jobs.check(jobId)

    return Array((request.results ?? [])
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
      .prefix(200))
      .sorted { lhs, rhs in
        let verticalDistance = abs(lhs.boundingBox.maxY - rhs.boundingBox.maxY)
        if verticalDistance > 0.02 { return lhs.boundingBox.maxY > rhs.boundingBox.maxY }
        return lhs.boundingBox.minX < rhs.boundingBox.minX
      }
  }

  private func exportToCache(_ image: UIImage) throws -> URL {
    guard let data = image.jpegData(compressionQuality: 0.92) else {
      throw PhotoQrScannerError.assetUnavailable
    }
    let cacheRoot = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("PhotoQrScanner", isDirectory: true)
    try FileManager.default.createDirectory(at: cacheRoot, withIntermediateDirectories: true)
    let destination = cacheRoot
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("jpg")
    try data.write(to: destination, options: .atomic)
    return destination
  }
}
