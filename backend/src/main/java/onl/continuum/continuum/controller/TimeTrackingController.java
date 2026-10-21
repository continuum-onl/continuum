package onl.continuum.continuum.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import onl.continuum.continuum.application.service.TimeTrackingService;
import onl.continuum.continuum.controller.dto.timetracking.*;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import jakarta.validation.Valid;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/time-tracking")
@RequiredArgsConstructor
public class TimeTrackingController {

    private final TimeTrackingService timeTrackingService;

    /**
     * Start a timer for an entity
     * POST /api/time-tracking/start
     */
    @PostMapping("/start")
    public ResponseEntity<TimerSessionResponse> startTimer(
            @AuthenticationPrincipal CustomUserDetails user,
            @Valid @RequestBody StartTimerRequest request) {
        TimerSessionResponse response = timeTrackingService.startTimer(
                user.getUserId(),
                user.getVaultId(),
                request
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /**
     * Stop the current timer and create a time entry
     * POST /api/time-tracking/stop
     */
    @PostMapping("/stop")
    public ResponseEntity<TimeEntryResponse> stopTimer(
            @AuthenticationPrincipal CustomUserDetails user,
            @Valid @RequestBody StopTimerRequest request) {
        TimeEntryResponse response = timeTrackingService.stopTimer(user.getUserId(), request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /**
     * Manually add time to an entity
     * POST /api/time-tracking/add
     */
    @PostMapping("/add")
    public ResponseEntity<TimeEntryResponse> addTime(
            @AuthenticationPrincipal CustomUserDetails user,
            @Valid @RequestBody AddTimeRequest request) {
        TimeEntryResponse response = timeTrackingService.addTime(
                user.getUserId(),
                user.getVaultId(),
                request
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /**
     * Get total time spent on an entity
     * GET /api/time-tracking/:entityId/total
     */
    @GetMapping("/{entityId}/total")
    public ResponseEntity<TimeEntitySummary> getTotalTime(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String entityId) {
        TimeEntitySummary summary = timeTrackingService.getTotalTime(
                user.getUserId(),
                user.getVaultId(),
                entityId
        );
        return ResponseEntity.ok(summary);
    }

    /**
     * Get daily breakdown of time spent on an entity
     * GET /api/time-tracking/:entityId/daily
     */
    @GetMapping("/{entityId}/daily")
    public ResponseEntity<Map<LocalDate, TimeEntryResponse>> getDailyBreakdown(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String entityId) {
        Map<LocalDate, TimeEntryResponse> breakdown = timeTrackingService.getDailyBreakdown(
                user.getUserId(),
                entityId
        );
        return ResponseEntity.ok(breakdown);
    }

    /**
     * Get time spent in a date range
     * GET /api/time-tracking/:entityId/range?from=2024-01-01&to=2024-01-31
     */
    @GetMapping("/{entityId}/range")
    public ResponseEntity<List<TimeEntryResponse>> getTimeInRange(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String entityId,
            @RequestParam(required = false) LocalDate from,
            @RequestParam(required = false) LocalDate to) {
        List<TimeEntryResponse> entries = timeTrackingService.getTimeInRange(
                user.getUserId(),
                entityId,
                from,
                to
        );
        return ResponseEntity.ok(entries);
    }

    /**
     * Get summary for all entities
     * GET /api/time-tracking/summary/all
     */
    @GetMapping("/summary/all")
    public ResponseEntity<List<TimeEntitySummary>> getAllEntitiesSummary(
            @AuthenticationPrincipal CustomUserDetails user) {
        List<TimeEntitySummary> summaries = timeTrackingService.getAllEntitiesSummary(
                user.getUserId(),
                user.getVaultId()
        );
        return ResponseEntity.ok(summaries);
    }

    /**
     * Get active timer for an entity
     * GET /api/time-tracking/:entityId/active
     */
    @GetMapping("/{entityId}/active")
    public ResponseEntity<Optional<TimerSessionResponse>> getActiveTimer(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String entityId) {
        Optional<TimerSessionResponse> timer = timeTrackingService.getActiveTimer(
                user.getUserId(),
                entityId
        );
        return ResponseEntity.ok(timer);
    }

    /**
     * Get all active timers
     * GET /api/time-tracking/active/all
     */
    @GetMapping("/active/all")
    public ResponseEntity<List<TimerSessionResponse>> getAllActiveTimers(
            @AuthenticationPrincipal CustomUserDetails user) {
        List<TimerSessionResponse> timers = timeTrackingService.getAllActiveTimers(user.getUserId());
        return ResponseEntity.ok(timers);
    }

    /**
     * Delete a time entry
     * DELETE /api/time-tracking/:entryId
     */
    @DeleteMapping("/{entryId}")
    public ResponseEntity<Void> deleteTimeEntry(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String entryId) {
        timeTrackingService.deleteTimeEntry(user.getUserId(), entryId);
        return ResponseEntity.noContent().build();
    }

    /**
     * Update a time entry's duration
     * PATCH /api/time-tracking/:entryId
     */
    @PatchMapping("/{entryId}")
    public ResponseEntity<TimeEntryResponse> updateTimeEntry(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String entryId,
            @RequestBody Map<String, Long> body) {
        return ResponseEntity.ok(timeTrackingService.updateTimeEntryDuration(
                user.getUserId(), entryId, body.get("durationSeconds")));
    }

    /**
     * Recover interrupted timer session
     * POST /api/time-tracking/:entityId/recover
     */
    @PostMapping("/{entityId}/recover")
    public ResponseEntity<TimeEntryResponse> recoverSession(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String entityId) {
        TimeEntryResponse response = timeTrackingService.recoverSession(user.getUserId(), entityId);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /**
     * Pause an active timer
     * POST /api/time-tracking/:sessionId/pause
     */
    @PostMapping("/{sessionId}/pause")
    public ResponseEntity<TimerSessionResponse> pauseTimer(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String sessionId) {
        return ResponseEntity.ok(timeTrackingService.pauseTimer(user.getUserId(), sessionId));
    }

    /**
     * Resume a paused timer
     * POST /api/time-tracking/:sessionId/resume
     */
    @PostMapping("/{sessionId}/resume")
    public ResponseEntity<TimerSessionResponse> resumeTimer(
            @AuthenticationPrincipal CustomUserDetails user,
            @PathVariable String sessionId) {
        return ResponseEntity.ok(timeTrackingService.resumeTimer(user.getUserId(), sessionId));
    }

    /**
     * Today's time entries across all entities
     * GET /api/time-tracking/today
     */
    @GetMapping("/today")
    public ResponseEntity<List<TimeEntryResponse>> getToday(
            @AuthenticationPrincipal CustomUserDetails user) {
        return ResponseEntity.ok(timeTrackingService.getToday(user.getUserId()));
    }

    /**
     * All entries in range across all entities (heatmap source)
     * GET /api/time-tracking/all/range?from=&to=
     */
    @GetMapping("/all/range")
    public ResponseEntity<List<TimeEntryResponse>> getAllInRange(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestParam(required = false) LocalDate from,
            @RequestParam(required = false) LocalDate to) {
        return ResponseEntity.ok(timeTrackingService.getAllInRange(user.getUserId(), from, to));
    }
}

