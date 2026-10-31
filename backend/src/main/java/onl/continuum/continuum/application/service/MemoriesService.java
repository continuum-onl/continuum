package onl.continuum.continuum.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.email.EmailService;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.vault.VaultStorageService;
import onl.continuum.continuum.infra.web.RequestWorkspace;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * "Memories" — a scarce, Google-Photos-like daily resurfacing of old notes that
 * hit a time milestone (1, 3, 6 months or yearly anniversaries). Also emails
 * the user once when a rich note turns 6 months, 1 year or another full year.
 */
@Service
public class MemoriesService {

    private static final Logger log = LoggerFactory.getLogger(MemoriesService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    static final int FEED_MAX = 3;
    /** Feed milestones (days). Anniversaries beyond 1 year are handled separately. */
    static final int[] FEED_MILESTONES = {30, 90, 180, 365};
    /** A milestone stays visible within this many days before or after its date. */
    static final int FEED_WINDOW_DAYS = 3;
    /** Notes need at least this many connections to resurface (no shallow notes). */
    static final int MIN_CONNECTIONS_FEED = 2;
    /** Email only for "big" notes: richer than the feed bar. */
    static final int MIN_CONNECTIONS_EMAIL = 3;
    static final int MIN_EXCERPT_CHARS_EMAIL = 80;

    public record Memory(String noteId, String title, String excerpt, String imageUrl,
                         long daysAgo, String milestone, String createdAt) {}

    private final NoteRepository noteRepo;
    private final UserRepository userRepo;
    private final VaultStorageService storage;
    private final EmailService email;

    public MemoriesService(NoteRepository noteRepo, UserRepository userRepo,
                           VaultStorageService storage, EmailService email) {
        this.noteRepo = noteRepo;
        this.userRepo = userRepo;
        this.storage = storage;
        this.email = email;
    }

    // ── Feed ───────────────────────────────────────────────────────────

    public List<Memory> feed(String userId, String vaultId) {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        List<Note> candidates = noteRepo.findByUserId(userId).stream()
                .filter(n -> vaultId == null || vaultId.equals(n.getVaultId()))
                .filter(n -> RequestWorkspace.matches(n.getWorkspaceIds()))
                .filter(n -> n.getCreatedAt() != null && connections(n) >= MIN_CONNECTIONS_FEED)
                .filter(n -> feedMilestone(daysAgo(n, today)) != null)
                .sorted(Comparator.comparingInt(MemoriesService::connections).reversed())
                .toList();

        List<Memory> out = new ArrayList<>();
        for (Note n : candidates) {
            if (out.size() >= FEED_MAX) break;
            Memory m = toMemory(n, today, feedMilestone(daysAgo(n, today)));
            if (m.excerpt().isBlank() && m.imageUrl() == null) continue;
            out.add(m);
        }
        return out;
    }

    // ── Email (daily, 9:17 UTC) ────────────────────────────────────────

    @Scheduled(cron = "0 17 9 * * ?")
    public void sendMilestoneEmails() {
        if (!email.isEnabled()) return;
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        for (User user : userRepo.findAll()) {
            try {
                sendForUser(user, today);
            } catch (Exception e) {
                log.warn("Memory email failed for user {}", user.getId(), e);
            }
        }
    }

    private void sendForUser(User user, LocalDate today) {
        if (user.getEmail() == null || user.getEmail().isBlank()) return;
        // One email per user per day at most: the single strongest note hitting a big milestone today.
        Optional<Note> best = noteRepo.findByUserId(user.getId()).stream()
                .filter(n -> n.getCreatedAt() != null && connections(n) >= MIN_CONNECTIONS_EMAIL)
                .filter(n -> emailMilestone(daysAgo(n, today), createdDate(n), today) != null)
                .max(Comparator.comparingInt(MemoriesService::connections));
        if (best.isEmpty()) return;
        Note n = best.get();
        Memory m = toMemory(n, today, emailMilestone(daysAgo(n, today), createdDate(n), today));
        if (m.excerpt().length() < MIN_EXCERPT_CHARS_EMAIL) return;
        email.sendMemory(user.getEmail(), user.getUsername(), user.getLanguage(), m);
    }

    // ── Milestone rules (pure, tested) ─────────────────────────────────

    /** Returns a milestone key when {@code days} falls inside a feed window, else null. */
    static String feedMilestone(long days) {
        for (int mark : FEED_MILESTONES) {
            if (Math.abs(days - mark) <= FEED_WINDOW_DAYS) return key(mark);
        }
        long years = Math.round(days / 365.0);
        if (years >= 2 && Math.abs(days - years * 365) <= FEED_WINDOW_DAYS) {
            return "y" + years;
        }
        return null;
    }

    /** Email only on the exact day: 6 months, or a calendar anniversary (1y, 2y, ...). */
    static String emailMilestone(long days, LocalDate created, LocalDate today) {
        if (days == 180) return "m6";
        if (created != null && days >= 365
                && created.getMonthValue() == today.getMonthValue()
                && created.getDayOfMonth() == today.getDayOfMonth()) {
            return "y" + (today.getYear() - created.getYear());
        }
        return null;
    }

    private static String key(int mark) {
        return switch (mark) {
            case 30 -> "30d";
            case 90 -> "90d";
            case 180 -> "180d";
            default -> "365d";
        };
    }

    // ── Preview extraction (pure, tested) ──────────────────────────────

    private static final Pattern MD_IMG = Pattern.compile("!\\[[^\\]]*]\\((https?://[^)\\s]+)");
    private static final Pattern HTML_IMG = Pattern.compile("<img[^>]+src=[\"'](https?://[^\"']+)[\"']", Pattern.CASE_INSENSITIVE);

    /** Picks the first meaningful paragraph (> 60 chars) or the first text, trimmed to ~220 chars. */
    static String extractExcerpt(String content) {
        List<String> paragraphs = paragraphs(content);
        String pick = paragraphs.stream().filter(p -> p.length() > 60).findFirst()
                .orElse(paragraphs.isEmpty() ? "" : paragraphs.get(0));
        pick = pick.replaceAll("\\s+", " ").trim();
        if (pick.length() <= 220) return pick;
        int cut = pick.lastIndexOf(' ', 220);
        return pick.substring(0, cut > 120 ? cut : 220) + "…";
    }

    /** First absolute http(s) image in the note (TipTap JSON, Markdown or HTML). */
    static String extractImage(String content) {
        if (content == null || content.isBlank()) return null;
        JsonNode json = parseJson(content);
        if (json != null) {
            String src = findImage(json);
            if (src != null) return src;
        }
        Matcher md = MD_IMG.matcher(content);
        if (md.find()) return md.group(1);
        Matcher html = HTML_IMG.matcher(content);
        if (html.find()) return html.group(1);
        return null;
    }

    private static List<String> paragraphs(String content) {
        List<String> out = new ArrayList<>();
        if (content == null || content.isBlank()) return out;
        JsonNode json = parseJson(content);
        if (json != null) {
            collectBlocks(json, out);
            return out;
        }
        String plain = content.replaceAll("<[^>]*>", "\n")
                .replaceAll("!\\[[^\\]]*]\\([^)]*\\)", "")
                .replaceAll("(?m)^\\s*(#{1,6}|[-*>]|\\d+\\.)\\s*", "")
                .replaceAll("[*_`]", "");
        for (String p : plain.split("\\n\\s*\\n|\\n")) {
            String t = p.trim();
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    private static void collectBlocks(JsonNode node, List<String> out) {
        String type = node.path("type").asText("");
        if (type.equals("paragraph") || type.equals("heading") || type.equals("blockquote")) {
            StringBuilder sb = new StringBuilder();
            collectText(node, sb);
            String t = sb.toString().trim();
            if (!t.isEmpty()) out.add(t);
            return;
        }
        for (JsonNode child : node.path("content")) collectBlocks(child, out);
    }

    private static void collectText(JsonNode node, StringBuilder sb) {
        if (node.has("text")) sb.append(node.get("text").asText());
        else if ("mention".equals(node.path("type").asText())) sb.append(node.path("attrs").path("label").asText(""));
        for (JsonNode child : node.path("content")) collectText(child, sb);
    }

    private static String findImage(JsonNode node) {
        if ("image".equals(node.path("type").asText())) {
            String src = node.path("attrs").path("src").asText("");
            if (src.startsWith("http://") || src.startsWith("https://")) return src;
        }
        for (JsonNode child : node.path("content")) {
            String s = findImage(child);
            if (s != null) return s;
        }
        return null;
    }

    private static JsonNode parseJson(String content) {
        String t = content.trim();
        if (!t.startsWith("{")) return null;
        try { return MAPPER.readTree(t); } catch (Exception e) { return null; }
    }

    // ── Helpers ────────────────────────────────────────────────────────

    private Memory toMemory(Note n, LocalDate today, String milestone) {
        String content = n.getContent();
        if (content == null || content.isBlank()) {
            try {
                content = storage.loadNoteContent(n.getVaultId(), n.getId()).orElse("");
            } catch (Exception e) {
                content = "";
            }
        }
        return new Memory(n.getId(), n.getTitle() == null ? "" : n.getTitle(),
                extractExcerpt(content), extractImage(content),
                daysAgo(n, today), milestone, createdDate(n).toString());
    }

    private static int connections(Note n) {
        return n.getEntityIds() == null ? 0 : n.getEntityIds().size();
    }

    private static LocalDate createdDate(Note n) {
        return n.getCreatedAt().atZone(ZoneOffset.UTC).toLocalDate();
    }

    private static long daysAgo(Note n, LocalDate today) {
        return ChronoUnit.DAYS.between(createdDate(n), today);
    }
}
