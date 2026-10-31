package onl.continuum.continuum.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import onl.continuum.continuum.application.service.EntityService;
import onl.continuum.continuum.application.service.NoteService;
import onl.continuum.continuum.controller.dto.graph.GraphDTO;
import onl.continuum.continuum.controller.dto.graph.LinkDTO;
import onl.continuum.continuum.controller.dto.graph.NodeDTO;
import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.infra.security.CustomUserDetails;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * GraphController - Construir o grafo de conhecimento usando dados otimizados.
 * 
 * Retorna um grafo simples baseado em notas e entidades conectadas por entityIds.
 */
@RestController
@RequestMapping("/api/graph")
public class GraphController {

    private final NoteService noteService;
    private final EntityService entityService;

    public GraphController(NoteService noteService, EntityService entityService) {
        this.noteService = noteService;
        this.entityService = entityService;
    }

    /**
     * Retorna o grafo de conhecimento completo do usuário.
     * 
     * Estrutura:
     * - Nodes: Notas (type="NOTE") + Entidades (type="ACTIVITY", "PERSON", etc)
     * - Links: Conexões derivadas de note.entityIds
     */
    @GetMapping("/data")
    public ResponseEntity<GraphDTO> getGraphData(@AuthenticationPrincipal CustomUserDetails user) {
        String userId = user.getUserId();

        List<Note> notes = noteService.listByUserForGraph().stream()
                .filter(n -> onl.continuum.continuum.infra.web.RequestWorkspace.matches(n.getWorkspaceIds())).toList();
        List<Entity> entities = entityService.listByUserForGraph(userId).stream()
                .filter(e -> onl.continuum.continuum.infra.web.RequestWorkspace.matches(e.getWorkspaceIds())).toList();

        List<NodeDTO> nodes = new ArrayList<>();
        Set<String> nodeIds = new HashSet<>();
        
        for (Note note : notes) {
            nodes.add(new NodeDTO(note.getId(), note.getTitle(), "NOTE"));
            nodeIds.add(note.getId());
        }

        for (Entity entity : entities) {
            nodes.add(new NodeDTO(entity.getId(), entity.getTitle(),
                    entity.getType() != null ? entity.getType().name() : "ENTITY"));
            nodeIds.add(entity.getId());
        }

        List<LinkDTO> links = new ArrayList<>();
        
        for (Note note : notes) {
            if (note.getEntityIds() == null) {
                continue;
            }
            for (String entityId : note.getEntityIds()) {
                if (nodeIds.contains(entityId)) {
                    links.add(new LinkDTO(note.getId(), entityId));
                }
            }
        }

        return ResponseEntity.ok(new GraphDTO(nodes, links));
    }
}
