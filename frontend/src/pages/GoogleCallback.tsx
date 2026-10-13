import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";

function isNativeState(state: string) {
  try {
    const part = state.split(".")[1];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return json?.platform === "native";
  } catch {
    return false;
  }
}
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { authApi } from "@/lib/api";
import { extractAuthTokensFromLocation, sanitizeAuthRedirectUrl } from "@/lib/auth-redirect";
import { Loader2 } from "@/lib/heroicons";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";

export default function GoogleCallback() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { setTokens, refreshUser } = useAuth();
  const { toast } = useToast();
  const hasCalled = useRef(false);
  const [appLink, setAppLink] = useState<string | null>(null);

  useEffect(() => {
    const authTokens = extractAuthTokensFromLocation();
    sanitizeAuthRedirectUrl();

    const accessToken = authTokens?.accessToken;
    const refreshToken = authTokens?.refreshToken;
    const searchParams = new URLSearchParams(window.location.search);

    const code = searchParams.get("code");
    const state = searchParams.get("state");

    // Se já existem tokens na URL (redirecionamento direto)
    if (accessToken) {
      if (hasCalled.current) return;
      hasCalled.current = true;
      
      setTokens(accessToken, refreshToken || "");
      refreshUser()
        .then(() => navigate("/"))
        .catch(() => navigate("/"));
      return;
    }

    // Flow started in the Android app: hand the code back to the app instead of
    // signing in on the browser that Google redirected to.
    if (code && state && !Capacitor.isNativePlatform() && isNativeState(state)) {
      if (hasCalled.current) return;
      hasCalled.current = true;
      const deepLink = `continuum://google-callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      setAppLink(deepLink);
      window.location.href = deepLink;
      return;
    }

    // Se recebemos um código para trocar no backend
    if (code) {
      if (!state) {
        console.error("Google Auth callback missing state parameter", { code, state });
        toast({
          title: t("au_authentication_error"),
          description: t("au_missing_state_data"),
          variant: "destructive",
        });
        navigate("/");
        return;
      }

      if (hasCalled.current) return;
      hasCalled.current = true;

      authApi
        .googleCallback({
          code,
          state,
          redirectUri: window.location.origin + window.location.pathname,
        })
        .then(async ({ data }) => {
          setTokens(data.accessToken, data.refreshToken);
          // Only mark as new account when the backend says the user was just created
          if (data.isNewUser) {
            localStorage.setItem('newAccountCreated', 'true');
          }
          await refreshUser();
          navigate("/");
        })
        .catch((err) => {
          console.error("Google Auth Error:", err);
          toast({
            title: t("au_authentication_error"),
            description: err.response?.data?.message || t("au_google_signin_error"),
            variant: "destructive",
          });
          navigate("/");
        });
    } else {
      navigate("/");
    }
  }, [navigate, refreshUser, setTokens, toast]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
        <p className="text-sm text-muted-foreground">{t("au_finishing_google_signin")}</p>
        {appLink && (
          <a href={appLink} className="inline-block text-sm text-foreground underline">
            Continuum
          </a>
        )}
      </div>
    </div>
  );
}
