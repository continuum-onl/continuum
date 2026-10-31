package onl.continuum.continuum.application.service;

import org.springframework.cache.annotation.Cacheable;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import onl.continuum.continuum.controller.dto.entity.EntityResponse;
import onl.continuum.continuum.controller.dto.insights.EntityInsightDTO;
import onl.continuum.continuum.controller.dto.insights.NoteInsightDTO;
import onl.continuum.continuum.controller.dto.note.NoteSummaryDTO;
import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.entity.EntityType;
import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.domain.note.NoteLink;
import onl.continuum.continuum.domain.tracking.TrackingEvent;
import onl.continuum.continuum.domain.timetracking.TimeEntry;
import onl.continuum.continuum.infra.persistence.EntityLinkRepository;
import onl.continuum.continuum.infra.persistence.EntityRepository;
import onl.continuum.continuum.infra.persistence.NoteLinkRepository;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.persistence.TrackingEventRepository;
import onl.continuum.continuum.infra.repository.TimeEntryRepository;
import onl.continuum.continuum.infra.security.CustomUserDetails;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

/**
 * InsightsService — cálculo de "importance score" para Notes e Entities.
 *
 * Resolve o problema do "graveyard of notes" identificando automaticamente
 * o que vale a pena revisitar (Hot) e o que era importante e foi esquecido (Forgotten).
 *
 * Sem IA generativa. Score combina recência, conexões, uso real e continuidade.
 *
 * Cache: scores são cacheados por (userId, vaultId). Invalidar manualmente se necessário.
 */
@Service
public class InsightsService {

    private final NoteRepository noteRepo;
    private final NoteLinkRepository noteLinkRepo;
    private final EntityRepository entityRepo;
    private final EntityLinkRepository entityLinkRepo;
    private final TimeEntryRepository timeEntryRepo;
    private final TrackingEventRepository trackingRepo;

    // Thresholds
    private static final double HIGH_RELEVANCE_THRESHOLD = 40.0;
    private static final long FORGOTTEN_DAYS_THRESHOLD = 6;
    // Adaptive window: young vaults get fast value, mature vaults need real distance.
    private static final long FORGOTTEN_DAYS_YOUNG = 7;
    private static final long FORGOTTEN_DAYS_MATURE = 21;
    private static final int MATURE_VAULT_NOTES = 30;
    // Only the top share of the vault may resurface at once.
    private static final double FORGOTTEN_TOP_SHARE = 0.15;
    private static final double FORGOTTEN_MIN_SCORE = 3.0;
    private static final int DEFAULT_LIMIT = 10;

    // Forgotten Gems tuning ------------------------------------------------
    // Boost applied to entity connections — well-connected notes are the most
    // valuable to resurface even when their raw mention count is low.
    private static final double FORGOTTEN_NOTE_CONN_WEIGHT = 4.5;
    private static final double FORGOTTEN_ENT_REL_WEIGHT = 4.5;
    // Minimum viability: an old note/entity with enough structural value should
    // qualify even if it falls just under FORGOTTEN_MIN_SCORE.
    private static final double FORGOTTEN_VIABILITY_SCORE = 2.0;
    // Guaranteed-inclusion rule: clearly-connected but stale items.
    private static final long FORGOTTEN_STRONG_DAYS = 7;
    private static final int FORGOTTEN_STRONG_CONNECTIONS = 4;

    // Note weights (v2 — boosted for sparse early data)
    private static final double W_NOTE_MENTIONS = 2.5;
    private static final double W_NOTE_RECENT = 5.5;
    private static final double W_NOTE_HOURS = 1.8;
    private static final double W_NOTE_ENTITIES = 3.2;
    private static final double W_NOTE_DAYS = 1.1;

    // Entity weights (unchanged)
    private static final double W_ENT_MENTIONS = 1.6;
    private static final double W_ENT_RECENT = 4.5;
    private static final double W_ENT_HOURS = 3.8;
    private static final double W_ENT_RELATIONS = 2.8;
    private static final double W_ENT_DAYS = 1.0;
        private static final double W_ENT_COMPLETIONS = 2.0;
        private static final double W_ENT_RECENT_COMPLETIONS = 4.0;

