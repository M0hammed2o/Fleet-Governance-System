import { useEffect, useState } from "react";
import { App as NativeApp } from "@capacitor/app";

export const ANDROID_DEEP_LINK_SCHEME = "genbridgefleet:";
export const ANDROID_DEEP_LINK_HOST = "open";

export function routeFromNativeUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== ANDROID_DEEP_LINK_SCHEME ||
      parsed.hostname !== ANDROID_DEEP_LINK_HOST ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.hash
    ) {
      return null;
    }
    const path = parsed.pathname.replace(/^\/+/, "");
    if (!path || path.split("/").some((segment) => segment === ".."))
      return null;
    return `${path}${parsed.search}`;
  } catch {
    return null;
  }
}

export function currentRoute(): string {
  return location.hash.replace(/^#\/?/, "") || "home";
}
export function navigate(route: string, replace = false): void {
  const url = `#/${route.replace(/^\//, "")}`;
  if (replace) history.replaceState(null, "", url);
  else location.hash = url;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
export function useRoute(): string {
  const [route, setRoute] = useState(currentRoute());
  useEffect(() => {
    const update = () => setRoute(currentRoute());
    window.addEventListener("hashchange", update);
    let remove: (() => Promise<void>) | undefined;
    void NativeApp.addListener("appUrlOpen", ({ url }) => {
      const route = routeFromNativeUrl(url);
      if (route) navigate(route);
    }).then((handle) => {
      remove = () => handle.remove();
    });
    return () => {
      window.removeEventListener("hashchange", update);
      void remove?.();
    };
  }, []);
  return route;
}
