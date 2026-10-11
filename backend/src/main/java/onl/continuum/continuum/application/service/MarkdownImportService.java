package onl.continuum.continuum.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.commonmark.ext.gfm.tables.TablesExtension;
import org.commonmark.ext.front.matter.YamlFrontMatterExtension;
import org.commonmark.ext.front.matter.YamlFrontMatterVisitor;
import org.commonmark.node.*;
import org.commonmark.parser.Parser;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses Markdown files into Tiptap JSON and runs heuristic entity detection.
 * Used by the import flow — no DB access here, pure transformation.
 */
@Slf4j
@Service
public class MarkdownImportService {

    private final ObjectMapper mapper = new ObjectMapper();
    private final Parser parser;

    private static final Pattern WIKI_LINK = Pattern.compile("\\[\\[([^\\]|]+)(?:\\|[^\\]]+)?\\]\\]");
    private static final Pattern HASHTAG = Pattern.compile("(?<![\\w/#])#([\\p{L}][\\p{L}0-9_-]{1,40})");
    private static final Pattern PROPER_NOUN = Pattern.compile(
            "\\b([A-ZÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ][a-záàâãäéèêëíìîïóòôõöúùûüçñ]{2,})(?:\\s([A-ZÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ][a-záàâãäéèêëíìîïóòôõöúùûüçñ]{1,}))?(?:\\s([A-ZÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ][a-záàâãäéèêëíìîïóòôõöúùûüçñ]{1,}))?\\b"
    );
    private static final Pattern MULTI_WORD_NAME = Pattern.compile(
            "\\b([\\p{L}][\\p{L}\\p{M}'-]{2,})[ \\t]+([\\p{L}][\\p{L}\\p{M}'-]{1,})(?:[ \\t]+([\\p{L}][\\p{L}\\p{M}'-]{1,}))?\\b"
    );

    private static final Set<String> STOPLIST = Set.of(
            "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
            "january","february","march","april","may","june","july","august","september","october","november","december",
            "segunda","terça","quarta","quinta","sexta","sábado","domingo",
            "janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro",
            "the","this","that","these","those","today","tomorrow","yesterday","when","where","what","why","how","but","and","also","then","still","just",
            "ontem","hoje","amanhã","quando","onde","porque","mas","também","então","ainda","apenas"
    );

    private static final Set<String> NOISE = Set.of(
            "supermercado","supermarket","transporte","transport","comida","food",
            "trabalho","work","casa","home","reuniao","reunião","meeting",
            "escola","school","faculdade","university","mercado","market",
            "almoco","almoço","lunch","jantar","dinner","cafe","café","coffee",
            "viagem","trip","carro","car","onibus","ônibus","bus","metro","metrô",
            "vida","life","tempo","time","dia","day","semana","week","mes","mês","month","ano","year",
            "pessoa","person","gente","people","coisa","thing","ideia","idea",
            "nota","note","texto","text","arquivo","file","pasta","folder"
    );

    private static final Pattern FILE_EXT = Pattern.compile(
            "(?i)\\.(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|" +
            "mp3|wav|m4a|ogg|opus|flac|aac|" +
            "mp4|mov|webm|avi|mkv|" +
            "pdf|docx?|xlsx?|pptx?|csv|tsv|" +
            "zip|rar|7z|tar|gz|" +
            "exe|dmg|apk|" +
            "html?|css|js|ts|tsx|jsx|json|xml|yaml|yml)$"
    );

    private static boolean looksLikePathOrUrl(String s) {
        if (s == null) return false;
        return s.contains("/") || s.contains("\\") || s.startsWith("http")
                || s.contains("://") || s.startsWith("www.");
    }

    public MarkdownImportService() {
        List<org.commonmark.Extension> extensions = Arrays.asList(
                YamlFrontMatterExtension.create(),
                TablesExtension.create()
        );
        this.parser = Parser.builder().extensions(extensions).build();
    }

    public record ParsedFile(
            String filename,
            String title,
            JsonNode content,
            List<String> candidateKeys,
            Map<String, Candidate> candidates,
            int wordCount,
            String contentHash,
            boolean hasBody
    ) {}

    public record Candidate(String key, String name, String suggestedType, int occurrences, String confidence) {}