    // Exponential decay (v3) — replaces linear decay with floor, which used to
    // plateau around day 67/75 and stopped differentiating recency.
    private static final double NOTE_DECAY_HALFLIFE_DAYS = 21.0;
    private static final double ENT_DECAY_HALFLIFE_DAYS = 28.0;

    // Cap on recent hours a note can inherit from all connected entities.
    private static final double NOTE_INHERITED_HOURS_CAP = 40.0;

    public InsightsService(NoteRepository noteRepo,
                           NoteLinkRepository noteLinkRepo,
                           EntityRepository entityRepo,
                           EntityLinkRepository entityLinkRepo,
                           TimeEntryRepository timeEntryRepo,
                           TrackingEventRepository trackingRepo) {
        this.noteRepo = noteRepo;
        this.noteLinkRepo = noteLinkRepo;
        this.entityRepo = entityRepo;
        this.entityLinkRepo = entityLinkRepo;
        this.timeEntryRepo = timeEntryRepo;
        this.trackingRepo = trackingRepo;
    }

    // ─────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────

    /** Only notes with a real "hot" signal belong to Hot Notes — plain "Active" notes are excluded. */
    static boolean isHotNoteBadge(String badge) {
        return "Hot Right Now".equals(badge) || "High Relevance".equals(badge);
    }

    /** Only entities with a real "hot"/"key" signal belong to Key people & projects. */
    static boolean isHotEntityBadge(String badge) {
        return "Hot Right Now".equals(badge) || "Key Entity".equals(badge);
    }

    public List<NoteInsightDTO> hotNotes(int limit) {
        return computeAllNoteInsights().stream()
                .filter(n -> isHotNoteBadge(n.badge()))
                .sorted(Comparator
                        .comparingInt((NoteInsightDTO n) -> "Hot Right Now".equals(n.badge()) ? 0 : 1)
                        .thenComparing(Comparator.comparingDouble(NoteInsightDTO::score).reversed()))
                .limit(limit > 0 ? limit : DEFAULT_LIMIT)
                .collect(Collectors.toList());
    }

    public List<NoteInsightDTO> forgottenNotes(int limit) {
        List<NoteInsightDTO> all = computeAllNoteInsights();
        long window = all.size() < MATURE_VAULT_NOTES ? FORGOTTEN_DAYS_YOUNG : FORGOTTEN_DAYS_MATURE;
        int cap = Math.max(1, (int) Math.ceil(all.size() * FORGOTTEN_TOP_SHARE));
        int max = Math.min(limit > 0 ? limit : DEFAULT_LIMIT, cap);
        return all.stream()
                .filter(n -> !isHotNoteBadge(n.badge()))
                .filter(n -> n.daysSinceLastInteraction() >= window)
                .filter(InsightsService::hasSubstance)
                .filter(InsightsService::qualifiesAsForgotten)
                .sorted(Comparator.comparingDouble((NoteInsightDTO n) -> baseScoreForForgotten(n)).reversed())
                .limit(max)
                .map(n -> new NoteInsightDTO(
                        n.note(), n.score(), "Worth Revisiting",
                        n.mentionCount(), n.recentMentions(), n.hoursTracked(),
                        n.entityConnections(), n.uniqueDaysReferenced(), n.daysSinceLastInteraction()))
                .collect(Collectors.toList());
    }

    /** Shallow notes (one tag, no history) never resurface. */
    private static boolean hasSubstance(NoteInsightDTO n) {
        return n.entityConnections() >= 2 || n.mentionCount() >= 2 || n.hoursTracked() > 0;
    }

    public List<EntityInsightDTO> hotEntities(int limit) {
        return computeAllEntityInsights().stream()
                .filter(e -> isHotEntityBadge(e.badge()))
                .sorted(Comparator
                        .comparingInt((EntityInsightDTO e) -> "Hot Right Now".equals(e.badge()) ? 0 : 1)
                        .thenComparing(Comparator.comparingDouble(EntityInsightDTO::score).reversed()))
                .limit(limit > 0 ? limit : DEFAULT_LIMIT)
                .collect(Collectors.toList());
    }

