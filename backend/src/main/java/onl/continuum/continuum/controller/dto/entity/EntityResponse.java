package onl.continuum.continuum.controller.dto.entity;

import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.entity.EntityType;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collections;
import java.util.List;

public record EntityResponse(
    String id,
    String userId,
    String vaultId,
    String title,
    EntityType type,
    String description,
    boolean favorite,
    Instant createdAt,
    List<LocalDate> trackingDates
) {
    public static EntityResponse from(Entity entity) {
        return from(entity, Integer.MAX_VALUE);
    }

    /**
     * Plan-aware projection: enforces historical retention on tracking dates.
     * Dates outside the retention window are NEVER returned to the client.
     */
    public static EntityResponse from(Entity entity, int historyDays) {
        List<LocalDate> dates = entity.getTrackingDates() != null
            ? entity.getTrackingDates()
            : Collections.emptyList();

        if (historyDays > 0 && historyDays != Integer.MAX_VALUE && !dates.isEmpty()) {
            LocalDate cutoff = onl.continuum.continuum.infra.web.RequestZone.today().minusDays(historyDays);
            dates = dates.stream()
                .filter(d -> d != null && !d.isBefore(cutoff))
                .toList();
        }

        return new EntityResponse(
            entity.getId(),
            entity.getUserId(),
            entity.getVaultId(),
            entity.getTitle(),
            entity.getType(),
            entity.getDescription(),
            entity.isFavorite(),
            entity.getCreatedAt(),
            dates
        );
    }
}
