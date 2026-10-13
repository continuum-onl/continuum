package onl.continuum.continuum.application.service;

import onl.continuum.continuum.application.exception.BadRequestException;
import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.domain.note.NoteType;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.persistence.NoteTypeRepository;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class NoteTypeService {
    private final NoteTypeRepository noteTypeRepository;
    private final NoteRepository noteRepository;

    public NoteTypeService(NoteTypeRepository noteTypeRepository, NoteRepository noteRepository) {
        this.noteTypeRepository = noteTypeRepository;
        this.noteRepository = noteRepository;
    }

    public List<String> list() {
        UserScope scope = currentScope();
        return noteTypeRepository.findByUserIdAndVaultIdOrderByNameAsc(scope.userId(), scope.vaultId())
                .stream()
                .map(NoteType::name)
                .toList();
    }

    public String create(String requestedName) {
        String name = requestedName == null ? "" : requestedName.trim();
        if (name.isEmpty() || name.length() > 80) {
            throw new BadRequestException("Type name must contain between 1 and 80 characters");
        }

        UserScope scope = currentScope();
        return noteTypeRepository.findByUserIdAndVaultIdAndName(scope.userId(), scope.vaultId(), name)
                .map(NoteType::name)
                .orElseGet(() -> noteTypeRepository.save(new NoteType(
                        UUID.randomUUID().toString(),
                        scope.userId(),
                        scope.vaultId(),
                        name,
                        Instant.now()
                )).name());
    }

    @CacheEvict(value = {"insights:notes", "insights:entities"}, allEntries = true)
    public void delete(String requestedName) {
        String name = requestedName == null ? "" : requestedName.trim();
        if (name.isEmpty()) {
            throw new BadRequestException("Type name is required");
        }

        UserScope scope = currentScope();
        List<Note> notes = noteRepository.findByUserIdAndTypeAndVaultId(scope.userId(), name, scope.vaultId());
        Instant now = Instant.now();
        notes.forEach(note -> {
            note.setType(null);
            note.setUpdatedAt(now);
        });
        if (!notes.isEmpty()) noteRepository.saveAll(notes);
        noteTypeRepository.deleteByUserIdAndVaultIdAndName(scope.userId(), scope.vaultId(), name);
    }

    private UserScope currentScope() {
        Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        if (principal instanceof CustomUserDetails userDetails) {
            return new UserScope(userDetails.getUserId(), userDetails.getVaultId());
        }
        throw new IllegalStateException("Authenticated user not found");
    }

    private record UserScope(String userId, String vaultId) {}
}
