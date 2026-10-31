package onl.continuum.continuum.application.service;

import org.springframework.stereotype.Service;
import onl.continuum.continuum.application.exception.NotFoundException;

import onl.continuum.continuum.controller.dto.metrics.DashboardMetrics;
import onl.continuum.continuum.controller.dto.metrics.EntityTimeline;
import onl.continuum.continuum.controller.dto.metrics.MentionEntry;
import onl.continuum.continuum.controller.dto.metrics.TopEntity;
import onl.continuum.continuum.controller.dto.metrics.ScoreTimelineResponse;
import onl.continuum.continuum.domain.connection.NoteReference;
import onl.continuum.continuum.domain.metrics.UserScoreSnapshot;
import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.domain.note.NoteIndex;
import onl.continuum.continuum.domain.plan.PlanConfiguration;
import onl.continuum.continuum.domain.tracking.TrackingEvent;
import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.entity.EntityType;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.persistence.EntityRepository;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.persistence.UserScoreSnapshotRepository;
import onl.continuum.continuum.infra.repository.TimeEntryRepository;
import onl.continuum.continuum.controller.dto.metrics.ScoreInsights;
import onl.continuum.continuum.domain.timetracking.TimeEntry;
import onl.continuum.continuum.infra.vault.VaultDataService;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
public class MetricsService {

    private final UserRepository userRepo;
    private final NoteRepository noteRepo;
    private final EntityRepository entityRepo;
    private final VaultDataService vaultData;
    private final PlanConfiguration planConfig;
    private final EntityService entityService;
    private final UserScoreSnapshotRepository scoreSnapshotRepo;
    private final TimeEntryRepository timeEntryRepo;

    public MetricsService(UserRepository userRepo,
                          NoteRepository noteRepo,
                          EntityRepository entityRepo,
                          VaultDataService vaultData,
                          PlanConfiguration planConfig,
                          EntityService entityService,
                          UserScoreSnapshotRepository scoreSnapshotRepo,
                          TimeEntryRepository timeEntryRepo) {
        this.userRepo   = userRepo;
        this.noteRepo   = noteRepo;
        this.entityRepo = entityRepo;
        this.vaultData  = vaultData;
        this.planConfig = planConfig;
        this.entityService = entityService;
        this.scoreSnapshotRepo = scoreSnapshotRepo;
        this.timeEntryRepo = timeEntryRepo;
    }

    public EntityTimeline getEntityTimeline(String userId, String entityId) {
        User user = getUser(userId);
        // Entity timeline/metrics are available on all plans (FREE and VISION).

        List<NoteReference> refs = vaultData.readRefs(user.getVaultId()).stream()
                .filter(r -> r.getEntityId().equals(entityId))
                .sorted(Comparator.comparing(NoteReference::getDate, Comparator.reverseOrder()))
                .collect(Collectors.toList());

        Map<LocalDate, Long> heatmap = refs.stream()
                .collect(Collectors.groupingBy(NoteReference::getDate, Collectors.counting()));

        Set<String> noteIds = refs.stream().map(NoteReference::getNoteId).collect(Collectors.toSet());
        Map<String, String> noteTitles = vaultData.readNoteIndex(user.getVaultId()).stream()
                .filter(n -> noteIds.contains(n.getId()))
                .collect(Collectors.toMap(NoteIndex::getId, NoteIndex::getTitle));

        List<MentionEntry> mentions = refs.stream()
                .map(r -> new MentionEntry(r.getNoteId(),
                        noteTitles.getOrDefault(r.getNoteId(), "Untitled"),
                        r.getDate(), r.getContext()))
                .collect(Collectors.toList());

        // compute mention frequency
        double freq = 0.0;
        if (!refs.isEmpty()) {
            LocalDate firstDate = refs.stream()
                    .map(NoteReference::getDate)
                    .min(LocalDate::compareTo)
                    .orElse(onl.continuum.continuum.infra.web.RequestZone.today());
            long days = ChronoUnit.DAYS.between(firstDate, onl.continuum.continuum.infra.web.RequestZone.today()) + 1;
            freq = days <= 0 ? 0.0 : ((double) refs.size()) / days;
        }

        return new EntityTimeline(
                entityId,
                refs.isEmpty() ? null : refs.get(0).getEntityType().name(),
                refs.isEmpty() ? null : refs.get(0).getEntityName(),
                refs.size(), heatmap, mentions, freq);
    }