    public ParsedFile parse(String filename, String markdown) {
        Node root = parser.parse(markdown == null ? "" : markdown);

        YamlFrontMatterVisitor fm = new YamlFrontMatterVisitor();
        root.accept(fm);
        Map<String, List<String>> frontmatter = fm.getData();

        ObjectNode doc = mapper.createObjectNode();
        doc.put("type", "doc");
        ArrayNode topContent = mapper.createArrayNode();
        doc.set("content", topContent);

        Node child = root.getFirstChild();
        while (child != null) {
            JsonNode converted = convertBlock(child);
            if (converted != null) topContent.add(converted);
            child = child.getNext();
        }
        if (topContent.isEmpty()) {
            topContent.add(emptyParagraph());
        }

        String title = pickTitle(frontmatter, root, filename);

        String plain = extractPlain(root);
        Map<String, Candidate> candidates = new LinkedHashMap<>();
        detectFromFrontmatter(frontmatter, candidates);
        detectFromPlain(plain, candidates);

        Map<String, Candidate> repeatedCandidates = new LinkedHashMap<>();
        for (Candidate candidate : candidates.values()) {
            int occurrences = countMentions(plain, candidate.key());
            if (occurrences >= 2 && !isNoise(candidate.name())) {
                repeatedCandidates.put(candidate.key(), new Candidate(
                        candidate.key(), candidate.name(), candidate.suggestedType(),
                        occurrences, candidate.confidence()));
            }
        }
        candidates = repeatedCandidates;

        int wordCount = plain.isBlank() ? 0 : plain.trim().split("\\s+").length;
        boolean hasBody = !plain.trim().isEmpty();
        String hash = sha1(normalizeForHash(plain) + "::" + title);

        return new ParsedFile(filename, title, doc,
                new ArrayList<>(candidates.keySet()), candidates, wordCount, hash, hasBody);
    }

    private boolean isNoise(String name) {
        if (name == null) return true;
        String n = stripAccents(name.toLowerCase(Locale.ROOT).trim());
        if (n.length() < 2) return true;
        if (looksLikePathOrUrl(n)) return true;
        if (FILE_EXT.matcher(n).find()) return true;
        return NOISE.contains(n);
    }

    private int countMentions(String text, String entityKey) {
        String[] words = entityKey.split("\\s+");
        StringJoiner phrase = new StringJoiner("\\s+");
        for (String word : words) phrase.add(Pattern.quote(word));
        Pattern mention = Pattern.compile(
                "(?iu)(?<![\\p{L}\\p{N}_])" + phrase + "(?![\\p{L}\\p{N}_])");
        Matcher matcher = mention.matcher(text);
        int occurrences = 0;
        while (matcher.find()) occurrences++;
        return occurrences;
    }

    private static String stripAccents(String s) {
        return java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
    }

    private String normalizeForHash(String s) {
        if (s == null) return "";
        return s.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    private String sha1(String s) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");
            byte[] d = md.digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    private String pickTitle(Map<String, List<String>> fm, Node root, String filename) {
        // Title is always derived from the file name (without directory and extension).
        // Frontmatter `title`/`name` and the first heading are intentionally ignored so
        // imported notes preserve the user's original filenames.
        String name = filename == null ? "" : filename;
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) name = name.substring(slash + 1);
        int dot = name.lastIndexOf('.');
        if (dot > 0) name = name.substring(0, dot);
        name = name.trim();
        return name.isBlank() ? "Untitled" : name;
    }

