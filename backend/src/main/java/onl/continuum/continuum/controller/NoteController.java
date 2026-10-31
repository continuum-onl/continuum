package onl.continuum.continuum.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import onl.continuum.continuum.application.exception.BadRequestException;
import onl.continuum.continuum.application.service.NoteService;
import onl.continuum.continuum.controller.dto.note.NoteCreateRequest;
import onl.continuum.continuum.controller.dto.note.NoteResponse;
import onl.continuum.continuum.controller.dto.note.NoteSummaryDTO;
import onl.continuum.continuum.controller.dto.note.NoteUpdateRequest;
import onl.continuum.continuum.controller.dto.note.BacklinkDTO;
import onl.continuum.continuum.controller.dto.note.BacklinksResponse;
import onl.continuum.continuum.controller.dto.note.CreateNoteLinkRequest;
import onl.continuum.continuum.infra.security.CustomUserDetails;

import java.util.Collections;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/notes")
@Tag(name = "Notes", description = "Endpoints for managing user notes")
public class NoteController {

    private final NoteService noteService;

    public NoteController(NoteService noteService) { this.noteService = noteService; }

    @PostMapping
    @Operation(summary = "Create a new note", description = "Creates a new note with the provided title and content. Content is automatically sanitized for security.")
    public ResponseEntity<NoteResponse> create(@AuthenticationPrincipal CustomUserDetails user,
            @RequestBody NoteCreateRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(noteService.create(req));
    }

    @GetMapping
    @Operation(summary = "List all notes", description = "Retrieves a list of all notes for the authenticated user")
    public ResponseEntity<List<NoteSummaryDTO>> list(@AuthenticationPrincipal CustomUserDetails user) {
        List<NoteSummaryDTO> summaries = noteService.listByUser().stream()
            .filter(n -> onl.continuum.continuum.infra.web.RequestWorkspace.matches(n.getWorkspaceIds()))
            .map(NoteSummaryDTO::from).toList();
        return ResponseEntity.ok(summaries);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get note by ID", description = "Retrieves a specific note with full content by its ID")
    public ResponseEntity<NoteResponse> get(@AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        return ResponseEntity.ok(noteService.getById(id));
    }

    @PatchMapping("/bulk-type")
    @Operation(summary = "Bulk update note type", description = "Assigns one note type to multiple selected notes")
    public ResponseEntity<List<NoteSummaryDTO>> bulkType(@AuthenticationPrincipal CustomUserDetails user,
            @RequestBody Map<String, Object> body) {
        Object rawIds = body.get("ids");
        Object rawType = body.get("type");
        if (!(rawIds instanceof List<?> ids) || ids.isEmpty()) {
            throw new BadRequestException("ids is required");
        }
        if (!(rawType instanceof String type) || type.trim().isEmpty()) {
            throw new BadRequestException("type is required");
        }
        List<String> noteIds = ids.stream()
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .toList();
        if (noteIds.isEmpty()) {
            throw new BadRequestException("ids is required");
        }
        return ResponseEntity.ok(noteService.updateTypes(noteIds, type).stream()
                .map(NoteSummaryDTO::from)
                .toList());
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a note", description = "Updates the title and/or content of an existing note")
    public ResponseEntity<NoteResponse> update(@AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id,
            @RequestBody NoteUpdateRequest req) {
        return ResponseEntity.ok(noteService.update(id, req));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Delete a note", description = "Permanently deletes a note and removes it from associated entities")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        noteService.deleteNote(id);
        return ResponseEntity.noContent().build();
    }

    @PatchMapping("/{id}/favorite")
    @Operation(summary = "Toggle favorite status", description = "Toggles the favorite (starred) flag for a note and persists it")
    public ResponseEntity<NoteResponse> toggleFavorite(@AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        return ResponseEntity.ok(noteService.toggleFavorite(id));
    }

    // ============================================================================
    // BACKLINKS ENDPOINTS - Links Bidirecionais no Grafo
    // ============================================================================
    
    @GetMapping("/{id}/backlinks")
    @Operation(summary = "Get backlinks for a note", description = "Retrieves notes that share referenced entities with the requested note")
    public ResponseEntity<BacklinksResponse> getBacklinks(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        BacklinksResponse response = noteService.getBacklinks(id);
        return ResponseEntity.ok(response);
    }
    
    @GetMapping("/{id}/forward-links")
    @Operation(summary = "Get forward links for a note", description = "Retrieves all notes that this note references/mentions")
    public ResponseEntity<List<BacklinkDTO>> getForwardLinks(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        List<BacklinkDTO> forwardLinks = noteService.getForwardLinks(id).stream()
                .map(BacklinkDTO::fromNote)
                .toList();
        return ResponseEntity.ok(forwardLinks != null ? forwardLinks : Collections.emptyList());
    }
    
    @GetMapping("/{id}/backlink-count")
    @Operation(summary = "Get backlink count", description = "Returns the number of notes that reference this note")
    public ResponseEntity<BacklinkCountResponse> getBacklinkCount(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String id) {
        long count = noteService.getBacklinkCount(id);
        return ResponseEntity.ok(new BacklinkCountResponse(id, count));
    }
    
    @GetMapping("/types")
    @Operation(summary = "Get all note types", description = "Retrieves list of all unique types created by the authenticated user")
    public ResponseEntity<List<String>> getTypes(@AuthenticationPrincipal CustomUserDetails user) {
        List<String> types = noteService.getDistinctTypes();
        return ResponseEntity.ok(types);
    }
    
    @PostMapping("/links")
    @Operation(summary = "Create a link between two notes", description = "Creates a bidirectional link between two notes in the knowledge graph")
    public ResponseEntity<Void> createNoteLink(
            @AuthenticationPrincipal CustomUserDetails user,
            @Valid @RequestBody CreateNoteLinkRequest req) {
        noteService.createNoteLink(req.sourceNoteId(), req.targetNoteId(), req.linkType(), req.context());
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }
    
    /**
     * Response object para retornar a contagem de backlinks
     */
    public record BacklinkCountResponse(String noteId, long count) {}
}