    /**
     * [ARCH-6] Uma leitura do vault, agrupamento em memória.
     */
    public DashboardMetrics getDashboard(String userId) {
        User user = getUser(userId);

        List<Note> notes = noteRepo.findByUserId(userId).stream()
                .filter(n -> onl.continuum.continuum.infra.web.RequestWorkspace.matches(n.getWorkspaceIds())).toList();
        long totalNotes = notes.size();
        long totalEntities = entityRepo.findByUserIdAndArchivedAtIsNull(userId).stream()
                .filter(e -> onl.continuum.continuum.infra.web.RequestWorkspace.matches(e.getWorkspaceIds())).count();
        Map<String, Long> entityMentionCount = notes.stream()
                .filter(note -> note.getEntityIds() != null)
                .flatMap(note -> note.getEntityIds().stream())
                .collect(Collectors.groupingBy(entityId -> entityId, Collectors.counting()));

        long totalMentions = entityMentionCount.values().stream().mapToLong(Long::longValue).sum();

        List<String> topMentionIds = entityMentionCount.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue(Comparator.reverseOrder()))
                .limit(5)
                .map(Map.Entry::getKey)
                .toList();

        Map<String, Entity> entityById = entityRepo.findByIdIn(topMentionIds).stream()
                .collect(Collectors.toMap(Entity::getId, e -> e));

        List<TopEntity> topMentions = topMentionIds.stream()
                .map(id -> {
                    long count = entityMentionCount.getOrDefault(id, 0L);
                    Entity entity = entityById.get(id);
                    String name = entity != null ? entity.getTitle() : "Unknown";
                    String type = entity != null && entity.getType() != null ? entity.getType().name() : "unknown";
                    double mentionFrequency = totalNotes > 0 ? ((double) count / totalNotes) : 0.0;
                    return new TopEntity(type, id, name, count, mentionFrequency);
                })
                .toList();

        List<NoteReference> all = vaultData.readRefs(user.getVaultId());

        Map<String, List<NoteReference>> byType = all.stream()
                .collect(Collectors.groupingBy(ref -> ref.getEntityType().name()));

        List<NoteReference> people   = byType.getOrDefault("person",  List.of());
        List<NoteReference> projects = byType.getOrDefault("project", List.of());
        List<NoteReference> activitiesRefs   = byType.getOrDefault("activity",   List.of());

        long uniquePeople   = people.stream().map(NoteReference::getEntityId).distinct().count();
        long uniqueProjects = projects.stream().map(NoteReference::getEntityId).distinct().count();
        long uniqueHabits   = activitiesRefs.stream().map(NoteReference::getEntityId).distinct().count();

        // global heatmap
        Map<LocalDate, Long> globalHeatmap = all.stream()
                .collect(Collectors.groupingBy(NoteReference::getDate, Collectors.counting()));

        // tracking events preloaded
        List<TrackingEvent> events = vaultData.readTrackingEvents(user.getVaultId());
        LocalDate today = onl.continuum.continuum.infra.web.RequestZone.today();
        LocalDate weekStart = today.with(java.time.DayOfWeek.MONDAY);

        Set<String> completedToday = events.stream()
                .filter(e -> today.equals(e.getDate()))
                .map(TrackingEvent::getEntityId)
                .collect(Collectors.toSet());

        // active activities from entityService
        List<Entity> activities = entityService.listByType(userId, EntityType.ACTIVITY);
        List<String> activitiesCompletedToday = activities.stream()
                .map(Entity::getId)
                .filter(completedToday::contains)
                .collect(Collectors.toList());