    private JsonNode convertBlock(Node node) {
        if (node instanceof Heading h) {
            ObjectNode n = mapper.createObjectNode();
            n.put("type", "heading");
            ObjectNode attrs = mapper.createObjectNode();
            attrs.put("level", Math.min(Math.max(h.getLevel(), 1), 6));
            n.set("attrs", attrs);
            ArrayNode content = mapper.createArrayNode();
            collectInlines(h, content, new ArrayList<>());
            if (!content.isEmpty()) n.set("content", content);
            return n;
        }
        if (node instanceof Paragraph) {
            ObjectNode n = mapper.createObjectNode();
            n.put("type", "paragraph");
            ArrayNode content = mapper.createArrayNode();
            collectInlines(node, content, new ArrayList<>());
            if (!content.isEmpty()) n.set("content", content);
            return n;
        }
        if (node instanceof BulletList || node instanceof OrderedList) {
            if (node instanceof BulletList && isTaskList((BulletList) node)) {
                return convertTaskList((BulletList) node);
            }
            ObjectNode n = mapper.createObjectNode();
            n.put("type", node instanceof BulletList ? "bulletList" : "orderedList");
            ArrayNode items = mapper.createArrayNode();
            Node c = node.getFirstChild();
            while (c != null) {
                if (c instanceof ListItem li) {
                    ObjectNode item = mapper.createObjectNode();
                    item.put("type", "listItem");
                    ArrayNode itemContent = mapper.createArrayNode();
                    Node ic = li.getFirstChild();
                    while (ic != null) {
                        JsonNode b = convertBlock(ic);
                        if (b != null) itemContent.add(b);
                        ic = ic.getNext();
                    }
                    if (itemContent.isEmpty()) itemContent.add(emptyParagraph());
                    item.set("content", itemContent);
                    items.add(item);
                }
                c = c.getNext();
            }
            n.set("content", items);
            return n;
        }
        if (node instanceof BlockQuote) {
            ObjectNode n = mapper.createObjectNode();
            n.put("type", "blockquote");
            ArrayNode content = mapper.createArrayNode();
            Node c = node.getFirstChild();
            while (c != null) {
                JsonNode b = convertBlock(c);
                if (b != null) content.add(b);
                c = c.getNext();
            }
            if (content.isEmpty()) content.add(emptyParagraph());
            n.set("content", content);
            return n;
        }
        if (node instanceof FencedCodeBlock fcb) {
            ObjectNode n = mapper.createObjectNode();
            n.put("type", "codeBlock");
            String lang = fcb.getInfo();
            if (lang != null && !lang.isBlank()) {
                ObjectNode attrs = mapper.createObjectNode();
                attrs.put("language", lang);
                n.set("attrs", attrs);
            }
            String lit = fcb.getLiteral();
            if (lit != null && !lit.isEmpty()) {
                ArrayNode content = mapper.createArrayNode();
                content.add(textNode(lit, List.of()));
                n.set("content", content);
            }
            return n;
        }
        if (node instanceof IndentedCodeBlock icb) {
            ObjectNode n = mapper.createObjectNode();
            n.put("type", "codeBlock");
            String lit = icb.getLiteral();
            if (lit != null && !lit.isEmpty()) {
                ArrayNode content = mapper.createArrayNode();
                content.add(textNode(lit, List.of()));
                n.set("content", content);
            }
            return n;
        }
        if (node instanceof ThematicBreak) {
            ObjectNode n = mapper.createObjectNode();
            n.put("type", "horizontalRule");
            return n;
        }
        String text = inlineText(node);
        if (text.isBlank()) return null;
        ObjectNode n = mapper.createObjectNode();
        n.put("type", "paragraph");
        ArrayNode content = mapper.createArrayNode();
        content.add(textNode(text, List.of()));
        n.set("content", content);
        return n;
    }

    private void collectInlines(Node parent, ArrayNode out, List<ObjectNode> marks) {
        collectInlines(parent, out, marks, false);
    }

    private static final Pattern TASK_PREFIX = Pattern.compile("^\\s*\\[([ xX])\\]\\s*");

    /** GFM task lists: commonmark-java (without the ext) leaves `[ ] ` as plain text. */
    private boolean isTaskList(BulletList list) {
        Node c = list.getFirstChild();
        boolean any = false;
        while (c != null) {
            if (c instanceof ListItem li) {
                String first = firstItemText(li);
                if (first == null || !TASK_PREFIX.matcher(first).find()) return false;
                any = true;
            }
            c = c.getNext();
        }
        return any;
    }

    private String firstItemText(ListItem li) {
        Node first = li.getFirstChild();
        if (!(first instanceof Paragraph)) return null;
        return inlineText(first);
    }

    private JsonNode convertTaskList(BulletList list) {
        ObjectNode n = mapper.createObjectNode();
        n.put("type", "taskList");
        ArrayNode items = mapper.createArrayNode();
        Node c = list.getFirstChild();
        while (c != null) {
            if (c instanceof ListItem li) {
                String first = firstItemText(li);
                boolean checked = first != null && first.trim().toLowerCase(Locale.ROOT).startsWith("[x]");
                ObjectNode item = mapper.createObjectNode();
                item.put("type", "taskItem");
                ObjectNode attrs = mapper.createObjectNode();
                attrs.put("checked", checked);
                item.set("attrs", attrs);

                ArrayNode itemContent = mapper.createArrayNode();
                Node ic = li.getFirstChild();
                boolean firstBlock = true;
                while (ic != null) {
                    JsonNode b;
                    if (firstBlock && ic instanceof Paragraph) {
                        ObjectNode para = mapper.createObjectNode();
                        para.put("type", "paragraph");
                        ArrayNode content = mapper.createArrayNode();
                        collectInlines(ic, content, new ArrayList<>(), true);
                        if (!content.isEmpty()) para.set("content", content);
                        b = para;
                    } else if (ic instanceof BulletList nested && isTaskList(nested)) {
                        b = convertTaskList(nested);
                    } else {
                        b = convertBlock(ic);
                    }
                    if (b != null) itemContent.add(b);
                    firstBlock = false;
                    ic = ic.getNext();
                }
                if (itemContent.isEmpty()) itemContent.add(emptyParagraph());
                item.set("content", itemContent);
                items.add(item);
            }
            c = c.getNext();
        }
        n.set("content", items);
        return n;
    }

