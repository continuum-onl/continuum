import type { ReactNode } from "react";
import { isUnlimited, type CurrentPlanLimits } from "@/lib/plan";
import type { UserUsage } from "@/types";

export type NotificationKind = "success" | "error" | "info" | "warning";
export type NotificationCategory = "limit" | "account-deletion" | "entity-relink";
export type UsageMetric = "notes" | "entities" | "vault";
export const NOTIFICATION_DURATION = 5000;

const headings = {
  en: { success: "Completed", error: "Something went wrong", info: "Notification", warning: "Attention" },
  pt: { success: "Concluído", error: "Algo deu errado", info: "Notificação", warning: "Atenção" },
  es: { success: "Completado", error: "Algo salió mal", info: "Notificación", warning: "Atención" },
  fr: { success: "Terminé", error: "Une erreur est survenue", info: "Notification", warning: "Attention" },
};

const usageWarnings = {
  en: { title: "Plan limit approaching", description: "{x} is at {p}% of your limit.", action: "See plans", labels: { notes: "Notes", entities: "Entities", vault: "Vault" } },
  pt: { title: "Você está perto do limite do plano", description: "{x} está em {p}% do limite.", action: "Ver planos", labels: { notes: "Notas", entities: "Entidades", vault: "Cofre" } },
  es: { title: "Estás cerca del límite de tu plan", description: "{x} está al {p}% del límite.", action: "Ver planes", labels: { notes: "Notas", entities: "Entidades", vault: "Cofre" } },
  fr: { title: "Vous approchez de la limite", description: "{x} est à {p}% de la limite.", action: "Voir les forfaits", labels: { notes: "Notes", entities: "Entités", vault: "Coffre" } },
};

const language = () => (typeof document === "undefined" ? "en" : document.documentElement.lang.split("-")[0]);

export function notificationContent(kind: NotificationKind, title?: ReactNode, description?: ReactNode) {
  const labels = headings[language() as keyof typeof headings] ?? headings.en;
  return description
    ? { title: title || labels[kind], description }
    : { title: labels[kind], description: title || labels[kind] };
}

export function shouldDisplayNotification(kind: NotificationKind, category?: NotificationCategory) {
  return kind === "error" || category === "limit" || category === "account-deletion" || category === "entity-relink";
}

export function usageWarningContent(metric: UsageMetric, percent: number) {
  const template = usageWarnings[language() as keyof typeof usageWarnings] ?? usageWarnings.en;
  return {
    title: template.title,
    description: template.description.replace("{x}", template.labels[metric]).replace("{p}", String(percent)),
    action: template.action,
  };
}

export function getUsageWarnings(usage: UserUsage, limits: CurrentPlanLimits) {
  const metrics = [
    { metric: "notes" as const, used: usage.notesCount, limit: limits.maxNotes },
    { metric: "entities" as const, used: usage.entitiesCount, limit: limits.maxEntities },
    { metric: "vault" as const, used: usage.vaultSizeMB, limit: limits.maxVaultSizeMB },
  ];

  return metrics.flatMap(({ metric, used, limit }) => {
    if (isUnlimited(limit) || limit <= 0) return [];
    const percent = Math.round((used / limit) * 100);
    return percent >= 80 ? [{ metric, percent: Math.min(100, percent) }] : [];
  });
}

/** Metrics the user was already warned about; persisted so the warning shows once,
 *  not on every app open. A metric is forgotten when usage drops back below 80%. */
const warnedKey = (userId: string) => `continuum:usage-warned:${userId}`;

export function loadWarnedMetrics(userId: string): UsageMetric[] {
  try {
    const raw = JSON.parse(localStorage.getItem(warnedKey(userId)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((m): m is UsageMetric => m === "notes" || m === "entities" || m === "vault") : [];
  } catch {
    return [];
  }
}

export function saveWarnedMetrics(userId: string, metrics: UsageMetric[]) {
  try {
    localStorage.setItem(warnedKey(userId), JSON.stringify(metrics));
  } catch { /* ignore */ }
}