        // weekly average completion rate
        Map<String, Long> daysThisWeek = events.stream()
                .filter(e -> !e.getDate().isBefore(weekStart) && !e.getDate().isAfter(today))
                .collect(Collectors.groupingBy(TrackingEvent::getEntityId,
                        Collectors.mapping(TrackingEvent::getDate, Collectors.toSet())))
                .entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, e -> (long) e.getValue().size()));

        double weeklyAverage = 0.0;
        if (!activities.isEmpty()) {
            double sum = 0.0;
            for (Entity h : activities) {
                long days = daysThisWeek.getOrDefault(h.getId(), 0L);
                sum += days / 7.0;
            }
            weeklyAverage = sum / activities.size();
        }

        return new DashboardMetrics(
                uniquePeople, uniqueProjects, uniqueHabits,
                totalMentions,
                totalNotes, totalEntities, topMentions,
                topEntities(people, 5), topEntities(projects, 5), topEntities(activitiesRefs, 5),
                activitiesCompletedToday, weeklyAverage, globalHeatmap);
    }

    public List<ScoreTimelineResponse.ScorePoint> getUserScoreTimeline(String userId) {
        User user = getUser(userId);

        List<ScoreDay> series = buildScoreSeries(user);
        if (series.isEmpty()) {
            return List.of();
        }

        persistSnapshot(user, series);

        return withinHistoryWindow(user, series).stream()
                .map(d -> new ScoreTimelineResponse.ScorePoint(d.date(), round(d.smoothed())))
                .toList();
    }

    /** Explainable score: series with per-day breakdown, contributions, comparison and milestones. */
    public ScoreInsights getScoreInsights(String userId) {
        User user = getUser(userId);
        List<ScoreDay> series = buildScoreSeries(user);

        if (series.isEmpty()) {
            return new ScoreInsights(List.of(), List.of(),
                    new ScoreInsights.Comparison(0, 0, 0, 0, null, 0, 0, true), List.of());
        }

        persistSnapshot(user, series);

        List<ScoreDay> visible = withinHistoryWindow(user, series);

        List<ScoreInsights.Point> points = new ArrayList<>();
        for (int i = 0; i < visible.size(); i++) {
            ScoreDay day = visible.get(i);
            double previous = i == 0 ? day.smoothed() : visible.get(i - 1).smoothed();
            points.add(new ScoreInsights.Point(day.date(), round(day.smoothed()), round(day.raw()),
                    round(day.smoothed() - previous), day.components()));
        }

        ScoreDay last = series.getLast();
        ScoreDay previousDay = series.size() > 1 ? series.get(series.size() - 2) : null;

        return new ScoreInsights(points, buildContributions(last, previousDay),
                buildComparison(series), buildMilestones(series));
    }

    /** Component breakdown for one specific day (used by the chart tooltip / drill-down). */
    public ScoreInsights.Point buildScoreBreakdown(String userId, LocalDate date) {
        List<ScoreDay> series = buildScoreSeries(getUser(userId));
        for (int i = 0; i < series.size(); i++) {
            ScoreDay day = series.get(i);
            if (day.date().equals(date)) {
                double previous = i == 0 ? day.smoothed() : series.get(i - 1).smoothed();
                return new ScoreInsights.Point(day.date(), round(day.smoothed()), round(day.raw()),
                        round(day.smoothed() - previous), day.components());
            }
        }
        return new ScoreInsights.Point(date, 0, 0, 0, Map.of());
    }

    // ── score engine ──────────────────────────────────────────────────────────

    /** Weights (sum = 100). */
    private static final double W_NOTES = 28, W_ENTITIES = 18, W_CONNECTIONS = 19,
            W_FRESHNESS = 10, W_CONTINUITY = 5, W_DAILY = 20;
    private static final double EMA_ALPHA = 0.3;
    private static final double FRESHNESS_FLOOR = 0.12;
    private static final double FRESHNESS_HALF_LIFE = 7.0;

    private record ScoreDay(LocalDate date, double raw, double smoothed, Map<String, Double> components,
                            int notesTouched, int checks, long minutes, int newConnections,
                            long daysIdle, Map<String, String> subjects) {}

    /** Soft saturation: cap × (1 − e^(−value/k)). No hard ceiling, so the curve never flatlines. */
    private static double saturate(double cap, double value, double k) {
        if (value <= 0) return 0.0;
        return cap * (1.0 - Math.exp(-value / k));
    }

    private void persistSnapshot(User user, List<ScoreDay> series) {
        UserScoreSnapshot snapshot = scoreSnapshotRepo.findByUserId(user.getId())
                .orElseGet(UserScoreSnapshot::new);

        Map<String, Double> scoresByDate = snapshot.getScoresByDate() == null
                ? new LinkedHashMap<>()
                : new LinkedHashMap<>(snapshot.getScoresByDate());

        for (ScoreDay day : series) {
            scoresByDate.put(day.date().toString(), round(day.smoothed()));
        }

        snapshot.setUserId(user.getId());
        snapshot.setScoresByDate(scoresByDate);
        snapshot.setUpdatedAt(Instant.now());
        scoreSnapshotRepo.save(snapshot);
    }

    private List<ScoreDay> withinHistoryWindow(User user, List<ScoreDay> series) {
        int historyDays = planConfig.getHistoryDays(user.getPlan());
        LocalDate today = onl.continuum.continuum.infra.web.RequestZone.today();
        LocalDate cutoff = (historyDays == Integer.MAX_VALUE)
                ? today.minusYears(100)
                : today.minusDays(historyDays);
        return series.stream().filter(d -> !d.date().isBefore(cutoff)).toList();
    }

    private List<ScoreDay> buildScoreSeries(User user) {
        String userId = user.getId();
        String vaultId = user.getVaultId();
        java.time.ZoneId zone = onl.continuum.continuum.infra.web.RequestZone.get();

        List<Note> notes = noteRepo.findByUserId(userId).stream()
                .filter(n -> (vaultId == null || vaultId.equals(n.getVaultId())) && onl.continuum.continuum.infra.web.RequestWorkspace.matches(n.getWorkspaceIds()))
                .toList();
        List<Entity> entities = entityRepo.findByUserIdAndArchivedAtIsNull(userId).stream()
                .filter(e -> (vaultId == null || vaultId.equals(e.getVaultId())) && onl.continuum.continuum.infra.web.RequestWorkspace.matches(e.getWorkspaceIds()))
                .toList();
        List<TrackingEvent> trackingEvents = vaultData.readTrackingEvents(vaultId == null ? userId : vaultId).stream()
                .filter(e -> userId.equals(e.getUserId()))
                .toList();
        List<TimeEntry> timeEntries = timeEntryRepo == null
                ? List.of()
                : timeEntryRepo.findByUserIdAndArchivedAtIsNull(userId).stream()
                    .filter(e -> e.getDate() != null && e.getDurationSeconds() != null)
                    .toList();

        Map<String, String> entityTitles = entities.stream()
                .filter(e -> e.getId() != null && e.getTitle() != null)
                .collect(Collectors.toMap(Entity::getId, Entity::getTitle, (a, b) -> a));

        Map<LocalDate, Integer> notesCreatedByDate = new HashMap<>();
        Map<LocalDate, Integer> linkedNotesCreatedByDate = new HashMap<>();
        Map<LocalDate, Integer> entitiesCreatedByDate = new HashMap<>();
        Map<LocalDate, Integer> notesTouchedByDate = new HashMap<>();
        Map<LocalDate, Integer> newConnectionsByDate = new HashMap<>();
        Map<LocalDate, Integer> checksByDate = new HashMap<>();
        Map<LocalDate, Long> minutesByDate = new HashMap<>();
        Map<LocalDate, Map<String, Integer>> noteSubjectByDate = new HashMap<>();
        Map<LocalDate, Map<String, Integer>> checkSubjectByDate = new HashMap<>();
        Map<LocalDate, Map<String, Long>> timeSubjectByDate = new HashMap<>();
        Set<LocalDate> activeTrackingDates = new HashSet<>();

        for (Note note : notes) {
            Instant createdAt = note.getCreatedAt() != null ? note.getCreatedAt() : note.getUpdatedAt();
            LocalDate created = createdAt == null ? null : createdAt.atZone(zone).toLocalDate();
            if (created != null) {
                notesCreatedByDate.merge(created, 1, Integer::sum);
                if (note.getEntityIds() != null && !note.getEntityIds().isEmpty()) {
                    linkedNotesCreatedByDate.merge(created, 1, Integer::sum);
                    newConnectionsByDate.merge(created, note.getEntityIds().size(), Integer::sum);
                }
            }
            LocalDate updated = note.getUpdatedAt() == null ? null : note.getUpdatedAt().atZone(zone).toLocalDate();
            for (LocalDate touched : new LinkedHashSet<>(Arrays.asList(created, updated))) {
                if (touched == null) continue;
                notesTouchedByDate.merge(touched, 1, Integer::sum);
                if (note.getEntityIds() != null) {
                    Map<String, Integer> subjects = noteSubjectByDate.computeIfAbsent(touched, k -> new HashMap<>());
                    for (String entityId : note.getEntityIds()) {
                        String title = entityTitles.get(entityId);
                        if (title != null) subjects.merge(title, 1, Integer::sum);
                    }
                }
            }
        }

        for (Entity entity : entities) {
            if (entity.getCreatedAt() != null) {
                entitiesCreatedByDate.merge(entity.getCreatedAt().atZone(zone).toLocalDate(), 1, Integer::sum);
            }
            if (entity.getTrackingDates() != null) {
                for (LocalDate trackingDate : entity.getTrackingDates()) {
                    if (trackingDate == null) continue;
                    activeTrackingDates.add(trackingDate);
                    checksByDate.merge(trackingDate, 1, Integer::sum);
                    if (entity.getTitle() != null) {
                        checkSubjectByDate.computeIfAbsent(trackingDate, k -> new HashMap<>())
                                .merge(entity.getTitle(), 1, Integer::sum);
                    }
                }
            }
        }

        for (TrackingEvent event : trackingEvents) {
            if (event.getDate() == null) continue;
            activeTrackingDates.add(event.getDate());
            checksByDate.merge(event.getDate(), 1, Integer::sum);
            String title = entityTitles.get(event.getEntityId());
            if (title != null) {
                checkSubjectByDate.computeIfAbsent(event.getDate(), k -> new HashMap<>())
                        .merge(title, 1, Integer::sum);
            }
        }

        for (TimeEntry entry : timeEntries) {
            long minutes = entry.getDurationSeconds() / 60;
            if (minutes <= 0) continue;
            minutesByDate.merge(entry.getDate(), minutes, Long::sum);
            activeTrackingDates.add(entry.getDate());
            String title = entityTitles.get(entry.getEntityId());
            if (title != null) {
                timeSubjectByDate.computeIfAbsent(entry.getDate(), k -> new HashMap<>())
                        .merge(title, minutes, Long::sum);
            }
        }

        LocalDate today = onl.continuum.continuum.infra.web.RequestZone.today();
        LocalDate startDate = Stream.of(
                        notesCreatedByDate.keySet().stream().min(LocalDate::compareTo).orElse(null),
                        notesTouchedByDate.keySet().stream().min(LocalDate::compareTo).orElse(null),
                        entitiesCreatedByDate.keySet().stream().min(LocalDate::compareTo).orElse(null),
                        activeTrackingDates.stream().min(LocalDate::compareTo).orElse(null))
                .filter(Objects::nonNull)
                .min(LocalDate::compareTo)
                .orElse(null);

        if (startDate == null || startDate.isAfter(today)) startDate = today;

        int notesSoFar = 0, linkedNotesSoFar = 0, entitiesSoFar = 0;
        Deque<LocalDate> recentActiveDays = new ArrayDeque<>();
        LocalDate lastActivityDate = null;
        Double ema = null;
        List<ScoreDay> series = new ArrayList<>();

        for (LocalDate cursor = startDate; !cursor.isAfter(today); cursor = cursor.plusDays(1)) {
            notesSoFar += notesCreatedByDate.getOrDefault(cursor, 0);
            linkedNotesSoFar += linkedNotesCreatedByDate.getOrDefault(cursor, 0);
            entitiesSoFar += entitiesCreatedByDate.getOrDefault(cursor, 0);

            int notesTouched = notesTouchedByDate.getOrDefault(cursor, 0);
            int checks = checksByDate.getOrDefault(cursor, 0);
            long minutes = minutesByDate.getOrDefault(cursor, 0L);
            int newConnections = newConnectionsByDate.getOrDefault(cursor, 0);

            boolean activeToday = notesTouched > 0 || checks > 0 || minutes > 0;
            if (activeToday) lastActivityDate = cursor;

            if (activeTrackingDates.contains(cursor) || notesTouched > 0) recentActiveDays.addLast(cursor);
            while (!recentActiveDays.isEmpty() && recentActiveDays.peekFirst().isBefore(cursor.minusDays(29))) {
                recentActiveDays.removeFirst();
            }

            double connectionRatio = notesSoFar == 0 ? 0.0 : (double) linkedNotesSoFar / notesSoFar;
            long daysIdle = lastActivityDate == null ? 0 : ChronoUnit.DAYS.between(lastActivityDate, cursor);

            double dailyRaw = notesTouched * 1.0
                    + checks * 1.5
                    + Math.sqrt(minutes) * 0.9
                    + newConnections * 1.2;

            double notesComponent = saturate(W_NOTES, notesSoFar, 18.0);
            double entitiesComponent = saturate(W_ENTITIES, entitiesSoFar, 10.0);
            double connectionsComponent = saturate(W_CONNECTIONS, connectionRatio, 0.35);
            double freshnessComponent = notesSoFar == 0 && entitiesSoFar == 0
                    ? 0.0
                    : W_FRESHNESS * (FRESHNESS_FLOOR + (1 - FRESHNESS_FLOOR)
                        * Math.exp(-daysIdle / FRESHNESS_HALF_LIFE));
            double continuityComponent = saturate(W_CONTINUITY, recentActiveDays.size(), 8.0);
            double dailyComponent = saturate(W_DAILY, dailyRaw, 6.0);

            double raw = notesComponent + entitiesComponent + connectionsComponent
                    + freshnessComponent + continuityComponent + dailyComponent;

            ema = ema == null ? raw : (EMA_ALPHA * raw + (1 - EMA_ALPHA) * ema);

            Map<String, Double> components = new LinkedHashMap<>();
            components.put("notes", round(notesComponent));
            components.put("entities", round(entitiesComponent));
            components.put("connections", round(connectionsComponent));
            components.put("freshness", round(freshnessComponent));
            components.put("continuity", round(continuityComponent));
            components.put("daily", round(dailyComponent));

            Map<String, String> subjects = new LinkedHashMap<>();
            topKey(noteSubjectByDate.get(cursor)).ifPresent(v -> subjects.put("NOTES", v));
            topKey(checkSubjectByDate.get(cursor)).ifPresent(v -> subjects.put("ACTIVITIES", v));
            topKeyLong(timeSubjectByDate.get(cursor)).ifPresent(v -> subjects.put("TIME", v));

            series.add(new ScoreDay(cursor, round(raw), round(ema), components,
                    notesTouched, checks, minutes, newConnections, daysIdle, subjects));
        }

        return series;
    }

    private static Optional<String> topKey(Map<String, Integer> map) {
        if (map == null || map.isEmpty()) return Optional.empty();
        return map.entrySet().stream().max(Map.Entry.comparingByValue()).map(Map.Entry::getKey);
    }

    private static Optional<String> topKeyLong(Map<String, Long> map) {
        if (map == null || map.isEmpty()) return Optional.empty();
        return map.entrySet().stream().max(Map.Entry.comparingByValue()).map(Map.Entry::getKey);
    }

    /** Splits today's movement into human-readable causes (top 3 by magnitude). */
    private List<ScoreInsights.Contribution> buildContributions(ScoreDay day, ScoreDay previous) {
        List<ScoreInsights.Contribution> out = new ArrayList<>();

        double daily = day.components().getOrDefault("daily", 0.0);
        double partNotes = day.notesTouched() * 1.0;
        double partChecks = day.checks() * 1.5;
        double partTime = Math.sqrt(day.minutes()) * 0.9;
        double partConn = day.newConnections() * 1.2;
        double total = partNotes + partChecks + partTime + partConn;

        if (total > 0 && daily > 0) {
            if (partNotes > 0) out.add(new ScoreInsights.Contribution("NOTES",
                    round(daily * partNotes / total), day.notesTouched(), day.subjects().get("NOTES")));
            if (partChecks > 0) out.add(new ScoreInsights.Contribution("ACTIVITIES",
                    round(daily * partChecks / total), day.checks(), day.subjects().get("ACTIVITIES")));
            if (partTime > 0) out.add(new ScoreInsights.Contribution("TIME",
                    round(daily * partTime / total), (int) day.minutes(), day.subjects().get("TIME")));
            if (partConn > 0) out.add(new ScoreInsights.Contribution("CONNECTIONS",
                    round(daily * partConn / total), day.newConnections(), null));
        }

        if (previous != null) {
            double entitiesDelta = day.components().getOrDefault("entities", 0.0)
                    - previous.components().getOrDefault("entities", 0.0);
            if (entitiesDelta > 0.05) {
                out.add(new ScoreInsights.Contribution("ENTITIES", round(entitiesDelta), 0, null));
            }
            double freshnessDelta = day.components().getOrDefault("freshness", 0.0)
                    - previous.components().getOrDefault("freshness", 0.0);
            if (freshnessDelta < -0.05) {
                out.add(new ScoreInsights.Contribution("IDLE", round(freshnessDelta), (int) day.daysIdle(), null));
            }
        }

        out.sort((a, b) -> Double.compare(Math.abs(b.value()), Math.abs(a.value())));
        return out.stream().limit(3).toList();
    }

    private ScoreInsights.Comparison buildComparison(List<ScoreDay> series) {
        ScoreDay last = series.getLast();
        double current = round(last.smoothed());
        double first = round(series.getFirst().smoothed());

        List<ScoreDay> window = series.size() <= 30 ? series : series.subList(series.size() - 30, series.size());
        double average30 = round(window.stream().mapToDouble(ScoreDay::smoothed).average().orElse(0));
        double percent = average30 <= 0 ? 0 : round((current - average30) / average30 * 100.0);

        LocalDate bestWeekStart = null;
        double bestWeekAverage = 0;
        for (int i = 0; i + 7 <= series.size(); i++) {
            double avg = series.subList(i, i + 7).stream().mapToDouble(ScoreDay::smoothed).average().orElse(0);
            if (avg > bestWeekAverage) {
                bestWeekAverage = avg;
                bestWeekStart = series.get(i).date();
            }
        }

        return new ScoreInsights.Comparison(current, first, average30, percent,
                bestWeekStart, round(bestWeekAverage), series.size(), series.size() < 7);
    }

    private List<ScoreInsights.Milestone> buildMilestones(List<ScoreDay> series) {
        List<ScoreInsights.Milestone> milestones = new ArrayList<>();
        ScoreDay last = series.getLast();

        ScoreDay record = series.stream().max(Comparator.comparingDouble(ScoreDay::smoothed)).orElse(last);
        milestones.add(new ScoreInsights.Milestone("RECORD_HIGH", round(record.smoothed()), record.date(),
                record.date().equals(last.date()) && series.size() > 1));

        int longest = 0, currentStreak = 0;
        LocalDate longestEnd = last.date();
        for (ScoreDay day : series) {
            boolean active = day.notesTouched() > 0 || day.checks() > 0 || day.minutes() > 0;
            if (active) {
                currentStreak++;
                if (currentStreak > longest) {
                    longest = currentStreak;
                    longestEnd = day.date();
                }
            } else {
                currentStreak = 0;
            }
        }
        milestones.add(new ScoreInsights.Milestone("LONGEST_STREAK", longest, longestEnd, longest == currentStreak && longest > 0));
        milestones.add(new ScoreInsights.Milestone("CURRENT_STREAK", currentStreak, last.date(), false));

        for (double threshold : new double[]{50, 75, 90}) {
            for (ScoreDay day : series) {
                if (day.smoothed() >= threshold) {
                    milestones.add(new ScoreInsights.Milestone("THRESHOLD", threshold, day.date(),
                            day.date().equals(last.date())));
                    break;
                }
            }
        }

        return milestones;
    }

    // ── private ───────────────────────────────────────────────────────────────

    private List<TopEntity> topEntities(List<NoteReference> refs, int limit) {
        Map<String, Long>   counts = refs.stream().collect(Collectors.groupingBy(NoteReference::getEntityId, Collectors.counting()));
        Map<String, String> names  = refs.stream().collect(Collectors.toMap(NoteReference::getEntityId, NoteReference::getEntityName, (a, b) -> a));
        Map<String, String> types  = refs.stream().collect(Collectors.toMap(NoteReference::getEntityId, ref -> ref.getEntityType().name(), (a, b) -> a));
        LocalDate today = onl.continuum.continuum.infra.web.RequestZone.today();
        return counts.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .limit(limit)
                .map(e -> {
                    String id = e.getKey();
                    long count = e.getValue();
                    // compute first mention date for frequency
                    LocalDate firstDate = refs.stream()
                            .filter(r -> r.getEntityId().equals(id))
                            .map(NoteReference::getDate)
                            .min(LocalDate::compareTo)
                            .orElse(today);
                    long days = ChronoUnit.DAYS.between(firstDate, today) + 1;
                    double freq = days <= 0 ? 0.0 : ((double) count) / days;
                    return new TopEntity(types.get(id), id, names.get(id), count, freq);
                })
                .collect(Collectors.toList());
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    private User getUser(String userId) {
        return userRepo.findById(userId).orElseThrow(() -> new NotFoundException("User not found"));
    }

    public Map<LocalDate, Long> getGlobalMentionsHeatmap(String userId, LocalDate from, LocalDate to) {
        User user = getUser(userId);
        return vaultData.readRefs(user.getVaultId()).stream()
                .filter(r -> (from == null || !r.getDate().isBefore(from))
                        && (to == null || !r.getDate().isAfter(to)))
                .collect(Collectors.groupingBy(NoteReference::getDate, Collectors.counting()));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION — AuthService
// ─────────────────────────────────────────────────────────────────────────────
