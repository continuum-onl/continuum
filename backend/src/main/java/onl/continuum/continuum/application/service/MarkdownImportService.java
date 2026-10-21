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
 * Parses Markdown files into Tiptap JSON and proposes entities from corpus statistics.
 * Used by the import flow — no DB access here, pure transformation.
 */
@Slf4j
@Service
public class MarkdownImportService {

    private final ObjectMapper mapper = new ObjectMapper();
    private final Parser parser;

    private static final Pattern WIKI_LINK = Pattern.compile("\\[\\[([^\\]|]+)(?:\\|[^\\]]+)?\\]\\]");
    private static final Pattern MARKDOWN_FENCE = Pattern.compile("^ {0,3}(`{3,}|~{3,}).*$");
    private static final Pattern HASHTAG = Pattern.compile("(?<![\\w/#])#([\\p{L}][\\p{L}0-9_-]{1,40})");
    private static final Pattern WORD = Pattern.compile("[\\p{L}][\\p{L}\\p{M}'’-]*");
    // Explicit wiki links, tags and frontmatter bypass these statistical-only rules.
    private static final Set<String> BOUNDARY_WORDS = Set.of(
            "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
            "em", "no", "na", "nos", "nas", "por", "para", "pelo", "pela", "pelos", "pelas",
            "ao", "aos", "à", "às", "com", "sem", "e", "ou", "que", "meu", "minha", "meus", "minhas",
            "seu", "sua", "seus", "suas", "nosso", "nossa", "nossos", "nossas",
            "the", "an", "of", "to", "at", "in", "on", "for", "from", "by", "with", "and", "or",
            "my", "your", "his", "her", "its", "our", "their");
    private static final Set<String> NAME_CONNECTORS = Set.of(
            "de", "do", "da", "dos", "das", "e", "of", "the", "and");
    // Capitalization of diary verbs, time words and task labels is not name evidence.
    // Only statistical candidates use this vocabulary; explicit references bypass it.
    private static final Set<String> PROSE_WORDS = Set.of(
            "hoje", "hj", "ontem", "amanhã", "agora", "depois", "antes", "também", "então",
            "foi", "fui", "fiz", "fazer", "faz", "fazia", "voltei", "voltar", "comprei", "comprar",
            "aprender", "aprendi", "criar", "criei", "estudar", "estudei", "trabalhar", "trabalhei",
            "celebrei", "falei", "conversei", "encontrei", "procurei", "retornei", "visitei",
            "revisei", "revisamos", "discutimos", "anotei", "gostei", "vi", "vou", "vamos",
            "eu", "ele", "ela", "eles", "elas", "você", "vocês", "isso", "isto", "essa", "esse",
            "today", "yesterday", "tomorrow", "now", "then", "later", "also", "went", "did", "was",
            "were", "bought", "returned", "learn", "create", "i", "we", "you", "he", "she", "they",
            "hoy", "ayer", "mañana", "ahora", "después", "crear", "aprenderé", "compré", "volví", "yo",
            "aujourd'hui", "hier", "demain", "maintenant", "ensuite", "créer", "apprendre", "je");
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
            List<String> assetReferences,
            String contentHash,
            boolean hasBody,
            String plainText,
            Map<String, Candidate> rawCandidates
    ) {}

    public record Candidate(String key, String name, String suggestedType, int occurrences, String confidence) {}
    private record Token(String value, int start, int end) {}

    public ParsedFile parse(String filename, String markdown) {
        return scoreCorpus(List.of(parseForCorpus(filename, markdown))).get(0);
    }

    ParsedFile parseForCorpus(String filename, String markdown) {
        Node root = parser.parse(expandWikiAssetEmbeds(markdown == null ? "" : markdown));

        YamlFrontMatterVisitor fm = new YamlFrontMatterVisitor();
        root.accept(fm);
        Map<String, List<String>> frontmatter = fm.getData();

        ObjectNode doc = mapper.createObjectNode();
        doc.put("type", "doc");
        ArrayNode topContent = mapper.createArrayNode();
        doc.set("content", topContent);

        Node child = root.getFirstChild();
        while (child != null) {
            for (JsonNode converted : convertBlocks(child)) topContent.add(converted);
            child = child.getNext();
        }
        if (topContent.isEmpty()) {
            topContent.add(emptyParagraph());
        }

        String title = pickTitle(frontmatter, root, filename);

        String plain = extractPlain(root);
        Map<String, Candidate> rawCandidates = new LinkedHashMap<>();
        detectFromFrontmatter(frontmatter, rawCandidates);
        detectExplicitFromPlain(plain, rawCandidates);
        detectStatisticalCandidates(plain, rawCandidates);

        int wordCount = plain.isBlank() ? 0 : plain.trim().split("\\s+").length;
        List<String> assetReferences = collectAssetReferences(root);
        boolean hasBody = !plain.trim().isEmpty() || !assetReferences.isEmpty();
        String hash = sha1(normalizeForHash(plain) + "::" + title);

        ParsedFile rawFile = new ParsedFile(filename, title, doc, List.of(), Map.of(),
                wordCount, assetReferences, hash, hasBody, plain,
                Collections.unmodifiableMap(new LinkedHashMap<>(rawCandidates)));
        return rawFile;
    }

    public List<ParsedFile> scoreCorpus(List<ParsedFile> files) {
        if (files == null || files.isEmpty()) return List.of();

        Map<String, Integer> documentFrequency = new HashMap<>();
        Map<String, Integer> tokenFrequency = new HashMap<>();
        Map<String, Integer> capitalizedTokenFrequency = new HashMap<>();
        int totalTokens = 0;
        for (ParsedFile file : files) {
            Set<String> seen = new HashSet<>();
            for (Token token : tokenize(file.plainText())) {
                String value = token.value().toLowerCase(Locale.ROOT);
                tokenFrequency.merge(value, 1, Integer::sum);
                if (Character.isUpperCase(token.value().codePointAt(0))
                        && !isSentenceStart(file.plainText(), token.start())) {
                    capitalizedTokenFrequency.merge(value, 1, Integer::sum);
                }
                seen.add(value);
                totalTokens++;
            }
            seen.forEach(word -> documentFrequency.merge(word, 1, Integer::sum));
        }

        Map<String, Integer> occurrences = new HashMap<>();
        Map<String, Integer> candidateDocuments = new HashMap<>();
        Map<String, Candidate> representatives = new LinkedHashMap<>();
        for (ParsedFile file : files) {
            for (Candidate candidate : file.rawCandidates().values()) {
                Candidate previous = representatives.get(candidate.key());
                if (previous == null || "HIGH".equals(candidate.confidence())) {
                    representatives.put(candidate.key(), candidate);
                }
                int count = "HIGH".equals(candidate.confidence())
                        ? Math.max(1, countMentions(file.plainText(), candidate.key()))
                        : candidate.occurrences();
                if (count > 0) {
                    occurrences.merge(candidate.key(), count, Integer::sum);
                    candidateDocuments.merge(candidate.key(), 1, Integer::sum);
                }
            }
        }

        Set<String> accepted = new LinkedHashSet<>();
        Map<String, String> confidenceByKey = new HashMap<>();
        Map<String, String> typeByKey = new HashMap<>();
        for (Candidate candidate : representatives.values()) {
            String key = candidate.key();
            int count = occurrences.getOrDefault(key, 0);
            int documents = candidateDocuments.getOrDefault(key, 0);
            if ("HIGH".equals(candidate.confidence())) {
                accepted.add(key);
                confidenceByKey.put(key, "HIGH");
                typeByKey.put(key, candidate.suggestedType());
                continue;
            }
            List<String> words = Arrays.asList(key.split("\\s+"));
            // Single words need at least 3 mentions; phrases at least 2.
            if (count < (words.size() == 1 ? 3 : 2)) continue;

            String contextualType;
            boolean stronglyAssociated = false;
            if (words.size() == 1) {
                int capitalized = capitalizedTokenFrequency.getOrDefault(key, 0);
                // Mostly-lowercase or ubiquitous words are never entities.
                if (capitalized / (double) tokenFrequency.getOrDefault(key, 1) < 0.6
                        || isHighDocumentFrequency(words.get(0), documentFrequency,
                        tokenFrequency, capitalizedTokenFrequency, files.size())
                        || isFrequentToken(words.get(0), tokenFrequency, totalTokens)) {
                    continue;
                }
                contextualType = voteType(files, key);
            } else {
                double npmi = normalizedPointwiseMutualInformation(words, count, tokenFrequency, totalTokens);
                if (npmi < 0.5) continue;
                stronglyAssociated = npmi >= 0.8;
                if (hasHighFrequencyBoundary(words, documentFrequency, tokenFrequency,
                        totalTokens, capitalizedTokenFrequency, files.size())
                        || hasHighFrequencyInternalToken(words, documentFrequency, tokenFrequency,
                        capitalizedTokenFrequency, files.size())) {
                    contextualType = voteType(files, key);
                    if ("TOPIC".equals(contextualType)) continue;
                } else {
                    contextualType = voteType(files, key);
                }
            }
            accepted.add(key);
            confidenceByKey.put(key, documents >= 2 || count >= 4 || stronglyAssociated ? "MEDIUM" : "LOW");
            typeByKey.put(key, contextualType);
        }

        // Prefer complete names; count actual overlapping mentions, not just global frequency.
        List<String> longestFirst = accepted.stream()
                .sorted(Comparator.comparingInt(String::length).reversed()).toList();
        for (String shortKey : longestFirst) {
            Candidate shortCandidate = representatives.get(shortKey);
            if (shortCandidate == null || "HIGH".equals(shortCandidate.confidence())) continue;
            int shortCount = occurrences.getOrDefault(shortKey, 0);
            List<Pattern> containingNames = accepted.stream()
                    .filter(longKey -> longKey.length() > shortKey.length() && containsWholeWord(longKey, shortKey))
                    .map(this::mentionPattern).toList();
            if (containingNames.isEmpty()) continue;
            int covered = 0;
            for (ParsedFile file : files) {
                List<int[]> spans = new ArrayList<>();
                for (Pattern name : containingNames) {
                    Matcher matcher = name.matcher(file.plainText());
                    while (matcher.find()) spans.add(new int[]{matcher.start(), matcher.end()});
                }
                Matcher fragment = mentionPattern(shortKey).matcher(file.plainText());
                while (fragment.find()) {
                    int start = fragment.start();
                    int end = fragment.end();
                    if (spans.stream().anyMatch(span -> span[0] <= start && span[1] >= end)) covered++;
                }
            }
            // A remaining one-off short mention is not enough to invent a second entity.
            int independent = shortCount - covered;
            int requiredIndependent = shortKey.contains(" ") ? 2 : 3;
            if (covered >= Math.ceil(shortCount * 0.8) || independent < requiredIndependent) {
                accepted.remove(shortKey);
            }
        }

        List<ParsedFile> scored = new ArrayList<>(files.size());
        for (ParsedFile file : files) {
            Map<String, Candidate> candidates = new LinkedHashMap<>();
            for (String key : accepted) {
                Candidate raw = file.rawCandidates().get(key);
                if (raw == null) continue;
                int count = "HIGH".equals(raw.confidence())
                        ? Math.max(1, countMentions(file.plainText(), key))
                        : raw.occurrences();
                if (count > 0) {
                    candidates.put(key, new Candidate(key, raw.name(), typeByKey.get(key), count,
                            confidenceByKey.get(key)));
                }
            }
            scored.add(new ParsedFile(file.filename(), file.title(), file.content(),
                    new ArrayList<>(candidates.keySet()), candidates, file.wordCount(),
                    file.assetReferences(), file.contentHash(), file.hasBody(), file.plainText(),
                    file.rawCandidates()));
        }
        return scored;
    }

    private List<String> collectAssetReferences(Node root) {
        LinkedHashSet<String> references = new LinkedHashSet<>();
        collectAssetReferences(root, references);
        return new ArrayList<>(references);
    }

    private void collectAssetReferences(Node node, Set<String> references) {
        if (node instanceof Image image) addAssetReference(image.getDestination(), references);
        if (node instanceof Link link) addAssetReference(link.getDestination(), references);
        Node child = node.getFirstChild();
        while (child != null) {
            collectAssetReferences(child, references);
            child = child.getNext();
        }
    }

    private void addAssetReference(String destination, Set<String> references) {
        if (isSupportedAssetReference(destination)) references.add(destination);
    }

    private String expandWikiAssetEmbeds(String markdown) {
        String[] lines = markdown.split("\n", -1);
        char fence = 0;
        int fenceLength = 0;
        for (int lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            Matcher fenceMatcher = MARKDOWN_FENCE.matcher(lines[lineIndex]);
            if (fence == 0 && fenceMatcher.matches()) {
                String delimiter = fenceMatcher.group(1);
                fence = delimiter.charAt(0);
                fenceLength = delimiter.length();
                continue;
            }
            if (fence != 0) {
                String original = lines[lineIndex];
                String trimmed = original.stripLeading();
                int indentation = original.length() - trimmed.length();
                int delimiterLength = 0;
                while (delimiterLength < trimmed.length() && trimmed.charAt(delimiterLength) == fence) {
                    delimiterLength++;
                }
                if (indentation <= 3 && delimiterLength >= fenceLength
                        && trimmed.substring(delimiterLength).isBlank()) {
                    fence = 0;
                    fenceLength = 0;
                }
                continue;
            }
            lines[lineIndex] = expandWikiAssetEmbedsOutsideCode(lines[lineIndex]);
        }
        return String.join("\n", lines);
    }

    private String expandWikiAssetEmbedsOutsideCode(String line) {
        StringBuilder expanded = new StringBuilder();
        int index = 0;
        while (index < line.length()) {
            if (line.charAt(index) == '`') {
                int runEnd = index;
                while (runEnd < line.length() && line.charAt(runEnd) == '`') runEnd++;
                String delimiter = line.substring(index, runEnd);
                int closing = line.indexOf(delimiter, runEnd);
                if (closing >= 0) {
                    int closingEnd = closing + delimiter.length();
                    expanded.append(line, index, closingEnd);
                    index = closingEnd;
                    continue;
                }
            }
            if (line.startsWith("![[", index)) {
                int closing = line.indexOf("]]", index + 3);
                if (closing >= 0) {
                    String target = line.substring(index + 3, closing);
                    int aliasIndex = target.indexOf('|');
                    String reference = aliasIndex < 0 ? target : target.substring(0, aliasIndex);
                    String alt = aliasIndex < 0 ? "" : target.substring(aliasIndex + 1);
                    if (isSupportedAssetReference(reference)) {
                        expanded.append("![").append(alt).append("](<").append(reference).append(">)");
                        index = closing + 2;
                        continue;
                    }
                }
            }
            expanded.append(line.charAt(index));
            index++;
        }
        return expanded.toString();
    }

    private boolean isSupportedAssetReference(String destination) {
        if (destination == null || destination.isBlank()
                || destination.startsWith("/")
                || destination.startsWith("#")
                || destination.matches("(?i)^[a-z][a-z0-9+.-]*:.*")) {
            return false;
        }
        String path = destination.split("[?#]", 2)[0].toLowerCase(Locale.ROOT);
        return path.matches(".*\\.(jpg|jpeg|png|webp|pdf|mp3|m4a)$");
    }

    private List<JsonNode> convertBlocks(Node node) {
        if (node instanceof Paragraph paragraph && containsImage(paragraph)) {
            return convertParagraphWithImages(paragraph, false);
        }
        JsonNode converted = convertBlock(node);
        return converted == null ? List.of() : List.of(converted);
    }

    private boolean containsImage(Node node) {
        Node child = node.getFirstChild();
        while (child != null) {
            if (child instanceof Image) return true;
            child = child.getNext();
        }
        return false;
    }

    private List<JsonNode> convertParagraphWithImages(Paragraph paragraph, boolean stripTaskPrefix) {
        List<JsonNode> blocks = new ArrayList<>();
        ArrayNode inlineContent = mapper.createArrayNode();
        Node child = paragraph.getFirstChild();
        boolean stripPending = stripTaskPrefix;
        while (child != null) {
            if (child instanceof Image image) {
                appendParagraph(blocks, inlineContent);
                ObjectNode asset = mapper.createObjectNode();
                asset.put("type", "importAsset");
                ObjectNode attrs = mapper.createObjectNode();
                attrs.put("src", image.getDestination() == null ? "" : image.getDestination());
                attrs.put("alt", inlineText(image));
                asset.set("attrs", attrs);
                blocks.add(asset);
            } else {
                stripPending = collectInline(child, inlineContent, new ArrayList<>(), stripPending);
            }
            child = child.getNext();
        }
        appendParagraph(blocks, inlineContent);
        return blocks.isEmpty() ? List.of(emptyParagraph()) : blocks;
    }

    private void appendParagraph(List<JsonNode> blocks, ArrayNode content) {
        if (content.isEmpty()) return;
        ObjectNode paragraph = mapper.createObjectNode();
        paragraph.put("type", "paragraph");
        paragraph.set("content", content.deepCopy());
        blocks.add(paragraph);
        content.removeAll();
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

    private List<Token> tokenize(String text) {
        if (text == null || text.isBlank()) return List.of();
        List<Token> tokens = new ArrayList<>();
        Matcher matcher = WORD.matcher(text);
        while (matcher.find()) {
            tokens.add(new Token(matcher.group(), matcher.start(), matcher.end()));
        }
        return tokens;
    }

    private boolean isSentenceStart(String text, int position) {
        int index = position - 1;
        while (index >= 0 && Character.isWhitespace(text.charAt(index))) {
            if (text.charAt(index) == '\n' || text.charAt(index) == '\r') return true;
            index--;
        }
        // Quotes and task-list checkboxes can precede the first word of a block.
        while (index >= 0 && "\"'“‘[ ]xX".indexOf(text.charAt(index)) >= 0) index--;
        if (index < 0) return true;
        char previous = text.charAt(index);
        return previous == '.' || previous == '!' || previous == '?' || previous == ':'
                || previous == ';' || previous == '-' || previous == '•'
                || previous == '*' || previous == '|';
    }

    private boolean isHighDocumentFrequency(String word, Map<String, Integer> documentFrequency,
                                            Map<String, Integer> tokenFrequency,
                                            Map<String, Integer> capitalizedTokenFrequency, int documents) {
        if (documents < 2 || documentFrequency.getOrDefault(word, 0) / (double) documents < 0.6) {
            return false;
        }
        int occurrences = tokenFrequency.getOrDefault(word, 0);
        int capitalized = capitalizedTokenFrequency.getOrDefault(word, 0);
        return occurrences > 0 && capitalized / (double) occurrences < 0.6;
    }

    private boolean isFrequentToken(String word, Map<String, Integer> tokenFrequency, int totalTokens) {
        return totalTokens > 0 && tokenFrequency.getOrDefault(word, 0) / (double) totalTokens > 0.2;
    }

    private boolean hasHighFrequencyBoundary(List<String> words, Map<String, Integer> documentFrequency,
                                             Map<String, Integer> tokenFrequency, int totalTokens,
                                             Map<String, Integer> capitalizedTokenFrequency, int documents) {
        return isHighDocumentFrequency(words.get(0), documentFrequency, tokenFrequency,
                capitalizedTokenFrequency, documents)
                || isHighDocumentFrequency(words.get(words.size() - 1), documentFrequency, tokenFrequency,
                capitalizedTokenFrequency, documents)
                || isFrequentToken(words.get(0), tokenFrequency, totalTokens)
                || isFrequentToken(words.get(words.size() - 1), tokenFrequency, totalTokens);
    }

    private boolean hasHighFrequencyInternalToken(List<String> words, Map<String, Integer> documentFrequency,
                                                  Map<String, Integer> tokenFrequency,
                                                  Map<String, Integer> capitalizedTokenFrequency, int documents) {
        for (int index = 1; index < words.size() - 1; index++) {
            if (isHighDocumentFrequency(words.get(index), documentFrequency, tokenFrequency,
                    capitalizedTokenFrequency, documents)) return true;
        }
        return false;
    }

    private double normalizedPointwiseMutualInformation(List<String> words, int phraseCount,
                                                         Map<String, Integer> tokenFrequency, int totalTokens) {
        if (phraseCount == 0 || totalTokens == 0) return 0;
        double phraseProbability = phraseCount / (double) totalTokens;
        double independentProbability = 1;
        for (String word : words) {
            double wordProbability = tokenFrequency.getOrDefault(word, 0) / (double) totalTokens;
            if (wordProbability == 0) return 0;
            independentProbability *= wordProbability;
        }
        if (phraseProbability >= 1) return 1;
        double score = Math.log(phraseProbability / independentProbability) / -Math.log(phraseProbability);
        return Math.max(-1, Math.min(1, score));
    }

    private Pattern mentionPattern(String key) {
        String[] words = key.split("\\s+");
        StringJoiner phrase = new StringJoiner("\\s+");
        for (String word : words) phrase.add(Pattern.quote(word));
        return Pattern.compile("(?iu)(?<![\\p{L}\\p{N}_])" + phrase + "(?![\\p{L}\\p{N}_])");
    }

    private boolean containsWholeWord(String phrase, String word) {
        return countMentions(phrase, word) > 0;
    }

    private String voteType(List<ParsedFile> files, String key) {
        Map<String, Integer> votes = new HashMap<>();
        Pattern mention = mentionPattern(key);
        for (ParsedFile file : files) {
            Matcher matcher = mention.matcher(file.plainText());
            while (matcher.find()) {
                String before = file.plainText().substring(Math.max(0, matcher.start() - 50), matcher.start())
                        .toLowerCase(Locale.ROOT).trim();
                String precedingWord = before.replaceAll(".*[^\\p{L}\\p{M}'’-]", "");
                String type = null;
                if (Set.of("com", "para", "with", "amigo", "amiga").contains(precedingWord)) {
                    type = "PERSON";
                } else if (Set.of("projeto", "project", "iniciativa").contains(precedingWord)) {
                    type = "PROJECT";
                } else if (Set.of("empresa", "organização", "organizacao", "equipe", "time")
                        .contains(precedingWord)) {
                    type = "ORGANIZATION";
                }
                if (type != null) votes.merge(type, 1, Integer::sum);
            }
        }
        return votes.entrySet().stream()
                .max(Map.Entry.<String, Integer>comparingByValue()
                        .thenComparing(Map.Entry::getKey))
                .map(Map.Entry::getKey)
                .orElse("TOPIC");
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
                        for (JsonNode b : convertBlocks(ic)) itemContent.add(b);
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
                for (JsonNode b : convertBlocks(c)) content.add(b);
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
                        if (containsImage(ic)) {
                            for (JsonNode block : convertParagraphWithImages((Paragraph) ic, true)) {
                                itemContent.add(block);
                            }
                            firstBlock = false;
                            ic = ic.getNext();
                            continue;
                        }
                        ObjectNode para = mapper.createObjectNode();
                        para.put("type", "paragraph");
                        ArrayNode content = mapper.createArrayNode();
                        collectInlines(ic, content, new ArrayList<>(), true);
                        if (!content.isEmpty()) para.set("content", content);
                        b = para;
                    } else if (ic instanceof BulletList nested && isTaskList(nested)) {
                        itemContent.add(convertTaskList(nested));
                        firstBlock = false;
                        ic = ic.getNext();
                        continue;
                    } else {
                        for (JsonNode block : convertBlocks(ic)) itemContent.add(block);
                        firstBlock = false;
                        ic = ic.getNext();
                        continue;
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
            stripPending = collectInline(c, out, marks, stripPending);
            c = c.getNext();
        }
    }

    private boolean collectInline(Node node, ArrayNode out, List<ObjectNode> marks, boolean stripPending) {
        if (node instanceof Text text) {
            String literal = text.getLiteral();
            if (stripPending) {
                Matcher tm = TASK_PREFIX.matcher(literal);
                if (tm.find()) {
                    literal = literal.substring(tm.end());
                    stripPending = false;
                }
            }
            if (!literal.isEmpty()) out.add(textNode(literal, marks));
        } else if (node instanceof StrongEmphasis) {
            collectInlines(node, out, appendMark(marks, "bold"));
        } else if (node instanceof Emphasis) {
            collectInlines(node, out, appendMark(marks, "italic"));
        } else if (node instanceof Code code) {
            if (!code.getLiteral().isEmpty()) out.add(textNode(code.getLiteral(), appendMark(marks, "code")));
        } else if (node instanceof Link link) {
            ObjectNode linkMark = mapper.createObjectNode();
            linkMark.put("type", "link");
            ObjectNode attrs = mapper.createObjectNode();
            attrs.put("href", link.getDestination() == null ? "" : link.getDestination());
            if (link.getTitle() != null) attrs.put("title", link.getTitle());
            linkMark.set("attrs", attrs);
            List<ObjectNode> nestedMarks = new ArrayList<>(marks);
            nestedMarks.add(linkMark);
            collectInlines(node, out, nestedMarks);
        } else if (node instanceof Image image) {
            String alt = inlineText(image);
            String label = alt.isBlank() ? (image.getDestination() == null ? "image" : image.getDestination()) : alt;
            out.add(textNode("[" + label + "]", marks));
        } else if (node instanceof HardLineBreak || node instanceof SoftLineBreak) {
            ObjectNode br = mapper.createObjectNode();
            br.put("type", "hardBreak");
            out.add(br);
        } else if (node instanceof HtmlInline html) {
            if (!html.getLiteral().isEmpty()) out.add(textNode(html.getLiteral(), marks));
        } else {
            collectInlines(node, out, marks);
        }
        return stripPending;
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

    private void detectExplicitFromPlain(String text, Map<String, Candidate> out) {
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
    }

    private void detectStatisticalCandidates(String text, Map<String, Candidate> out) {
        List<Token> tokens = tokenize(text);
        for (int start = 0; start < tokens.size(); start++) {
            StringBuilder name = new StringBuilder();
            for (int length = 1; length <= 3 && start + length <= tokens.size(); length++) {
                Token token = tokens.get(start + length - 1);
                if (token.value().codePointCount(0, token.value().length()) < 2) break;
                if (length > 1) {
                    Token previous = tokens.get(start + length - 2);
                    String separator = text.substring(previous.end(), token.start());
                    if (!separator.isBlank() || separator.contains("\n") || separator.contains("\r")) break;
                    name.append(' ');
                }
                name.append(token.value());
                if (isProperName(tokens.subList(start, start + length))) {
                    bump(out, name.toString(), "TOPIC", "LOW");
                }
            }
        }
    }

    private boolean isProperName(List<Token> tokens) {
        String first = tokens.get(0).value().toLowerCase(Locale.ROOT);
        String last = tokens.get(tokens.size() - 1).value().toLowerCase(Locale.ROOT);
        if (BOUNDARY_WORDS.contains(first) || BOUNDARY_WORDS.contains(last)) return false;
        for (int index = 0; index < tokens.size(); index++) {
            String word = tokens.get(index).value();
            if (PROSE_WORDS.contains(word.toLowerCase(Locale.ROOT))) return false;
            if (index > 0 && index < tokens.size() - 1
                    && NAME_CONNECTORS.contains(word.toLowerCase(Locale.ROOT))) continue;
            if (!Character.isUpperCase(word.codePointAt(0))) return false;
        }
        return true;
    }

    private void bump(Map<String, Candidate> out, String name, String type, String confidence) {
        String key = name.toLowerCase(Locale.ROOT).trim();
        if (key.length() < 2 || key.length() > 80 || looksLikePathOrUrl(key) || FILE_EXT.matcher(key).find()) return;
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