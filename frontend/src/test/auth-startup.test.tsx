import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { authApi } from "@/lib/api";

function AuthStatus() {
  const { user, loading } = useAuth();
  return <div>{loading ? "Checking session" : user?.username ?? "Signed out"}</div>;
}

describe("authentication startup", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the cached user without waiting for the session request", () => {
    const cachedUser = {
      id: "user-1",
      username: "Local user",
      email: "local@example.com",
      plan: "FREE",
    };
    localStorage.setItem("access_token", "cached-token");
    localStorage.setItem("auth_user", JSON.stringify(cachedUser));
    vi.spyOn(authApi, "me").mockReturnValue(new Promise<never>(() => {}));

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>,
    );

    expect(screen.getByText("Local user")).toBeInTheDocument();
    expect(authApi.me).toHaveBeenCalledOnce();
  });
});
