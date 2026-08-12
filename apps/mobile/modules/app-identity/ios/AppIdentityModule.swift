import ExpoModulesCore
import StoreKit

public final class AppIdentityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppIdentity")

    AsyncFunction("getAppTransactionJws") { () async throws -> String in
      let result = try await AppTransaction.shared
      switch result {
      case .verified:
        return result.jwsRepresentation
      case .unverified(_, let error):
        throw AppIdentityError.unverified(error.localizedDescription)
      }
    }
  }
}

private enum AppIdentityError: LocalizedError {
  case unverified(String)

  var errorDescription: String? {
    switch self {
    case .unverified(let reason):
      return "ERR_APP_IDENTITY_UNVERIFIED: \(reason)"
    }
  }
}
