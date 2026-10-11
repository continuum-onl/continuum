import { describe, expect, it } from "vitest";
import { getUsageWarnings, notificationContent, NOTIFICATION_DURATION, shouldDisplayNotification, usageWarningContent } from "@/lib/notifications";

describe("shared notification content", () => {
  it("preserves a supplied title and description", () => {
    expect(notificationContent("success", "Marked as done", "H")).toEqual({ title: "Marked as done", description: "H" });
  });
  it("gives title-only messages a heading and description", () => {
    document.documentElement.lang = "pt";
    expect(notificationContent("error", "Falha ao salvar")).toEqual({ title: "Algo deu errado", description: "Falha ao salvar" });
    expect(notificationContent("info", "Sem conexão").title).toBe("Notificação");
    document.documentElement.lang = "en";
  });
  it("uses five seconds", () => {
    expect(NOTIFICATION_DURATION).toBe(5000);
  });
  it("only displays errors and explicitly retained notification categories", () => {
    expect(shouldDisplayNotification("success")).toBe(false);
    expect(shouldDisplayNotification("info")).toBe(false);
    expect(shouldDisplayNotification("warning")).toBe(false);
    expect(shouldDisplayNotification("error")).toBe(true);
    expect(shouldDisplayNotification("warning", "limit")).toBe(true);
    expect(shouldDisplayNotification("success", "account-deletion")).toBe(true);
    expect(shouldDisplayNotification("success", "entity-relink")).toBe(true);
    expect(shouldDisplayNotification("info", "entity-relink")).toBe(true);
  });
  it("warns at 80 percent for finite plan limits", () => {
    expect(getUsageWarnings(
      { notesCount: 80, entitiesCount: 79, activitiesCount: 0, vaultSizeMB: 8 },
      { maxNotes: 100, maxEntities: 100, maxVaultSizeMB: 10, historyDays: 30, maxMetadataSizeKb: 10 },
    )).toEqual([
      { metric: "notes", percent: 80 },
      { metric: "vault", percent: 80 },
    ]);
  });
  it("does not warn for unlimited limits and caps displayed usage at 100 percent", () => {
    expect(getUsageWarnings(
      { notesCount: 100, entitiesCount: 120, activitiesCount: 0, vaultSizeMB: 0 },
      { maxNotes: -1, maxEntities: 100, maxVaultSizeMB: 10, historyDays: 30, maxMetadataSizeKb: 10 },
    )).toEqual([{ metric: "entities", percent: 100 }]);
  });
  it("provides the localized warning and action text", () => {
    document.documentElement.lang = "pt";
    expect(usageWarningContent("notes", 80)).toEqual({
      title: "Você está perto do limite do plano",
      description: "Notas está em 80% do limite.",
      action: "Ver planos",
    });
    document.documentElement.lang = "en";
  });
});