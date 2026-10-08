package onl.continuum.continuum.infra.vault;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * [V11-ARCH] Interface centraliza todo I/O do vault do usuário no B2.
 *
 * Estrutura de paths no bucket:
 *   vaults/{vaultId}/notes/{noteId}.md           ← conteúdo markdown
 *   vaults/{vaultId}/_notes/index.json           ← NoteIndex[] (metadados)
 *   vaults/{vaultId}/_entities/entities.json     ← Entity[] (definições)
 *   vaults/{vaultId}/_entities/entity_index.json ← métricas de menções
 *   vaults/{vaultId}/_folders/folders.json       ← Folder[] (estrutura)
 *   vaults/{vaultId}/_tracking/events.json       ← TrackingEvent[]
 *   vaults/{vaultId}/_refs/refs.json             ← NoteReference[]
 *   vaults/{vaultId}/files/{fileId}              ← user-uploaded files
 */
public interface VaultStorageService {

    void initializeVault(String vaultId);

    // ── Notes ────────────────────────────────────────────────────────────────
    void saveNote(String vaultId, String noteId, String content);
    Optional<String> loadNote(String vaultId, String noteId);
    void deleteNote(String vaultId, String noteId);

    String saveNoteContent(String vaultId, String noteId, String content);
    Optional<String> loadNoteContent(String vaultId, String noteId);
    default void cacheNoteContent(String vaultId, String noteId, String content) {}
    default void invalidateNoteContent(String vaultId, String noteId) {}

    // ── Note index (metadados) ────────────────────────────────────────────────
    void saveNoteIndex(String vaultId, String indexJson);
    Optional<String> loadNoteIndex(String vaultId);

    // ── Entities ─────────────────────────────────────────────────────────────
    void saveEntities(String vaultId, String entitiesJson);
    Optional<String> loadEntities(String vaultId);

    // ── Entity index (métricas de menções) ───────────────────────────────────
    void saveEntityIndex(String vaultId, String indexJson);
    Optional<String> loadEntityIndex(String vaultId);

    // ── Folders ──────────────────────────────────────────────────────────────
    void saveFolders(String vaultId, String foldersJson);
    Optional<String> loadFolders(String vaultId);

    // ── Tracking events ───────────────────────────────────────────────────────
    void saveTrackingEvents(String vaultId, String eventsJson);
    Optional<String> loadTrackingEvents(String vaultId);

    // ── Note references ───────────────────────────────────────────────────────
    void saveRefs(String vaultId, String refsJson);
    Optional<String> loadRefs(String vaultId);

    // ── User preferences (UI settings, e.g. wallpaper) ────────────────────────
    void savePreferences(String vaultId, String prefsJson);
    Optional<String> loadPreferences(String vaultId);

    // ── Files ─────────────────────────────────────────────────────────────────
    void saveFile(String vaultId, String fileId, byte[] content, String contentType);
    Optional<byte[]> loadFile(String vaultId, String fileId);
    void deleteFile(String vaultId, String fileId);
    List<VaultFileDescriptor> listFiles(String vaultId);
    void deleteVault(String vaultId);

    public record VaultFileDescriptor(String fileId, String fileName, String contentType, long size, Instant createdAt) {}
}

// ─────────────────────────────────────────────────────────────────────────────
