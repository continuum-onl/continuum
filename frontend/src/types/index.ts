// Types matching Java backend POJOs exactly

export type Plan = "FREE" | "VISION";
import type { AppTheme } from "@/lib/app-theme";
export type { AppTheme } from "@/lib/app-theme";
export type UserLanguage = "en" | "es" | "pt" | "fr";

export interface User {
  id: string;
  email: string;
  username: string;
  plan: Plan;
  emailVerified: boolean;
  createdAt: string;
  theme: AppTheme;
  language?: UserLanguage;
  maxEntities?: number;
  maxNotes?: number;
  historyDays?: number;
  maxVaultSizeMB?: number;
  maxMetadataSizeKb?: number;
  advancedMetrics?: boolean;
  dataExport?: boolean;
  calendarSync?: boolean;
}

export interface PlanLimits {
  maxEntities: number;
  maxNotes: number;
  historyDays: number;
  maxMetadataSizeKb?: number;
  maxVaultSizeMB: number;
  advancedMetrics?: boolean;
  dataExport?: boolean;
  calendarSync?: boolean;
}

export interface Note {
  id: string;
  title: string;
  content: unknown;
  tags: string[];
  folderId?: string;
  entityIds: string[];
  ownerId?: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string;
}

export type EntityType = "PERSON" | "PROJECT" | "TOPIC" | "ORGANIZATION" | "ACTIVITY" | "ACCURRENCY";

export interface Entity {
  id: string;
  title: string;
  type: EntityType;
  description?: string;
  trackingDates?: string[];
  createdAt: string;
  ownerId?: string;
  userId?: string;
  vaultId?: string;
}

export interface HeatmapData {
  [date: string]: number;
}

export interface EntityStats {
  totalCompletions?: number;
  averageValue?: number;
  weeklyCompletionRate?: number;
}


export interface DashboardMetrics {
  totalNotes: number;
  totalEntities: number;
  totalHabits: number;
  notesThisWeek: number;
  completedToday: number;
}


export interface Subscription {
  id: string;
  plan?: Plan;
  effectivePlan?: Plan;
  status: "ACTIVE" | "CANCELLED" | "CANCELED" | "PAST_DUE" | "TRIALING" | "INCOMPLETE" | "UNPAID";
  currentPeriodEnd?: string;
  stripeCustomerId?: string;
  maxEntities?: number;
  maxNotes?: number;
  cancelAtPeriodEnd?: boolean;
  inGracePeriod?: boolean;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  features: string[];
}

export interface VaultFile {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface UserUsage {
  notesCount: number;
  entitiesCount: number;
  activitiesCount: number;
  vaultSizeMB: number;
}

// Dashboard DTOs
export interface DashboardStatsDTO {
  totalNotes: number;
  totalEntities: number;
  totalActivities: number;
  activeActivities: number;
  totalTypes: number;
}

export interface StorageUsageDTO {
  usedBytes: number;
  limitBytes: number;
  percentageUsed: number;
  formattedUsed: string;
  formattedLimit: string;
  isUnlimited: boolean;
}

export interface RecentNoteDTO {
  id: string;
  title: string;
  type: string;
  preview: string;
  createdAtTimestamp: number;
  updatedAtTimestamp: number;
  entityIds: string[];
}

export interface ActivityStatsDTO {
  dailyCompletions: Record<string, number>;
  totalDays: number;
}


export interface DashboardSummaryDTO {
  stats: DashboardStatsDTO;
  storageUsage: StorageUsageDTO;
  recentNotes: RecentNoteDTO[];
  activityStats: ActivityStatsDTO;
}
