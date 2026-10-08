package onl.continuum.continuum.application.service;

import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Caching;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import onl.continuum.continuum.controller.dto.timetracking.*;
import onl.continuum.continuum.domain.timetracking.*;
import onl.continuum.continuum.infra.repository.TimeEntryRepository;
import onl.continuum.continuum.infra.repository.TimerSessionRepository;

import onl.continuum.continuum.domain.plan.PlanConfiguration;
import onl.continuum.continuum.domain.plan.PlanType;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Comparator;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class TimeTrackingService {

    private final TimeEntryRepository timeEntryRepository;
    private final TimerSessionRepository timerSessionRepository;
    private final PlanConfiguration planConfig;
    private final UserRepository userRepo;

    private LocalDate getDefaultStartDate(String userId) {
        User user = userRepo.findById(userId).orElseThrow();
        if (user.getPlan() == PlanType.FREE) {
            return onl.continuum.continuum.infra.web.RequestZone.today().minusMonths(3);
        }
        return null;
    }

    /**
     * Start a new timer for an entity
     */
    @Transactional
    public TimerSessionResponse startTimer(String userId, String vaultId, StartTimerRequest request) {
        // Stop any other active timers for this entity (prevent multiple timers)
        timerSessionRepository.findByUserIdAndEntityIdAndStatus(
                userId, request.getEntityId(), TimerStatus.RUNNING
        ).ifPresent(existing -> {
            existing.setStatus(TimerStatus.ABANDONED);
            existing.setUpdatedAt(Instant.now());
            timerSessionRepository.save(existing);
        });

        // Create new timer session
        TimerSession session = TimerSession.builder()
                .userId(userId)
                .entityId(request.getEntityId())
                .vaultId(vaultId)
                .startedAt(Instant.now())
                .status(TimerStatus.RUNNING)
                .createdAt(Instant.now())
                .build();

        TimerSession saved = timerSessionRepository.save(session);
        return TimerSessionResponse.fromEntity(saved);
    }

    /**
     * Stop an active timer and create a time entry
     */
    @Transactional
    @Caching(evict = {
            @CacheEvict(value = "insights:notes", allEntries = true),
            @CacheEvict(value = "insights:entities", allEntries = true)
    })
    public TimeEntryResponse stopTimer(String userId, StopTimerRequest request) {
        TimerSession session = timerSessionRepository.findById(request.getSessionId())
                .orElseThrow(() -> new IllegalArgumentException("Timer session not found"));

        if (!session.getUserId().equals(userId)) {
            throw new SecurityException("Unauthorized access to timer session");
        }

        if (!session.isRunning()) {
            throw new IllegalArgumentException("Timer is not running");
        }

        // If stopping while paused, finalize the paused window first
        if (session.getPausedAt() != null) {
            long pausedDelta = Instant.now().getEpochSecond() - session.getPausedAt().getEpochSecond();
            session.setAccumulatedPausedSeconds(
                    (session.getAccumulatedPausedSeconds() == null ? 0L : session.getAccumulatedPausedSeconds())
                            + Math.max(0L, pausedDelta));
            session.setPausedAt(null);
        }

        session.setStoppedAt(Instant.now());
        long elapsedSeconds = session.getElapsedSeconds();

        TimeEntry entry = TimeEntry.builder()
                .userId(userId)
                .entityId(session.getEntityId())
                .vaultId(session.getVaultId())
                .date(onl.continuum.continuum.infra.web.RequestZone.today())
                .durationSeconds(Math.max(1L, elapsedSeconds))
                .note(request.getNote())
                .source(TimeEntrySource.TIMER)
                .createdAt(Instant.now())
                .build();

        TimeEntry savedEntry = timeEntryRepository.save(entry);

        session.setStatus(TimerStatus.COMPLETED);
        session.setTimeEntryId(savedEntry.getId());
        session.setUpdatedAt(Instant.now());
        timerSessionRepository.save(session);

        return TimeEntryResponse.fromEntity(savedEntry);
    }

    /**
     * Pause an active timer (persists pause moment so elapsed excludes paused time).
     */
    @Transactional
    public TimerSessionResponse pauseTimer(String userId, String sessionId) {
        TimerSession session = timerSessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Timer session not found"));
        if (!session.getUserId().equals(userId)) {
            throw new SecurityException("Unauthorized access to timer session");
        }
        if (!session.isRunning()) {
            throw new IllegalArgumentException("Timer is not running");
        }
        if (session.getPausedAt() == null) {
            session.setPausedAt(Instant.now());
            session.setUpdatedAt(Instant.now());
            timerSessionRepository.save(session);
        }
        return TimerSessionResponse.fromEntity(session);
    }

    /**
     * Resume a paused timer.
     */
    @Transactional
    public TimerSessionResponse resumeTimer(String userId, String sessionId) {
        TimerSession session = timerSessionRepository.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Timer session not found"));
        if (!session.getUserId().equals(userId)) {
            throw new SecurityException("Unauthorized access to timer session");
        }
        if (session.getPausedAt() != null) {
            long delta = Instant.now().getEpochSecond() - session.getPausedAt().getEpochSecond();
            session.setAccumulatedPausedSeconds(
                    (session.getAccumulatedPausedSeconds() == null ? 0L : session.getAccumulatedPausedSeconds())
                            + Math.max(0L, delta));
            session.setPausedAt(null);
            session.setUpdatedAt(Instant.now());
            timerSessionRepository.save(session);
        }
        return TimerSessionResponse.fromEntity(session);
    }


    /**
     * Manually add time to an entity
     */
    @Caching(evict = {
            @CacheEvict(value = "insights:notes", allEntries = true),
            @CacheEvict(value = "insights:entities", allEntries = true)
    })
    public TimeEntryResponse addTime(String userId, String vaultId, AddTimeRequest request) {
        if (request == null) {
            throw new onl.continuum.continuum.application.exception.BadRequestException("Request body is required");
        }
        if (request.getEntityId() == null || request.getEntityId().isBlank()) {
            throw new onl.continuum.continuum.application.exception.BadRequestException("entityId is required");
        }
        if (request.getDurationSeconds() == null || request.getDurationSeconds() <= 0) {
            throw new onl.continuum.continuum.application.exception.BadRequestException("durationSeconds must be positive");
        }
        LocalDate date = request.getDate() != null ? request.getDate() : onl.continuum.continuum.infra.web.RequestZone.today();
        if (date.isAfter(onl.continuum.continuum.infra.web.RequestZone.today())) {
            throw new onl.continuum.continuum.application.exception.BadRequestException("Future dates are not allowed");
        }

        // Fallback vaultId from user record if missing
        String resolvedVaultId = (vaultId != null && !vaultId.isBlank())
                ? vaultId
                : userRepo.findById(userId).map(User::getVaultId).orElse(null);
        if (resolvedVaultId == null || resolvedVaultId.isBlank()) {
            resolvedVaultId = userId; // last-resort fallback to keep @NotBlank happy
        }

        TimeEntry entry = TimeEntry.builder()
                .id(java.util.UUID.randomUUID().toString().replace("-", ""))
                .userId(userId)
                .entityId(request.getEntityId())
                .vaultId(resolvedVaultId)
                .date(date)
                .durationSeconds(request.getDurationSeconds())
                .note(request.getNote())
                .source(TimeEntrySource.MANUAL)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();

        TimeEntry saved = timeEntryRepository.save(entry);
        return TimeEntryResponse.fromEntity(saved);
    }

    /**
     * Get total time spent on an entity
     */
    public TimeEntitySummary getTotalTime(String userId, String vaultId, String entityId) {
        List<TimeEntry> entries = timeEntryRepository.findByUserIdAndEntityIdOrderByDateDesc(userId, entityId);

        long totalSeconds = entries.stream()
                .mapToLong(TimeEntry::getDurationSeconds)
                .sum();

        Optional<TimerSession> activeSession = timerSessionRepository
                .findByUserIdAndEntityIdAndStatus(userId, entityId, TimerStatus.RUNNING);

        String formattedTotal = formatSeconds(totalSeconds);
        double totalHours = totalSeconds / 3600.0;

        return TimeEntitySummary.builder()
                .entityId(entityId)
                .totalSeconds(totalSeconds)
                .formattedTotal(formattedTotal)
                .totalHours(totalHours)
                .entriesCount(entries.size())
                .activeSessionDuration(activeSession.map(TimerSession::getElapsedSeconds).orElse(null))
                .hasActiveTimer(activeSession.isPresent())
                .build();
    }

    /**
     * Get daily breakdown of time spent on an entity
     */
    public Map<LocalDate, TimeEntryResponse> getDailyBreakdown(String userId, String entityId) {
        List<TimeEntry> entries = timeEntryRepository.findByUserIdAndEntityIdOrderByDateDesc(userId, entityId);

        return entries.stream()
                .collect(Collectors.toMap(
                        TimeEntry::getDate,
                        TimeEntryResponse::fromEntity,
                        (existing, updated) -> {
                            // If multiple entries on same day, sum them
                            TimeEntry combined = TimeEntry.builder()
                                    .id(existing.getId())
                                    .userId(existing.getUserId())
                                    .entityId(existing.getEntityId())
                                    .vaultId(existing.getVaultId())
                                    .date(existing.getDate())
                                    .durationSeconds(existing.getDurationSeconds() + updated.getDurationSeconds())
                                    .source(TimeEntrySource.MANUAL)
                                    .createdAt(existing.getCreatedAt())
                                    .build();
                            return TimeEntryResponse.fromEntity(combined);
                        }
                ));
    }

    /**
     * Get time spent on an entity in a date range
     */
    public List<TimeEntryResponse> getTimeInRange(String userId, String entityId, LocalDate from, LocalDate to) {
        LocalDate effectiveFrom = from != null ? from : getDefaultStartDate(userId);
        LocalDate effectiveTo = to != null ? to : onl.continuum.continuum.infra.web.RequestZone.today();
        List<TimeEntry> entries = timeEntryRepository.findByUserIdAndEntityIdAndDateBetweenOrderByDateDesc(
                userId, entityId, effectiveFrom, effectiveTo
        );

        return entries.stream()
                .map(TimeEntryResponse::fromEntity)
                .collect(Collectors.toList());
    }

    /**
     * Get summary for all entities in a vault
     */
    public List<TimeEntitySummary> getAllEntitiesSummary(String userId, String vaultId) {
        List<TimeEntry> allEntries = timeEntryRepository.findByVaultIdOrderByCreatedAtDesc(vaultId);

        return allEntries.stream()
                .collect(Collectors.groupingBy(TimeEntry::getEntityId))
                .entrySet()
                .stream()
                .map(entry -> {
                    String entityId = entry.getKey();
                    List<TimeEntry> entityEntries = entry.getValue();

                    long totalSeconds = entityEntries.stream()
                            .mapToLong(TimeEntry::getDurationSeconds)
                            .sum();

                    Optional<TimerSession> activeTimer = timerSessionRepository
                            .findByUserIdAndEntityIdAndStatus(userId, entityId, TimerStatus.RUNNING);

                    return TimeEntitySummary.builder()
                            .entityId(entityId)
                            .totalSeconds(totalSeconds)
                            .formattedTotal(formatSeconds(totalSeconds))
                            .totalHours(totalSeconds / 3600.0)
                            .entriesCount(entityEntries.size())
                            .activeSessionDuration(activeTimer.map(TimerSession::getElapsedSeconds).orElse(null))
                            .hasActiveTimer(activeTimer.isPresent())
                            .build();
                })
                .sorted(Comparator.comparingLong(TimeEntitySummary::getTotalSeconds).reversed())
                .collect(Collectors.toList());
    }

    /**
     * Delete a time entry
     */
    @Transactional
    @Caching(evict = {
            @CacheEvict(value = "insights:notes", allEntries = true),
            @CacheEvict(value = "insights:entities", allEntries = true)
    })
    public void deleteTimeEntry(String userId, String entryId) {
        TimeEntry entry = timeEntryRepository.findById(entryId)
                .orElseThrow(() -> new IllegalArgumentException("Time entry not found"));

        if (!entry.getUserId().equals(userId)) {
            throw new SecurityException("Unauthorized access to time entry");
        }

        timeEntryRepository.deleteById(entryId);
    }

    /**
     * Get active timer for an entity
     */
    public Optional<TimerSessionResponse> getActiveTimer(String userId, String entityId) {
        return timerSessionRepository.findByUserIdAndEntityIdAndStatus(userId, entityId, TimerStatus.RUNNING)
                .map(TimerSessionResponse::fromEntity);
    }

    /**
     * Get all active timers for a user
     */
    public List<TimerSessionResponse> getAllActiveTimers(String userId) {
        return timerSessionRepository.findByUserIdAndStatus(userId, TimerStatus.RUNNING)
                .stream()
                .map(TimerSessionResponse::fromEntity)
                .collect(Collectors.toList());
    }

    /**
     * Recover interrupted timer session
     */
    @Transactional
    public TimeEntryResponse recoverSession(String userId, String entityId) {
        TimerSession lastSession = timerSessionRepository
                .findFirstByUserIdAndEntityIdOrderByCreatedAtDesc(userId, entityId)
                .orElseThrow(() -> new IllegalArgumentException("No previous session found"));

        if (lastSession.getStatus() == TimerStatus.ABANDONED) {
            // Create entry from abandoned session
            long elapsedSeconds = lastSession.getElapsedSeconds();

            TimeEntry entry = TimeEntry.builder()
                    .userId(userId)
                    .entityId(entityId)
                    .vaultId(lastSession.getVaultId())
                    .date(onl.continuum.continuum.infra.web.RequestZone.today())
                    .durationSeconds(elapsedSeconds)
                    .note("Recovered from interrupted session")
                    .source(TimeEntrySource.RECOVERED)
                    .createdAt(Instant.now())
                    .build();

            TimeEntry saved = timeEntryRepository.save(entry);

            lastSession.setStatus(TimerStatus.COMPLETED);
            lastSession.setTimeEntryId(saved.getId());
            timerSessionRepository.save(lastSession);

            return TimeEntryResponse.fromEntity(saved);
        }

        throw new IllegalArgumentException("Previous session is not in abandoned state");
    }

    /**
     * Cleanup: Delete all time entries for an entity when it's deleted
     */
    @Transactional
    @Caching(evict = {
            @CacheEvict(value = "insights:notes", allEntries = true),
            @CacheEvict(value = "insights:entities", allEntries = true)
    })
    public void deleteEntityTimeData(String entityId) {
        timeEntryRepository.deleteByEntityId(entityId);
        timerSessionRepository.deleteByEntityId(entityId);
    }

    /**
     * All entries for the user in a date range (any entity). Used for heatmap/today views.
     */
    public List<TimeEntryResponse> getAllInRange(String userId, LocalDate from, LocalDate to) {
        LocalDate effectiveFrom = from != null ? from : onl.continuum.continuum.infra.web.RequestZone.today().minusYears(1);
        LocalDate effectiveTo = to != null ? to : onl.continuum.continuum.infra.web.RequestZone.today();
        return timeEntryRepository.findByUserIdAndArchivedAtIsNull(userId).stream()
                .filter(e -> e.getDate() != null
                        && !e.getDate().isBefore(effectiveFrom)
                        && !e.getDate().isAfter(effectiveTo))
                .sorted(Comparator.comparing(TimeEntry::getDate).reversed())
                .map(TimeEntryResponse::fromEntity)
                .collect(Collectors.toList());
    }

    /**
     * All entries today across all entities.
     */
    public List<TimeEntryResponse> getToday(String userId) {
        LocalDate today = onl.continuum.continuum.infra.web.RequestZone.today();
        return timeEntryRepository.findByUserIdAndArchivedAtIsNull(userId).stream()
                .filter(e -> today.equals(e.getDate()))
                .sorted(Comparator.comparing(TimeEntry::getCreatedAt,
                        Comparator.nullsLast(Comparator.reverseOrder())))
                .map(TimeEntryResponse::fromEntity)
                .collect(Collectors.toList());
    }

    /**
     * Helper: Format seconds to HH:MM:SS
     */
    private String formatSeconds(long seconds) {
        long hours = seconds / 3600;
        long minutes = (seconds % 3600) / 60;
        long secs = seconds % 60;
        return String.format("%02d:%02d:%02d", hours, minutes, secs);
    }
}

