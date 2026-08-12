import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { Network } from "@capacitor/network";
import type { MobileBootstrapResponse } from "@genbridge/shared-types";
import { GenbridgeMobileClient, MobileApiError } from "@genbridge/api-client";
import { createSecureSessionStore } from "./secure-session";
import { MutableConnectivity } from "./connectivity";
import { resolveMobileRuntimeConfig } from "./config";

interface AuthState {
  bootstrap: MobileBootstrapResponse | null;
  loading: boolean;
  online: boolean;
  error: string | null;
  client: GenbridgeMobileClient;
  signIn(input: {
    tenantSlug: string;
    email: string;
    password: string;
  }): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const tokenStore = createSecureSessionStore();
const connectivity = new MutableConnectivity(true);
const client = new GenbridgeMobileClient(
  resolveMobileRuntimeConfig().apiBaseUrl,
  tokenStore,
  connectivity,
);
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [bootstrap, setBootstrap] = useState<MobileBootstrapResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setError(null);
    try {
      setBootstrap(await client.bootstrap());
    } catch (reason) {
      if (!(reason instanceof MobileApiError && reason.status === 401))
        setError(
          reason instanceof Error ? reason.message : "Session refresh failed.",
        );
      setBootstrap(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    let remove: (() => Promise<void>) | undefined;
    void Network.addListener("networkStatusChange", (state) => {
      connectivity.update(state.connected);
      setOnline(state.connected);
      if (state.connected) void refresh();
    }).then((handle) => {
      remove = () => handle.remove();
    });
    return () => {
      void remove?.();
    };
  }, [refresh]);
  const value = useMemo<AuthState>(
    () => ({
      bootstrap,
      loading,
      online,
      error,
      client,
      async signIn(input) {
        setLoading(true);
        setError(null);
        try {
          setBootstrap(await client.signIn(input));
        } catch (reason) {
          setError(
            reason instanceof Error ? reason.message : "Sign-in failed.",
          );
          throw reason;
        } finally {
          setLoading(false);
        }
      },
      async signOut() {
        setLoading(true);
        try {
          await client.signOut();
        } finally {
          setBootstrap(null);
          setLoading(false);
        }
      },
      refresh,
    }),
    [bootstrap, loading, online, error, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
