import { Redirect } from "expo-router";

import { Loading } from "@/components/ui";
import { useApp } from "@/context/app-context";

export default function IndexScreen() {
  const { hydrated, session } = useApp();
  if (!hydrated) return <Loading label="正在读取安全会话…" />;
  return <Redirect href={session ? "/discover" : "/onboarding"} />;
}
