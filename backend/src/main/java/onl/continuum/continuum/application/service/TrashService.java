package onl.continuum.continuum.application.service;

import onl.continuum.continuum.application.exception.NotFoundException;
import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.domain.trash.TrashItem;
import onl.continuum.continuum.infra.persistence.EntityRepository;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.persistence.TrashItemRepository;
import onl.continuum.continuum.infra.vault.VaultStorageService;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Caching;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

@Service
public class TrashService {

    private final TrashItemRepository trashRepo;
    private final NoteRepository noteRepo;
    private final EntityRepository entityRepo;
    private final VaultStorageService storage;
    private final UserService userService;

    public TrashService(TrashItemRepository trashRepo, NoteRepository noteRepo, EntityRepository entityRepo,
                        VaultStorageService storage, UserService userService) {
        this.trashRepo = trashRepo;
        this.noteRepo = noteRepo;
        this.entityRepo = entityRepo;
        this.storage = storage;
        this.userService = userService;
    }

    private Instant cutoff() {
        return Instant.now().minus(Duration.ofDays(TrashItem.RETENTION_DAYS));
    }

    public List<TrashItem> list(String userId) {
        permanentlyDelete(trashRepo.findByUserIdAndDeletedAtBefore(userId, cutoff()));
        return trashRepo.findByUserIdOrderByDeletedAtDesc(userId);
    }

    public List<String> trashedFileIds(String vaultId) {
        return trashRepo.findByVaultIdAndKind(vaultId, "FILE").stream()
                .map(TrashItem::getOriginalId)
                .toList();
    }

    public void trashFile(String userId, String vaultId, VaultStorageService.VaultFileDescriptor file) {
        trashRepo.save(TrashItem.builder()
                .userId(userId)
                .vaultId(vaultId)
                .kind("FILE")
                .originalId(file.fileId())
                .title(file.fileName())
                .subtype(file.contentType())
                .deletedAt(Instant.now())
                .build());
    }

    private TrashItem owned(String userId, String id) {
        return trashRepo.findById(id)
                .filter(t -> userId.equals(t.getUserId()))
                .orElseThrow(() -> new NotFoundException("Trash item not found: " + id));
    }

    @Caching(evict = {
        @CacheEvict(value = "insights:notes", allEntries = true),
        @CacheEvict(value = "insights:entities", allEntries = true)
    })
    public void restore(String userId, String id) {
        TrashItem item = owned(userId, id);
        if ("NOTE".equals(item.getKind()) && item.getNote() != null) {
            Note note = item.getNote();
            note.setId(item.getOriginalId());
            note.setUserId(userId);
            String content = item.getNoteContent() == null ? "" : item.getNoteContent();
            String key = storage.saveNoteContent(item.getVaultId(), note.getId(), content);
            note.setFileKey(key);
            noteRepo.save(note);
            userService.incrementNoteCount(userId);
        } else if ("ENTITY".equals(item.getKind()) && item.getEntity() != null) {
            Entity entity = item.getEntity();
            entity.setId(item.getOriginalId());
            entity.setUserId(userId);
            entityRepo.save(entity);
            userService.incrementEntityCount(userId);
        } else if ("FILE".equals(item.getKind())
                && storage.loadFile(item.getVaultId(), item.getOriginalId()).isEmpty()) {
            throw new NotFoundException("File no longer exists");
        }
        trashRepo.delete(item);
    }

    public void purge(String userId, String id) {
        permanentlyDelete(List.of(owned(userId, id)));
    }

    public void empty(String userId) {
        permanentlyDelete(trashRepo.findByUserIdOrderByDeletedAtDesc(userId));
    }

    @Scheduled(cron = "0 15 3 * * *")
    public void purgeExpired() {
        permanentlyDelete(trashRepo.findByDeletedAtBefore(cutoff()));
    }

    private void permanentlyDelete(List<TrashItem> items) {
        for (TrashItem item : items) {
            if ("FILE".equals(item.getKind())) {
                storage.deleteFile(item.getVaultId(), item.getOriginalId());
            }
            trashRepo.delete(item);
        }
    }
}