    public List<EntityInsightDTO> forgottenEntities(int limit) {
        return computeAllEntityInsights().stream()
                .filter(e -> !isHotEntityBadge(e.badge()))
                .filter(e -> e.daysSinceLastMention() >= FORGOTTEN_DAYS_THRESHOLD)
                .filter(InsightsService::qualifiesAsForgotten)
                .sorted(Comparator.comparingDouble((EntityInsightDTO e) -> baseScoreForForgotten(e)).reversed())
                .limit(limit > 0 ? limit : DEFAULT_LIMIT)
                .map(e -> new EntityInsightDTO(
                        e.entity(), e.score(), "Forgotten Gem",
                        e.mentionCount(), e.recentMentions(), e.hoursTracked(),
                        e.relationsCount(), e.uniqueDaysMentioned(), e.daysSinceLastMention()))
                .collect(Collectors.toList());
    }

    /**
     * A stale note qualifies as a Forgotten Gem if EITHER:
     *  • it clears the normal forgotten score, OR
     *  • it is strongly connected (>= FORGOTTEN_STRONG_CONNECTIONS) and very old
     *    (>= FORGOTTEN_STRONG_DAYS) — guaranteed inclusion, OR
     *  • it has minimum structural viability (some connections/mentions) and clears
     *    the lower viability score — so small/medium vaults surface gems early.
     */
    private static boolean qualifiesAsForgotten(NoteInsightDTO n) {
        double score = baseScoreForForgotten(n);
        if (score >= FORGOTTEN_MIN_SCORE) return true;
        if (n.daysSinceLastInteraction() >= FORGOTTEN_STRONG_DAYS
                && n.entityConnections() >= FORGOTTEN_STRONG_CONNECTIONS) return true;
        boolean hasStructure = n.entityConnections() >= 2 || n.mentionCount() >= 2;
        return hasStructure && score >= FORGOTTEN_VIABILITY_SCORE;
    }

    private static boolean qualifiesAsForgotten(EntityInsightDTO e) {
        double score = baseScoreForForgotten(e);
        if (score >= FORGOTTEN_MIN_SCORE) return true;
        if (e.daysSinceLastMention() >= FORGOTTEN_STRONG_DAYS
                && e.relationsCount() >= FORGOTTEN_STRONG_CONNECTIONS) return true;
        boolean hasStructure = e.relationsCount() >= 2 || e.mentionCount() >= 2;
        return hasStructure && score >= FORGOTTEN_VIABILITY_SCORE;
    }

    // ─────────────────────────────────────────────────────────────
    // CORE COMPUTATION (cached)
    // ─────────────────────────────────────────────────────────────

    @Cacheable(value = "insights:notes", key = "#root.target.cacheKey()")
    public List<NoteInsightDTO> computeAllNoteInsights() {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        LocalDateTime now = LocalDateTime.now();
        LocalDate today = now.toLocalDate();

        List<Note> notes = noteRepo.findByUserId(userId).stream()
                .filter(n -> vaultId.equals(n.getVaultId()) && onl.continuum.continuum.infra.web.RequestWorkspace.matches(n.getWorkspaceIds()))
                .collect(Collectors.toList());

        // Pre-load all backlinks once for the vault
        List<NoteLink> allLinks = noteLinkRepo.findByUserIdAndVaultId(userId, vaultId);
        Map<String, List<NoteLink>> linksByTarget = allLinks.stream()
                .collect(Collectors.groupingBy(NoteLink::getTargetNoteId));

        // Pre-load hours-per-entity so Notes can inherit hours from connected entities.
        // Only *recent* hours (last 30 days) count here.
        LocalDate hoursCutoff30 = today.minusDays(30);
        Map<String, Double> recentHoursByEntity = timeEntryRepo.findByUserIdAndArchivedAtIsNull(userId).stream()
                .filter(te -> te.getDate() != null && !te.getDate().isBefore(hoursCutoff30))
                .collect(Collectors.groupingBy(
                        TimeEntry::getEntityId,
                        Collectors.summingDouble(TimeEntry::getDurationHours)));

        return notes.stream()
                .map(note -> buildNoteInsight(
                        note,
                        linksByTarget.getOrDefault(note.getId(), Collections.emptyList()),
                        recentHoursByEntity,
                        now, today))
                .collect(Collectors.toList());
    }

