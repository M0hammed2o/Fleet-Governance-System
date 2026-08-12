import { useEffect, useState } from "react";
import { App as NativeApp } from "@capacitor/app";

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
      const parsed = new URL(url);
      navigate(parsed.pathname);
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
