package onl.continuum.continuum.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import onl.continuum.continuum.controller.dto.export.ExportDataDTO;
import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.persistence.EntityRepository;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.persistence.NoteTypeRepository;
import onl.continuum.continuum.infra.vault.VaultStorageService;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
public class ExportService {

    private final NoteRepository noteRepo;
    private final EntityRepository entityRepo;
    private final ObjectMapper objectMapper;
    private final UserRepository userRepo;
    private final VaultStorageService vaultStorageService;
    private final NoteTypeRepository noteTypeRepository;

    public ExportService(NoteRepository noteRepo, EntityRepository entityRepo, ObjectMapper objectMapper,
                         UserRepository userRepo, VaultStorageService vaultStorageService,
                         NoteTypeRepository noteTypeRepository) {
        this.noteRepo = noteRepo;
        this.entityRepo = entityRepo;
        this.objectMapper = objectMapper;
        this.userRepo = userRepo;
        this.vaultStorageService = vaultStorageService;
        this.noteTypeRepository = noteTypeRepository;
    }

    public ExportDataDTO exportUserData(String userId) {
        // Buscar todas as notas e entidades do usuário
        List<Note> notes = noteRepo.findByUserId(userId);
        List<Entity> entities = entityRepo.findByUserId(userId);

        // Criar o DTO de exportação
        List<String> noteTypes = noteTypeRepository.findByUserIdOrderByNameAsc(userId).stream()
                .map(type -> type.name())
                .toList();
        return ExportDataDTO.from(userId, notes, entities, noteTypes);
    }

    public String exportUserDataAsJson(String userId) throws Exception {
        ExportDataDTO data = exportUserData(userId);
        return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(data);
    }

    /**
     * Exporta TODO o vault do usuário como um arquivo .zip contendo:
     *  - notes/*.md           → cada nota como Markdown (com front-matter)
     *  - entities/*.md        → cada entidade como Markdown
     *  - backup.json          → backup completo em JSON (notas + entidades)
     */
    public byte[] exportVaultAsZip(String userId) throws Exception {
        User user = userRepo.findById(userId).orElseThrow();
        String vaultId = user.getVaultId();

        List<Note> notes = noteRepo.findByUserId(userId);
        List<Entity> entities = entityRepo.findByUserId(userId);

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        Set<String> usedNames = new HashSet<>();

        try (ZipOutputStream zip = new ZipOutputStream(baos)) {
            // ── Notas como Markdown ──────────────────────────────────────────
            for (Note note : notes) {
                String content = "";
                if (vaultId != null) {
                    content = vaultStorageService.loadNoteContent(vaultId, note.getId()).orElse("");
                }

                StringBuilder md = new StringBuilder();
                md.append("---\n");
                md.append("title: ").append(safeYaml(note.getTitle())).append("\n");
                md.append("id: ").append(note.getId()).append("\n");
                if (note.getCreatedAt() != null) md.append("created: ").append(note.getCreatedAt()).append("\n");
                if (note.getUpdatedAt() != null) md.append("updated: ").append(note.getUpdatedAt()).append("\n");
                if (note.getType() != null) md.append("type: ").append(note.getType()).append("\n");
                md.append("---\n\n");
                md.append(content == null ? "" : content);

                String name = "notes/" + uniqueName(usedNames, slugify(note.getTitle(), note.getId())) + ".md";
                writeEntry(zip, name, md.toString());
            }

            // ── Entidades como Markdown ──────────────────────────────────────
            Set<String> usedEntityNames = new HashSet<>();
            for (Entity entity : entities) {
                StringBuilder md = new StringBuilder();
                md.append("---\n");
                md.append("title: ").append(safeYaml(entity.getTitle())).append("\n");
                md.append("id: ").append(entity.getId()).append("\n");
                if (entity.getType() != null) md.append("type: ").append(entity.getType().name()).append("\n");
                if (entity.getCreatedAt() != null) md.append("created: ").append(entity.getCreatedAt()).append("\n");
                if (entity.getTrackingDates() != null && !entity.getTrackingDates().isEmpty()) {
                    md.append("trackingDates: ").append(entity.getTrackingDates()).append("\n");
                }
                md.append("---\n\n");
                md.append(entity.getDescription() == null ? "" : entity.getDescription());

                String name = "entities/" + uniqueName(usedEntityNames, slugify(entity.getTitle(), entity.getId())) + ".md";
                writeEntry(zip, name, md.toString());
            }

            // ── Backup JSON completo ─────────────────────────────────────────
            writeEntry(zip, "backup.json", exportUserDataAsJson(userId));
        }

        return baos.toByteArray();
    }

    private void writeEntry(ZipOutputStream zip, String name, String content) throws Exception {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(content.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    private String safeYaml(String value) {
        if (value == null) return "\"\"";
        return "\"" + value.replace("\"", "\\\"") + "\"";
    }

    private String slugify(String title, String fallbackId) {
        if (title == null || title.isBlank()) return fallbackId;
        String slug = title.trim().toLowerCase()
                .replaceAll("[^a-z0-9\\s-]", "")
                .replaceAll("\\s+", "-")
                .replaceAll("-+", "-");
        if (slug.length() > 80) slug = slug.substring(0, 80);
        if (slug.isBlank()) return fallbackId;
        return slug;
    }

    private String uniqueName(Set<String> used, String base) {
        String name = base;
        int i = 1;
        while (!used.add(name)) {
            name = base + "-" + i++;
        }
        return name;
    }
}
