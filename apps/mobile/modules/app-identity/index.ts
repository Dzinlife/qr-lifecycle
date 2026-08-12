import { NativeModule, requireOptionalNativeModule } from "expo";

declare class AppIdentityNativeModule extends NativeModule {
  getAppTransactionJws(): Promise<string | null>;
}

export const AppIdentityNative =
  requireOptionalNativeModule<AppIdentityNativeModule>("AppIdentity");
