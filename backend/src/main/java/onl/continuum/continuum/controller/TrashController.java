package onl.continuum.continuum.controller;

import io.swagger.v3.oas.annotations.tags.Tag;
import onl.continuum.continuum.application.service.TrashService;
import onl.continuum.continuum.domain.trash.TrashItem;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/trash")
@Tag(name = "Trash", description = "Deleted notes, entities, and files, restorable for 30 days")
public class TrashController {

    private final TrashService trashService;

    public TrashController(TrashService trashService) { this.trashService = trashService; }

    public record TrashItemDTO(String id, String kind, String originalId, String title, String subtype, Instant deletedAt, Instant expiresAt) {
        static TrashItemDTO from(TrashItem t) {
            return new TrashItemDTO(t.getId(), t.getKind(), t.getOriginalId(), t.getTitle(), t.getSubtype(), t.getDeletedAt(),
                    t.getDeletedAt() == null ? null : t.getDeletedAt().plusSeconds(TrashItem.RETENTION_DAYS * 86400L));
        }
    }

    @GetMapping
    public ResponseEntity<List<TrashItemDTO>> list(@AuthenticationPrincipal CustomUserDetails user) {
        return ResponseEntity.ok(trashService.list(user.getUserId()).stream().map(TrashItemDTO::from).toList());
    }

    @PostMapping("/{id}/restore")
    public ResponseEntity<Void> restore(@AuthenticationPrincipal CustomUserDetails user, @PathVariable String id) {
        trashService.restore(user.getUserId(), id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> purge(@AuthenticationPrincipal CustomUserDetails user, @PathVariable String id) {
        trashService.purge(user.getUserId(), id);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping
    public ResponseEntity<Void> empty(@AuthenticationPrincipal CustomUserDetails user) {
        trashService.empty(user.getUserId());
        return ResponseEntity.noContent().build();
    }
}