    @Cacheable(value = "insights:entities", key = "#root.target.cacheKey()")
    public List<EntityInsightDTO> computeAllEntityInsights() {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        LocalDateTime now = LocalDateTime.now();
        LocalDate today = now.toLocalDate();

        List<Entity> entities = entityRepo.findByUserIdAndArchivedAtIsNull(userId).stream()
                .filter(e -> vaultId.equals(e.getVaultId()) && onl.continuum.continuum.infra.web.RequestWorkspace.matches(e.getWorkspaceIds()))
                .collect(Collectors.toList());

        List<Note> notes = noteRepo.findByUserId(userId).stream()
                .filter(n -> vaultId.equals(n.getVaultId()) && onl.continuum.continuum.infra.web.RequestWorkspace.matches(n.getWorkspaceIds()))
                .collect(Collectors.toList());

        // Index: entityId -> notes that mention it
        Map<String, List<Note>> notesByEntity = new HashMap<>();
        for (Note note : notes) {
            if (note.getEntityIds() == null) continue;
            for (String eid : note.getEntityIds()) {
                notesByEntity.computeIfAbsent(eid, k -> new ArrayList<>()).add(note);
            }
        }

        // Pre-load time entries
        List<TimeEntry> allTime = timeEntryRepo.findByUserIdAndArchivedAtIsNull(userId);
        Map<String, Double> hoursByEntity = allTime.stream()
                .collect(Collectors.groupingBy(
                        TimeEntry::getEntityId,
                        Collectors.summingDouble(TimeEntry::getDurationHours)));

        // Pre-load entity-entity links
        Map<String, Long> relationsByEntity = new HashMap<>();
        for (Entity e : entities) {
            long from = entityLinkRepo.findByUserIdAndFromEntityId(userId, e.getId()).size();
            long to = entityLinkRepo.findByUserIdAndToEntityId(userId, e.getId()).size();
            relationsByEntity.put(e.getId(), from + to);
        }

        Map<String, List<TrackingEvent>> trackingByEntity = trackingRepo.findByUserIdAndArchivedAtIsNull(userId).stream()
                .collect(Collectors.groupingBy(TrackingEvent::getEntityId));

        return entities.stream()
                .map(e -> buildEntityInsight(
                        e,
                        notesByEntity.getOrDefault(e.getId(), Collections.emptyList()),
                        hoursByEntity.getOrDefault(e.getId(), 0.0),
                        relationsByEntity.getOrDefault(e.getId(), 0L),
                        trackingByEntity.getOrDefault(e.getId(), Collections.emptyList()),
                        now, today))
                .collect(Collectors.toList());
    }

    // ─────────────────────────────────────────────────────────────
    // FORMULAS
    // ─────────────────────────────────────────────────────────────

