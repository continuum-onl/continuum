package onl.continuum.continuum.controller;

import jakarta.validation.Valid;
import onl.continuum.continuum.application.service.NoteTypeService;
import onl.continuum.continuum.controller.dto.note.NoteTypeCreateRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/note-types")
public class NoteTypeController {
    private final NoteTypeService noteTypeService;

    public NoteTypeController(NoteTypeService noteTypeService) {
        this.noteTypeService = noteTypeService;
    }

    @GetMapping
    public ResponseEntity<List<String>> list() {
        return ResponseEntity.ok(noteTypeService.list());
    }

    @PostMapping
    public ResponseEntity<Map<String, String>> create(@Valid @RequestBody NoteTypeCreateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of("name", noteTypeService.create(request.name())));
    }

    @DeleteMapping
    public ResponseEntity<Void> delete(@RequestParam String name) {
        noteTypeService.delete(name);
        return ResponseEntity.noContent().build();
    }
}
