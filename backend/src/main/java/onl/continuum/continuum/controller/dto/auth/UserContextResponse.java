package onl.continuum.continuum.controller.dto.auth;

import onl.continuum.continuum.domain.plan.PlanLimits;
import onl.continuum.continuum.domain.plan.PlanType;
import onl.continuum.continuum.domain.subscription.Subscription;
import onl.continuum.continuum.domain.subscription.SubscriptionStatus;
import onl.continuum.continuum.domain.user.User;

import java.time.Instant;

public record UserContextResponse(
    String id, String username, String email, String role, Boolean active,
    String vaultId, String avatarUrl,
    PlanType plan, SubscriptionStatus subscriptionStatus,
    int maxEntities, int maxNotes, int historyDays, int maxVaultSizeMB, int maxMetadataSizeKb,
    boolean advancedMetrics, boolean dataExport, boolean calendarSync,
    Instant subscriptionEndsAt, Boolean cancelAtPeriodEnd,
    Instant createdAt, String theme, String language
) {
    public static UserContextResponse from(User user, Subscription sub, PlanLimits limits) {
        SubscriptionStatus status = sub != null ? sub.getStatus() : SubscriptionStatus.ACTIVE;
        return new UserContextResponse(
            user.getId(), user.getUsername(), user.getEmail(), user.getRole(), user.getActive(),
            user.getVaultId(), user.getAvatarUrl(),
            user.getPlan(), status,
            limits.maxEntities(), limits.maxNotes(), limits.maxHistoryDays(), limits.maxVaultSizeMB(), limits.maxMetadataSizeKb(),
            limits.advancedMetrics(), limits.dataExport(), limits.calendarSync(),
            sub != null ? sub.getCurrentPeriodEnd() : null,
            sub != null ? sub.getCancelAtPeriodEnd() : false,
            user.getCreatedAt(), user.getTheme(), user.getLanguage());
    }
}

// ─────────────────────────────────────────────────────────────────────────────