    private NoteInsightDTO buildNoteInsight(Note note, List<NoteLink> backlinks,
                                            Map<String, Double> hoursByEntity,
                                            LocalDateTime now, LocalDate today) {
        long mentionCount = backlinks.size();

        Instant cutoff30 = now.minusDays(30).atZone(ZoneId.systemDefault()).toInstant();
        long recentMentions = backlinks.stream()
                .filter(l -> l.getCreatedAt() != null && l.getCreatedAt().isAfter(cutoff30))
                .count();

        // hoursTracked: sum hours from connected entities (proxy)
        double hoursTracked = 0.0;
        if (note.getEntityIds() != null) {
            for (String eid : note.getEntityIds()) {
                hoursTracked += hoursByEntity.getOrDefault(eid, 0.0);
            }
        }
        hoursTracked = Math.min(hoursTracked, NOTE_INHERITED_HOURS_CAP);
        int entityConnections = note.getEntityIds() != null ? note.getEntityIds().size() : 0;

        int uniqueDaysReferenced = (int) backlinks.stream()
                .map(l -> l.getCreatedAt() != null
                        ? l.getCreatedAt().atZone(ZoneOffset.UTC).toLocalDate()
                        : null)
                .filter(Objects::nonNull)
                .distinct()
                .count();

        // Prefer the most recent *real* interaction signal. We combine the latest backlink
        // with the note's own creation date and take the most recent of the two — this avoids
        // relying on updatedAt (bumped by trivial autosaves, which would hide "forgotten" notes)
        // while still not flagging a freshly-created note as forgotten.
        Instant latestBacklinkAt = backlinks.stream()
                .map(NoteLink::getCreatedAt)
                .filter(Objects::nonNull)
                .max(Instant::compareTo)
                .orElse(null);
        Instant createdAt = note.getCreatedAt();
        Instant lastInteraction = null;
        if (latestBacklinkAt != null && createdAt != null) {
            lastInteraction = latestBacklinkAt.isAfter(createdAt) ? latestBacklinkAt : createdAt;
        } else if (latestBacklinkAt != null) {
            lastInteraction = latestBacklinkAt;
        } else if (createdAt != null) {
            lastInteraction = createdAt;
        } else {
            lastInteraction = note.getUpdatedAt();
        }
        if (lastInteraction == null) lastInteraction = Instant.now();
        long daysSinceLastInteraction = ChronoUnit.DAYS.between(
                lastInteraction.atZone(ZoneId.systemDefault()).toLocalDate(), today);

        double base = (mentionCount * W_NOTE_MENTIONS)
                + (recentMentions * W_NOTE_RECENT)
                + (hoursTracked * W_NOTE_HOURS)
                + (entityConnections * W_NOTE_ENTITIES)
                + (uniqueDaysReferenced * W_NOTE_DAYS);

        double decay = Math.exp(-daysSinceLastInteraction / NOTE_DECAY_HALFLIFE_DAYS);
        double score = base * decay;

        String badge = pickNoteBadge(score, daysSinceLastInteraction, recentMentions);

        return new NoteInsightDTO(
                NoteSummaryDTO.from(note), round(score), badge,
                mentionCount, recentMentions, round(hoursTracked),
                entityConnections, uniqueDaysReferenced, daysSinceLastInteraction);
    }

    private EntityInsightDTO buildEntityInsight(Entity entity, List<Note> mentioningNotes,
                                                double hoursTracked, long relationLinks,
                                                List<TrackingEvent> trackingEvents,
                                                LocalDateTime now, LocalDate today) {
        long mentionCount = mentioningNotes.size();

        boolean activity = entity.getType() == EntityType.ACTIVITY;
        Set<LocalDate> completionDates = new HashSet<>();
        if (activity && entity.getTrackingDates() != null) completionDates.addAll(entity.getTrackingDates());
        if (activity) {
            trackingEvents.stream()
                    .filter(e -> e.getDate() != null && e.getNumericValue().doubleValue() > 0)
                    .map(TrackingEvent::getDate)
                    .forEach(completionDates::add);
        }
        long completions = completionDates.size();

        Instant cutoff30 = now.minusDays(30).atZone(ZoneId.systemDefault()).toInstant();
        long recentMentions = mentioningNotes.stream()
                .filter(n -> n.getUpdatedAt() != null && n.getUpdatedAt().isAfter(cutoff30))
                .count();
        long recentCompletions = activity
                ? completionDates.stream()
                        .filter(date -> !date.atStartOfDay(ZoneId.systemDefault()).toInstant().isBefore(cutoff30))
                        .count()
                : 0;

        // Only true entity↔entity links. mentionCount is already weighted via W_ENT_MENTIONS;
        // adding it here used to double-count and inflate noisy entities.
        int relationsCount = (int) relationLinks;

        int uniqueDaysMentioned = (int) mentioningNotes.stream()
                .map(n -> n.getUpdatedAt() != null
                        ? n.getUpdatedAt().atZone(ZoneOffset.UTC).toLocalDate()
                        : null)
                .filter(Objects::nonNull)
                .distinct()
                .count();

        Instant lastMention = mentioningNotes.stream()
                .map(Note::getUpdatedAt)
                .filter(Objects::nonNull)
                .max(Instant::compareTo)
                .orElse(entity.getCreatedAt() != null ? entity.getCreatedAt() : Instant.now());

        Instant lastCompletion = activity
                ? completionDates.stream()
                        .map(date -> date.atStartOfDay(ZoneId.systemDefault()).toInstant())
                        .max(Instant::compareTo)
                        .orElse(null)
                : null;
        if (lastCompletion != null && lastCompletion.isAfter(lastMention)) lastMention = lastCompletion;

        long daysSinceLast = ChronoUnit.DAYS.between(
                lastMention.atZone(ZoneId.systemDefault()).toLocalDate(), today);

        double base = (mentionCount * W_ENT_MENTIONS)
                + (recentMentions * W_ENT_RECENT)
                + (hoursTracked * W_ENT_HOURS)
                + (relationsCount * W_ENT_RELATIONS)
                + (uniqueDaysMentioned * W_ENT_DAYS)
                + (completions * W_ENT_COMPLETIONS)
                + (recentCompletions * W_ENT_RECENT_COMPLETIONS);

        double decay = Math.exp(-daysSinceLast / ENT_DECAY_HALFLIFE_DAYS);
        double score = base * decay;

        String badge = pickEntityBadge(score, daysSinceLast, recentMentions);

        return new EntityInsightDTO(
                EntityResponse.from(entity), round(score), badge,
                mentionCount, recentMentions, hoursTracked,
                relationsCount, uniqueDaysMentioned, daysSinceLast);
    }