    private void collectInlines(Node parent, ArrayNode out, List<ObjectNode> marks, boolean stripTaskPrefix) {
        Node c = parent.getFirstChild();
        boolean stripPending = stripTaskPrefix;
        while (c != null) {
            if (c instanceof Text t) {
                String literal = t.getLiteral();
                if (stripPending) {
                    Matcher tm = TASK_PREFIX.matcher(literal);
                    if (tm.find()) {
                        literal = literal.substring(tm.end());
                        stripPending = false;
                    }
                }
                if (!literal.isEmpty()) out.add(textNode(literal, marks));
            } else if (c instanceof StrongEmphasis) {
                List<ObjectNode> m2 = appendMark(marks, "bold");
                collectInlines(c, out, m2);
            } else if (c instanceof Emphasis) {
                List<ObjectNode> m2 = appendMark(marks, "italic");
                collectInlines(c, out, m2);
            } else if (c instanceof Code code) {
                if (!code.getLiteral().isEmpty()) {
                    out.add(textNode(code.getLiteral(), appendMark(marks, "code")));
                }
            } else if (c instanceof Link link) {
                ObjectNode linkMark = mapper.createObjectNode();
                linkMark.put("type", "link");
                ObjectNode attrs = mapper.createObjectNode();
                attrs.put("href", link.getDestination() == null ? "" : link.getDestination());
                if (link.getTitle() != null) attrs.put("title", link.getTitle());
                linkMark.set("attrs", attrs);
                List<ObjectNode> m2 = new ArrayList<>(marks);
                m2.add(linkMark);
                collectInlines(c, out, m2);
            } else if (c instanceof Image img) {
                String alt = inlineText(img);
                String label = alt.isBlank() ? (img.getDestination() == null ? "image" : img.getDestination()) : alt;
                out.add(textNode("[" + label + "]", marks));
            } else if (c instanceof HardLineBreak || c instanceof SoftLineBreak) {
                ObjectNode br = mapper.createObjectNode();
                br.put("type", "hardBreak");
                out.add(br);
            } else if (c instanceof HtmlInline html) {
                if (!html.getLiteral().isEmpty()) out.add(textNode(html.getLiteral(), marks));
            } else {
                collectInlines(c, out, marks);
            }
            c = c.getNext();
        }
    }

    private List<ObjectNode> appendMark(List<ObjectNode> marks, String type) {
        List<ObjectNode> n = new ArrayList<>(marks);
        ObjectNode m = mapper.createObjectNode();
        m.put("type", type);
        n.add(m);
        return n;
    }

    private ObjectNode textNode(String text, List<ObjectNode> marks) {
        ObjectNode n = mapper.createObjectNode();
        n.put("type", "text");
        n.put("text", text);
        if (marks != null && !marks.isEmpty()) {
            ArrayNode arr = mapper.createArrayNode();
            for (ObjectNode m : marks) arr.add(m.deepCopy());
            n.set("marks", arr);
        }
        return n;
    }

    private ObjectNode emptyParagraph() {
        ObjectNode p = mapper.createObjectNode();
        p.put("type", "paragraph");
        return p;
    }

    private String inlineText(Node node) {
        StringBuilder sb = new StringBuilder();
        Node c = node.getFirstChild();
        while (c != null) {
            if (c instanceof Text t) sb.append(t.getLiteral());
            else if (c instanceof Code code) sb.append(code.getLiteral());
            else if (c instanceof SoftLineBreak || c instanceof HardLineBreak) sb.append(' ');
            else sb.append(inlineText(c));
            c = c.getNext();
        }
        return sb.toString();
    }

    private String extractPlain(Node root) {
        StringBuilder sb = new StringBuilder();
        walkPlain(root, sb);
        return sb.toString();
    }

    private void walkPlain(Node node, StringBuilder sb) {
        Node c = node.getFirstChild();
        while (c != null) {
            if (c instanceof Text t) { sb.append(t.getLiteral()).append(' '); }
            else if (c instanceof Code code) { sb.append(code.getLiteral()).append(' '); }
            else if (c instanceof SoftLineBreak || c instanceof HardLineBreak) sb.append('\n');
            else if (c instanceof Paragraph || c instanceof Heading || c instanceof ListItem || c instanceof BlockQuote) {
                walkPlain(c, sb); sb.append('\n');
            } else walkPlain(c, sb);
            c = c.getNext();
        }
    }

