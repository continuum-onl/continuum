package onl.continuum.continuum.controller.dto.note;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import onl.continuum.continuum.domain.note.Note;
import java.time.Instant;
import java.util.Collections;
import java.util.List;

public record NoteResponse(
    String id, String userId, String folderId, String title, List<String> entityIds, JsonNode content,
    String type, boolean favorite, Instant createdAt, Instant updatedAt, List<String> workspaceIds
) {
    private static final ObjectMapper mapper = new ObjectMapper();

    public static NoteResponse from(Note note, String content) {
        JsonNode contentNode = parseContent(content);
        return new NoteResponse(
            note.getId(), note.getUserId(), null,
            note.getTitle(), note.getEntityIds() != null ? note.getEntityIds() : Collections.emptyList(), contentNode,
            note.getType(), note.isFavorite(),
            note.getCreatedAt(), note.getUpdatedAt(),
            note.getWorkspaceIds() != null ? note.getWorkspaceIds() : Collections.emptyList());
    }

    private static JsonNode parseContent(String content) {
        if (content == null || content.isBlank()) {
            ObjectNode root = mapper.createObjectNode();
            root.put("type", "doc");
            root.set("content", mapper.createArrayNode());
            return root;
        }

        try {
            return mapper.readTree(content);
        } catch (Exception e) {
            ObjectNode root = mapper.createObjectNode();
            root.put("type", "doc");
            ArrayNode contentArray = mapper.createArrayNode();
            ObjectNode paragraph = mapper.createObjectNode();
            paragraph.put("type", "paragraph");
            ArrayNode paragraphContent = mapper.createArrayNode();
            ObjectNode textNode = mapper.createObjectNode();
            textNode.put("type", "text");
            textNode.put("text", content);
            paragraphContent.add(textNode);
            paragraph.set("content", paragraphContent);
            contentArray.add(paragraph);
            root.set("content", contentArray);
            return root;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