    // ─────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────

    private String pickNoteBadge(double score, long daysSinceLast, long recentMentions) {
        if (recentMentions >= 5 && daysSinceLast <= 4) return "Hot Right Now";
        if (score >= HIGH_RELEVANCE_THRESHOLD && daysSinceLast <= 14) return "High Relevance";
        return "Active";
    }

    private String pickEntityBadge(double score, long daysSinceLast, long recentMentions) {
        if (recentMentions >= 5 && daysSinceLast <= 7) return "Hot Right Now";
        if (score >= HIGH_RELEVANCE_THRESHOLD) return "Key Entity";
        if (daysSinceLast >= FORGOTTEN_DAYS_THRESHOLD && score >= FORGOTTEN_MIN_SCORE) return "Worth Revisiting";
        return "Active";
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    /**
     * Base score dedicated to Forgotten Gems — rewards *historical* value (old mentions,
     * tracked hours, connections, continuity) and intentionally ignores recent activity.
     * Weights are tuned higher than the generic Hot weights so genuinely valuable but
     * stale notes clear the (low) FORGOTTEN_MIN_SCORE threshold.
     */
    private static double baseScoreForForgotten(NoteInsightDTO n) {
        double historicalMentions = Math.max(0, n.mentionCount() - n.recentMentions());
        return (historicalMentions * 2.5)
                + (n.hoursTracked() * 1.8)
                + (n.entityConnections() * FORGOTTEN_NOTE_CONN_WEIGHT)
                + (n.uniqueDaysReferenced() * 1.4);
    }

    private static double baseScoreForForgotten(EntityInsightDTO e) {
        double historicalMentions = Math.max(0, e.mentionCount() - e.recentMentions());
        return (historicalMentions * 2.5)
                + (e.hoursTracked() * 1.8)
                + (e.relationsCount() * FORGOTTEN_ENT_REL_WEIGHT)
                + (e.uniqueDaysMentioned() * 1.4);
    }

    public String cacheKey() {
        String ws = onl.continuum.continuum.infra.web.RequestWorkspace.get();
        return getCurrentUserId() + ":" + getCurrentVaultId() + ":" + (ws != null ? ws : "ALL");
    }

    private String getCurrentUserId() {
        Object p = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        if (p instanceof CustomUserDetails u) return u.getUserId();
        throw new IllegalStateException("Authenticated user not found");
    }

    private String getCurrentVaultId() {
        Object p = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        if (p instanceof CustomUserDetails u) return u.getVaultId();
        throw new IllegalStateException("Authenticated user not found");
    }
}