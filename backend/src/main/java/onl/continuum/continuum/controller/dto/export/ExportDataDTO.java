package onl.continuum.continuum.controller.dto.export;

import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.note.Note;
import java.time.Instant;
import java.util.List;

public record ExportDataDTO(
    String exportedAt,
    String userId,
    List<NoteExportDTO> notes,
    List<EntityExportDTO> entities,
    List<String> noteTypes
) {
    public static ExportDataDTO from(String userId, List<Note> notes, List<Entity> entities, List<String> noteTypes) {
        List<NoteExportDTO> noteList = notes.stream()
            .map(n -> new NoteExportDTO(n.getId(), n.getTitle(), n.getContent(), n.getEntityIds(), n.getCreatedAt(), n.getUpdatedAt()))
            .toList();
        
        List<EntityExportDTO> entityList = entities.stream()
            .map(e -> new EntityExportDTO(e.getId(), e.getTitle(), e.getDescription(), e.getType().name(), e.getTrackingDates(), e.getCreatedAt()))
            .toList();
        
        return new ExportDataDTO(Instant.now().toString(), userId, noteList, entityList, noteTypes);
    }

    public record NoteExportDTO(
        String id,
        String title,
        String content,
        List<String> entityIds,
        Instant createdAt,
        Instant updatedAt
    ) {}

    public record EntityExportDTO(
        String id,
        String title,
        String description,
        String type,
        List<java.time.LocalDate> trackingDates,
        Instant createdAt
    ) {}
}
