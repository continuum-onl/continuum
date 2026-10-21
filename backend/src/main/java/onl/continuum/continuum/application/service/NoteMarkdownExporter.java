package onl.continuum.continuum.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Converts stored editor documents for portable, content-only note exports. */
final class NoteMarkdownExporter {
    private NoteMarkdownExporter() {}

    static String filename(String title, String fallbackId) {
        if (title == null || title.isBlank()) return fallbackId;
        String name = title.trim().replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_")
                .replaceAll("[. ]+$", "");
        return name.isBlank() ? fallbackId : name;
    }

    static String content(String stored, ObjectMapper mapper) {
        if (stored == null || stored.isBlank()) return "";
        try {
            JsonNode node = mapper.readTree(stored);
            for (int depth = 0; depth < 6 && node != null && node.isTextual(); depth++) {
                node = mapper.readTree(node.asText());
            }
            if (node == null || !"doc".equals(node.path("type").asText())) return stored;
            return render(node).stripTrailing() + "\n";
        } catch (Exception ignored) {
            // Older vaults may already contain Markdown: preserve it unchanged.
            return stored;
        }
    }

    private static String children(JsonNode node) {
        StringBuilder result = new StringBuilder();
        for (JsonNode child : node.path("content")) result.append(render(child));
        return result.toString();
    }

    private static String render(JsonNode node) {
        JsonNode attrs = node.path("attrs");
        String body = children(node);
        return switch (node.path("type").asText()) {
            case "text" -> markedText(node);
            case "paragraph" -> body + "\n\n";
            case "heading" -> body.isBlank() ? "" : "#".repeat(Math.max(1, Math.min(6, attrs.path("level").asInt(1)))) + " " + body + "\n\n";
            case "hardBreak" -> "  \n";
            case "horizontalRule" -> "---\n\n";
            case "mention", "noteMention" -> attrs.path("label").asText(attrs.path("title").asText(""));
            case "bulletList", "taskList" -> list(node, false);
            case "orderedList" -> list(node, true);
            case "blockquote" -> "> " + body.stripTrailing().replace("\n", "\n> ") + "\n\n";
            case "codeBlock" -> codeBlock(node);
            case "image", "vaultImage" -> "![" + attrs.path("alt").asText("") + "](" + attrs.path("src").asText("") + ")\n\n";
            case "table" -> table(node);
            default -> body;
        };
    }

    private static String markedText(JsonNode node) {
        String text = node.path("text").asText("");
        boolean code = false;
        for (JsonNode mark : node.path("marks")) {
            if ("code".equals(mark.path("type").asText())) code = true;
        }
        if (code) {
            String fence = text.contains("`") ? "``" : "`";
            text = fence + " " + text + " " + fence;
        } else {
            text = text.replace("\\", "\\\\").replace("*", "\\*").replace("_", "\\_")
                    .replace("[", "\\[").replace("]", "\\]").replace("`", "\\`");
        }
        for (JsonNode mark : node.path("marks")) {
            text = switch (mark.path("type").asText()) {
                case "bold" -> "**" + text + "**";
                case "italic" -> "*" + text + "*";
                case "strike" -> "~~" + text + "~~";
                case "link" -> "[" + text + "](" + mark.path("attrs").path("href").asText("") + ")";
                default -> text;
            };
        }
        return text;
    }

    private static String list(JsonNode node, boolean ordered) {
        StringBuilder result = new StringBuilder();
        int index = node.path("attrs").path("start").asInt(1);
        for (JsonNode item : node.path("content")) {
            String prefix = ordered ? index++ + ". " : "- ";
            if ("taskItem".equals(item.path("type").asText())) {
                prefix += item.path("attrs").path("checked").asBoolean() ? "[x] " : "[ ] ";
            }
            String indent = " ".repeat(prefix.length());
            result.append(prefix).append(children(item).stripTrailing().replace("\n", "\n" + indent)).append("\n");
        }
        return result + "\n";
    }

    private static String codeBlock(JsonNode node) {
        StringBuilder code = new StringBuilder();
        for (JsonNode child : node.path("content")) code.append(child.path("text").asText(""));
        String fence = "```";
        while (code.indexOf(fence) >= 0) fence += "`";
        return fence + node.path("attrs").path("language").asText("") + "\n" + code + "\n" + fence + "\n\n";
    }

    private static String table(JsonNode node) {
        StringBuilder result = new StringBuilder();
        boolean first = true;
        for (JsonNode row : node.path("content")) {
            result.append("|");
            for (JsonNode cell : row.path("content")) {
                result.append(" ").append(children(cell).strip().replace("|", "\\|").replace("\n", "<br>")).append(" |");
            }
            result.append("\n");
            if (first) {
                result.append("|").append(" --- |".repeat(row.path("content").size())).append("\n");
                first = false;
            }
        }
        return result + "\n";
    }
}