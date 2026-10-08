package onl.continuum.continuum.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import onl.continuum.continuum.application.service.EntityService;
import onl.continuum.continuum.controller.dto.entity.EntityContextResponse;
import onl.continuum.continuum.controller.dto.entity.EntityCreateRequest;
import onl.continuum.continuum.controller.dto.entity.EntityResponse;
import onl.continuum.continuum.controller.dto.entity.EntityUpdateRequest;
import onl.continuum.continuum.controller.dto.note.NoteSummaryDTO;
import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.plan.PlanConfiguration;
import onl.continuum.continuum.domain.plan.PlanType;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.security.CustomUserDetails;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import java.time.LocalDate;
import java.util.Collections;
import java.util.List;

@RestController
@RequestMapping("/api/entities")
@Tag(name = "Entities", description = "Endpoints for managing knowledge graph entities (people, places, concepts, etc)")
public class EntityController {

    private final EntityService entityService;
    private final PlanConfiguration planConfig;
    private final UserRepository userRepo;

    public EntityController(EntityService entityService, PlanConfiguration planConfig, UserRepository userRepo) {
        this.entityService = entityService;
        this.planConfig = planConfig;
        this.userRepo = userRepo;
    }

    /** Resolve the authenticated user's retention window (in days). */
    private int historyDaysFor(CustomUserDetails user) {
        PlanType plan = userRepo.findById(user.getUserId())
                .map(u -> u.getPlan())
                .orElse(PlanType.FREE);
        return planConfig.getHistoryDays(plan);
    }

    @PostMapping
    @Operation(summary = "Create a new entity", description = "Creates a new entity (person, place, concept, etc) in the knowledge graph")
    public ResponseEntity<EntityResponse> create(
            @AuthenticationPrincipal CustomUserDetails user,
            @Valid @RequestBody EntityCreateRequest req) {
        Entity entity = entityService.create(req);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(EntityResponse.from(entity, historyDaysFor(user)));
    }

    @GetMapping
    @Operation(summary = "List all entities", description = "Retrieves all entities (knowledge graph nodes) for the authenticated user")
    public ResponseEntity<Page<EntityResponse>> list(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) LocalDate startDate,
            @RequestParam(required = false) LocalDate endDate) {
        Pageable pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        Page<Entity> entities = entityService.listByUser(user.getUserId(), pageable, startDate, endDate);
        final int historyDays = historyDaysFor(user);
        return ResponseEntity.ok(entities.map(e -> EntityResponse.from(e, historyDays)));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get entity by ID", description = "Retrieves a specific entity with all its details")
    public ResponseEntity<EntityResponse> getEntity(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        Entity entity = entityService.getEntity(user.getUserId(), user.getVaultId(), id);
        return ResponseEntity.ok(EntityResponse.from(entity, historyDaysFor(user)));
    }

    @GetMapping("/{id}/context")
    @Operation(summary = "Get entity context", description = "Retrieves the context of an entity including relationships and metadata")
    public ResponseEntity<EntityContextResponse> getEntityContext(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        return ResponseEntity.ok(entityService.getEntityContext(user.getUserId(), id));
    }

    @GetMapping("/{id}/notes")
    @Operation(summary = "Get notes mentioning entity", description = "Retrieves all notes that mention/reference this entity")
    public ResponseEntity<List<NoteSummaryDTO>> getNotesForEntity(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        List<NoteSummaryDTO> notes = entityService.getNotesForEntity(user.getUserId(), user.getVaultId(), id)
                .stream()
                .map(NoteSummaryDTO::from)
                .toList();
        return ResponseEntity.ok(notes);
    }

    @GetMapping("/{id}/connections")
    @Operation(summary = "Get connected entities", description = "Retrieves entities that are connected to this entity through shared notes")
    public ResponseEntity<List<EntityResponse>> getConnections(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        List<Entity> connections = entityService.getConnections(user.getUserId(), user.getVaultId(), id);
        final int historyDays = historyDaysFor(user);
        List<EntityResponse> responses = connections != null && !connections.isEmpty()
            ? connections.stream().map(e -> EntityResponse.from(e, historyDays)).toList()
            : Collections.emptyList();
        return ResponseEntity.ok(responses);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update an entity", description = "Updates the title, type, or description of an entity")
    public ResponseEntity<EntityResponse> update(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id,
            @Valid @RequestBody EntityUpdateRequest req) {
        Entity entity = entityService.update(user.getUserId(), user.getVaultId(), id, req);
        return ResponseEntity.ok(EntityResponse.from(entity, historyDaysFor(user)));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete an entity", description = "Permanently deletes an entity from the knowledge graph")
    public ResponseEntity<Void> delete(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        entityService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{id}/favorite")
    @Operation(summary = "Toggle favorite status", description = "Toggles the favorite flag for an entity and persists it")
    public ResponseEntity<EntityResponse> toggleFavorite(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        Entity entity = entityService.toggleFavorite(id);
        return ResponseEntity.ok(EntityResponse.from(entity, historyDaysFor(user)));
    }

    @PostMapping("/{id}/track-activity")
    @Operation(summary = "Track activity occurrence", description = "Records a tracking event for an activity entity on the current date")
    public ResponseEntity<EntityResponse> trackActivity(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id,
            @RequestParam(required = false) java.time.LocalDate date) {
        Entity entity = entityService.trackActivity(user.getUserId(), id, date);
        return ResponseEntity.ok(EntityResponse.from(entity, historyDaysFor(user)));
    }
}
