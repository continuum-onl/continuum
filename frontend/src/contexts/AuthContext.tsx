import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { authApi } from "@/lib/api";
import { resetAllCaches } from "@/lib/query-client";
import type { Plan, User as AppUser } from "@/types";

// Lê em tempo de execução, não de build
const getAPIBaseURL = () => {
  return (
    import.meta.env.VITE_API_BASE_URL ||
    (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "http://localhost:8080")
  );
};

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (accessToken: string, refreshToken?: string) => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getInitialAuthState(): { user: AppUser | null; loading: boolean } {
  try {
    const storedAccessToken = typeof window !== "undefined"
      ? sessionStorage.getItem("access_token") ?? localStorage.getItem("access_token")
      : null;

    if (!storedAccessToken) {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("access_token");
        localStorage.removeItem("access_token");
        localStorage.removeItem("auth_user");
      }
      return { user: null, loading: false };
    }

    const cached = localStorage.getItem("auth_user");
    const user = cached ? JSON.parse(cached) as AppUser : null;
    // A cached session can render immediately while /me revalidates in the effect.
    return { user, loading: !user };
  } catch {
    return { user: null, loading: false };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialAuth] = useState(getInitialAuthState);
  const [user, setUser] = useState<AppUser | null>(initialAuth.user);
  const [loading, setLoading] = useState(initialAuth.loading);

  const fetchUser = async (opts: { silent?: boolean } = {}) => {
    try {
      const { data } = await authApi.me();
      if (data) {
        // Derive a sensible username fallback from the email if backend didn't return one
        const emailLocal = typeof data.email === "string" ? data.email.split("@")[0] : "";
        const next: AppUser = {
          id: data.id ?? data.userId,
          username: data.username ?? data.name ?? data.displayName ?? emailLocal ?? "",
          email: data.email ?? "",
          plan: data.plan ?? data.effectivePlan ?? "FREE",
          emailVerified: data.emailVerified ?? true,
          createdAt: data.createdAt ?? data.created_at ?? data.memberSince,
          maxEntities: typeof data.maxEntities === "number" ? data.maxEntities : Number(data.maxEntities ?? -1),
          maxNotes: typeof data.maxNotes === "number" ? data.maxNotes : Number(data.maxNotes ?? -1),
          historyDays: typeof data.historyDays === "number" ? data.historyDays : Number(data.historyDays ?? -1),
          maxVaultSizeMB: typeof data.maxVaultSizeMB === "number" ? data.maxVaultSizeMB : Number(data.maxVaultSizeMB ?? -1),
          maxMetadataSizeKb: typeof data.maxMetadataSizeKb === "number" ? data.maxMetadataSizeKb : Number(data.maxMetadataSizeKb ?? -1),
          advancedMetrics: Boolean(data.advancedMetrics),
          dataExport: Boolean(data.dataExport),
          calendarSync: Boolean(data.calendarSync),
        };
        setUser(next);
        try { localStorage.setItem("auth_user", JSON.stringify(next)); } catch {}
      }
    } catch (error: unknown) {
      const status = (error as any)?.response?.status;
      // Only 401 means the session is truly invalid. 403 = business rule (plan limits etc).
      // Network errors / 5xx / 403 must NOT clear the session — keep cached user.
      if (status === 401) {
        sessionStorage.removeItem("access_token");
        sessionStorage.removeItem("refresh_token");
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        localStorage.removeItem("auth_user");
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initializeSession = async () => {
      await fetchUser();
    };

    initializeSession();

    const onLogout = () => {
      sessionStorage.removeItem("access_token");
      sessionStorage.removeItem("refresh_token");
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("auth_user");
      void resetAllCaches();
      setUser(null);
    };
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, []);

  const setTokens = (accessToken: string, _refreshToken?: string) => {
    sessionStorage.setItem("access_token", accessToken);
    localStorage.setItem("access_token", accessToken);

    // Persist refresh token across reloads so the client can renew sessions
    // mesmo quando o backend não usa cookie HttpOnly.
    if (_refreshToken) {
      localStorage.setItem("refresh_token", _refreshToken);
    }
  };

  const login = async (email: string, password: string) => {
    const { data } = await authApi.login(email, password);
    setTokens(data.accessToken ?? data.token, data.refreshToken ?? "");
    await fetchUser();
  };

  const loginWithGoogle = async () => {
    const { data } = await authApi.googleStart();
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: data.authorizationUrl });
    } else {
      window.location.href = data.authorizationUrl;
    }
  };

  const register = async (username: string, email: string, password: string) => {
    const { data } = await authApi.register(username, email, password);
    if (data?.accessToken || data?.token) {
      // Registration always creates a new account -> show onboarding popup
      localStorage.setItem('newAccountCreated', 'true');
      setTokens(data.accessToken ?? data.token, data.refreshToken ?? "");
      await fetchUser();
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("refresh_token");
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("auth_user");
    setUser(null);
    void resetAllCaches().catch((error: unknown) => {
      console.error("Failed to clear cached data during logout", error);
    });
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, register, logout, setTokens, refreshUser: fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
