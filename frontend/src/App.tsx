import * as React from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useIsRestoring } from "@tanstack/react-query";
import { createIdbPersister, QUERY_CACHE_BUSTER } from "@/lib/offline/query-persister";
import { queryClient } from "@/lib/query-client";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { UsageProvider } from "@/contexts/UsageContext";
import { EntityProvider } from "@/contexts/EntityContext";
import { API_BASE_URL } from "@/lib/api";
import { initSyncManager } from "@/lib/offline/sync";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { SkeletonPage } from "@/components/ui/skeleton";
import { extractAuthTokensFromLocation, sanitizeAuthRedirectUrl } from "@/lib/auth-redirect";
import { EMAIL_AUTH_ENABLED } from "@/lib/dev-mode";
import UpdateDialog from "@/components/updater/UpdateDialog";
import { prefetchPrimaryLists } from "@/lib/prefetch";

import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

// Capacitor 8: configura as barras do sistema somente no APK nativo.
import { Capacitor } from "@capacitor/core";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { useNavigate } from "react-router-dom";

// Auth-critical screens stay eager (they gate the first paint); everything else
// is code-split and streamed in behind a skeleton.
import LoginSuccess from "./pages/LoginSuccess";
import LandingPage from "./pages/LandingPage";

const Login = React.lazy(() => import("./pages/Login"));
const Register = React.lazy(() => import("./pages/Register"));
const ForgotPassword = React.lazy(() => import("./pages/ForgotPassword"));
const GoogleCallback = React.lazy(() => import("./pages/GoogleCallback"));
const Notes = React.lazy(() => import("./pages/Notes"));
const NoteEditor = React.lazy(() => import("./pages/NoteEditor"));
const Entities = React.lazy(() => import("./pages/Entities"));
const EntityDetail = React.lazy(() => import("./pages/EntityDetail"));
const KnowledgeGraph = React.lazy(() => import("./pages/KnowledgeGraph"));
const Vault = React.lazy(() => import("./pages/Vault"));
const VaultDownload = React.lazy(() => import("./pages/VaultDownload"));
const Activities = React.lazy(() => import("./pages/Activities"));
const Projects = React.lazy(() => import("./pages/Projects"));
const Terms = React.lazy(() => import("./pages/Terms"));
const Privacy = React.lazy(() => import("./pages/Privacy"));
const Support = React.lazy(() => import("./pages/Support"));
const About = React.lazy(() => import("./pages/About"));
const Pricing = React.lazy(() => import("./pages/Pricing"));
const Versions = React.lazy(() => import("./pages/Versions"));
const SettingsPage = React.lazy(() => import("./pages/Settings"));
const EditorSettingsPage = React.lazy(() => import("./pages/EditorSettings"));
const NotFound = React.lazy(() => import("./pages/NotFound"));
const Trash = React.lazy(() => import("./pages/Trash"));
const Insights = React.lazy(() => import("./pages/Insights"));

const queryPersister = createIdbPersister();

/** Downloads every screen's code in the background so no route ever waits. */
const PAGE_LOADERS = [
  () => import("./pages/Notes"), () => import("./pages/NoteEditor"), () => import("./pages/Entities"),
  () => import("./pages/EntityDetail"), () => import("./pages/Activities"), () => import("./pages/Projects"),
  () => import("./pages/Insights"), () => import("./pages/Vault"), () => import("./pages/KnowledgeGraph"),
  () => import("./pages/Settings"), () => import("./pages/EditorSettings"), () => import("./pages/About"),
  () => import("./pages/Pricing"), () => import("./pages/Support"), () => import("./pages/Terms"),
  () => import("./pages/Privacy"), () => import("./pages/Versions"), () => import("./pages/VaultDownload"),
  () => import("./pages/Login"), () => import("./pages/Register"), () => import("./pages/NotFound"),
];
if (typeof window !== "undefined") {
  const warm = () => PAGE_LOADERS.reduce((p, load) => p.then(() => load().catch(() => {})), Promise.resolve() as Promise<unknown>);
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  window.addEventListener("load", () => (idle ? idle(warm) : setTimeout(warm, 1500)), { once: true });
}

/** Warms notes/entities/insights as soon as the user is authenticated. */
function PrefetchPrimaryData() {
  const { user } = useAuth();
  const isRestoring = useIsRestoring();
  React.useEffect(() => {
    if (!user || isRestoring) return;

    let cancelled = false;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const run = () => {
      idleHandle = undefined;
      timeoutHandle = undefined;
      if (!cancelled && navigator.onLine) void prefetchPrimaryLists();
    };
    const schedule = () => {
      if (cancelled || idleHandle !== undefined || timeoutHandle !== undefined) return;
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(run, { timeout: 5000 });
      } else {
        timeoutHandle = window.setTimeout(run, 1500);
      }
    };

    schedule();
    window.addEventListener("online", schedule);
    return () => {
      cancelled = true;
      window.removeEventListener("online", schedule);
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
    };
  }, [user, isRestoring]);
  return null;
}

