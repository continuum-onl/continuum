package onl.continuum.continuum.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import onl.continuum.continuum.application.service.InsightsService;
import onl.continuum.continuum.controller.dto.insights.EntityInsightDTO;
import onl.continuum.continuum.controller.dto.insights.NoteInsightDTO;

import java.util.List;

/**
 * InsightsController — endpoints para descoberta de notas/entidades importantes.
 *
 * Resolve o problema do "graveyard of notes":
 *  • Hot Notes / Hot Entities → o que está em alta agora
 *  • Forgotten Notes / Forgotten Entities → "joias" antigas com alto valor histórico
 */
@RestController
@RequestMapping("/api/insights")
@Tag(name = "Insights", description = "Importance scoring and discovery of notes/entities worth revisiting")
public class InsightsController {

    private final InsightsService insightsService;
    private final onl.continuum.continuum.application.service.MemoriesService memoriesService;

    public InsightsController(InsightsService insightsService,
                              onl.continuum.continuum.application.service.MemoriesService memoriesService) {
        this.insightsService = insightsService;
        this.memoriesService = memoriesService;
    }

    @GetMapping("/notes/hot")
    @Operation(summary = "Top important notes (Hot Notes)")
    public ResponseEntity<List<NoteInsightDTO>> hotNotes(@RequestParam(defaultValue = "10") int limit) {
        return ResponseEntity.ok(insightsService.hotNotes(limit));
    }

    @GetMapping("/notes/forgotten")
    @Operation(summary = "Important but forgotten notes (high historical score + stale)")
    public ResponseEntity<List<NoteInsightDTO>> forgottenNotes(@RequestParam(defaultValue = "10") int limit) {
        return ResponseEntity.ok(insightsService.forgottenNotes(limit));
    }

    @GetMapping("/entities/hot")
    @Operation(summary = "Key entities (Hot Entities)")
    public ResponseEntity<List<EntityInsightDTO>> hotEntities(@RequestParam(defaultValue = "10") int limit) {
        return ResponseEntity.ok(insightsService.hotEntities(limit));
    }

    @GetMapping("/entities/forgotten")
    @Operation(summary = "Important but forgotten entities")
    public ResponseEntity<List<EntityInsightDTO>> forgottenEntities(@RequestParam(defaultValue = "10") int limit) {
        return ResponseEntity.ok(insightsService.forgottenEntities(limit));
    }

    @GetMapping("/memories")
    @Operation(summary = "Daily memories: up to 3 old notes hitting a time milestone, with a preview")
    public ResponseEntity<List<onl.continuum.continuum.application.service.MemoriesService.Memory>> memories(
            @org.springframework.security.core.annotation.AuthenticationPrincipal
            onl.continuum.continuum.infra.security.CustomUserDetails user) {
        return ResponseEntity.ok(memoriesService.feed(user.getUserId(), user.getVaultId()));
    }
}