    private void detectFromFrontmatter(Map<String, List<String>> fm, Map<String, Candidate> out) {
        addAll(fm.get("tags"), "TOPIC", "HIGH", out);
        addAll(fm.get("topics"), "TOPIC", "HIGH", out);
        addAll(fm.get("people"), "PERSON", "HIGH", out);
        addAll(fm.get("person"), "PERSON", "HIGH", out);
        addAll(fm.get("project"), "PROJECT", "HIGH", out);
        addAll(fm.get("projects"), "PROJECT", "HIGH", out);
    }

    private void addAll(List<String> values, String type, String confidence, Map<String, Candidate> out) {
        if (values == null) return;
        for (String raw : values) {
            if (raw == null) continue;
            for (String piece : raw.replaceAll("[\\[\\]]", "").split(",")) {
                String name = piece.trim().replaceAll("^[\"']|[\"']$", "");
                if (!name.isBlank()) bump(out, name, type, confidence);
            }
        }
    }

    private void detectFromPlain(String text, Map<String, Candidate> out) {
        if (text == null || text.isBlank()) return;
        Matcher m = WIKI_LINK.matcher(text);
        while (m.find()) {
            String name = m.group(1).trim();
            if (!name.isBlank()) bump(out, name, "TOPIC", "HIGH");
        }
        m = HASHTAG.matcher(text);
        while (m.find()) {
            String name = m.group(1).trim();
            if (!name.isBlank()) bump(out, capitalize(name), "TOPIC", "HIGH");
        }
        m = PROPER_NOUN.matcher(text);
        while (m.find()) {
            StringBuilder name = new StringBuilder(m.group(1));
            int words = 1;
            if (m.group(2) != null) { name.append(' ').append(m.group(2)); words++; }
            if (m.group(3) != null) { name.append(' ').append(m.group(3)); words++; }
            String full = name.toString();
            String lower = m.group(1).toLowerCase(Locale.ROOT);
            if (words == 1 && STOPLIST.contains(lower)) continue;
            if (isSentenceStart(text, m.start())) continue;
            String type = words == 1 ? "PERSON" : "PROJECT";
            bump(out, full, type, "LOW");
        }

        m = MULTI_WORD_NAME.matcher(text);
        while (m.find()) {
            String first = m.group(1);
            String second = m.group(2);
            String third = m.group(3);
            if (!startsWithUppercase(first) && !startsWithUppercase(second)) continue;

            StringBuilder name = new StringBuilder(first).append(' ').append(second);
            if (third != null) name.append(' ').append(third);
            if (isNoisePhrase(name.toString())) continue;
            bump(out, name.toString(), "PERSON", "MEDIUM");
        }
    }

    private boolean startsWithUppercase(String value) {
        return value != null && !value.isBlank() && Character.isUpperCase(value.codePointAt(0));
    }

    private boolean isNoisePhrase(String name) {
        return Arrays.stream(name.split("\\s+"))
                .map(word -> stripAccents(word).toLowerCase(Locale.ROOT))
                .anyMatch(word -> STOPLIST.contains(word) || NOISE.contains(word));
    }

    private boolean isSentenceStart(String text, int pos) {
        int i = pos - 1;
        while (i >= 0 && Character.isWhitespace(text.charAt(i))) i--;
        if (i < 0) return true;
        char c = text.charAt(i);
        return c == '.' || c == '!' || c == '?' || c == ':' || c == ';'
                || c == '-' || c == '•' || c == '*' || c == '|';
    }

    private void bump(Map<String, Candidate> out, String name, String type, String confidence) {
        String key = name.toLowerCase(Locale.ROOT).trim();
        if (key.length() < 2 || key.length() > 80) return;
        Candidate existing = out.get(key);
        if (existing == null) {
            out.put(key, new Candidate(key, name, type, 1, confidence));
        } else {
            String conf = mergeConfidence(existing.confidence(), confidence);
            out.put(key, new Candidate(key, existing.name(), existing.suggestedType(), existing.occurrences() + 1, conf));
        }
    }

    private String mergeConfidence(String first, String second) {
        if ("HIGH".equals(first) || "HIGH".equals(second)) return "HIGH";
        if ("MEDIUM".equals(first) || "MEDIUM".equals(second)) return "MEDIUM";
        return "LOW";
    }

    private String capitalize(String s) {
        if (s == null || s.isEmpty()) return s;
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}