function NativeGoogleAuthRedirect() {
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    let removeListener: (() => void) | undefined;
    void CapacitorApp.addListener("appUrlOpen", async ({ url }) => {
      let callbackUrl: URL;
      try {
        callbackUrl = new URL(url);
      } catch {
        return;
      }

      if (
        callbackUrl.origin !== "https://continuum.onl" ||
        callbackUrl.pathname !== "/google-callback"
      ) {
        return;
      }

      navigate(`/google-callback${callbackUrl.search}`);
      await Browser.close();
    }).then((listener) => {
      if (disposed) {
        void listener.remove();
      } else {
        removeListener = () => { void listener.remove(); };
      }
    });

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, [navigate]);

  return null;
}

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background">
      <SkeletonPage />
    </div>
  );
}

function HomeRoute() {
  const { user, loading } = useAuth();
  // Read tokens once per mount so we don't recompute on every render.
  const [hasIncomingToken, setHasIncomingToken] = React.useState(() => {
    const t = extractAuthTokensFromLocation();
    return !!t?.accessToken;
  });

  React.useEffect(() => {
    if (!hasIncomingToken) sanitizeAuthRedirectUrl();
  }, [hasIncomingToken]);

  if (hasIncomingToken) return <LoginSuccess onDone={() => setHasIncomingToken(false)} />;

  if (loading) return <RouteFallback />;
  if (user) return <Notes />;
  return <LandingPage />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <RouteFallback />;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <RouteFallback />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const AppRoutes = () => {
  return (
    <React.Suspense fallback={<RouteFallback />}>
      <Routes>
    <Route path="/" element={<HomeRoute />} />
    <Route path="/index" element={<HomeRoute />} />
    <Route path="/dashboard" element={<Navigate to="/notes" replace />} />
    <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
    <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
    <Route
      path="/forgot-password"
      element={EMAIL_AUTH_ENABLED ? <PublicRoute><ForgotPassword /></PublicRoute> : <Navigate to="/login" replace />}
    />

    <Route path="/google-callback" element={<GoogleCallback />} />
    <Route path="/login-successful" element={<LoginSuccess />} />
    <Route path="/login-token" element={<LoginSuccess />} />
    <Route path="/terms" element={<Terms />} />
    <Route path="/privacy" element={<Privacy />} />
    <Route path="/support" element={<Support />} />
    <Route path="/about" element={<About />} />
    <Route path="/pricing" element={<Pricing />} />
    <Route path="/versions" element={<Versions />} />
    <Route path="/notes" element={<ProtectedRoute><Notes /></ProtectedRoute>} />
    <Route path="/notes/:id" element={<ProtectedRoute><NoteEditor /></ProtectedRoute>} />
    <Route path="/entities" element={<ProtectedRoute><Entities /></ProtectedRoute>} />
    <Route path="/entities/:id" element={<ProtectedRoute><EntityDetail /></ProtectedRoute>} />
    {/* Activity Routes */}
    <Route path="/tracking" element={<Navigate to="/activities" replace />} />
    <Route path="/activities" element={<ProtectedRoute><Activities /></ProtectedRoute>} />
    <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
    {/* Analytics Routes */}
    <Route path="/tracking/:id" element={<ProtectedRoute><EntityDetail /></ProtectedRoute>} />
    <Route path="/activities/:id" element={<ProtectedRoute><EntityDetail /></ProtectedRoute>} />
    <Route path="/projects/:id" element={<ProtectedRoute><EntityDetail /></ProtectedRoute>} />
    <Route path="/graph" element={<ProtectedRoute><KnowledgeGraph /></ProtectedRoute>} />
    <Route path="/insights" element={<ProtectedRoute><Insights /></ProtectedRoute>} />
    <Route path="/trash" element={<ProtectedRoute><Trash /></ProtectedRoute>} />
    <Route path="/vault" element={<ProtectedRoute><Vault /></ProtectedRoute>} />
    <Route path="/vault/download/:fileId" element={<ProtectedRoute><VaultDownload /></ProtectedRoute>} />
    <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
    <Route path="/editor" element={<ProtectedRoute><EditorSettingsPage /></ProtectedRoute>} />
    <Route path="/profile" element={<Navigate to="/settings" replace />} />
    <Route path="*" element={<NotFound />} />
      </Routes>
    </React.Suspense>
  );
};

const App = () => {
  React.useEffect(() => {
    initSyncManager(API_BASE_URL);
    if (Capacitor.isNativePlatform()) {
      void SystemBars.setStyle({ style: SystemBarsStyle.Dark });
    }
  }, []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 24 * 60 * 60 * 1000,
        buster: QUERY_CACHE_BUSTER,
        dehydrateOptions: {
          // Never persist auth/session-scoped queries.
          shouldDehydrateQuery: (query) =>
            query.state.status === "success" && String(query.queryKey[0]) !== "auth",
        },
      }}
    >
      <ThemeProvider>
        <TooltipProvider>
          <Sonner />
          <BrowserRouter>
            <NativeGoogleAuthRedirect />
            <LanguageProvider>
              <AuthProvider>
                <UsageProvider>
                  <EntityProvider>
                    <PrefetchPrimaryData />
                    <AppRoutes />
                    <UpdateDialog />
                  </EntityProvider>
                </UsageProvider>
              </AuthProvider>
            </LanguageProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
      <Analytics />
      <SpeedInsights />
    </PersistQueryClientProvider>
  );
};

export default App;
