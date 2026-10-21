package onl.continuum.continuum.infra.repository;

import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.stereotype.Repository;
import onl.continuum.continuum.domain.timetracking.TimeEntry;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface TimeEntryRepository extends MongoRepository<TimeEntry, String> {
    List<TimeEntry> findByUserIdAndEntityIdAndArchivedAtIsNull(String userId, String entityId);
    List<TimeEntry> findByUserIdAndArchivedAtIsNull(String userId);

    /**
     * Find all time entries for an entity
     */
    List<TimeEntry> findByUserIdAndEntityIdOrderByDateDesc(String userId, String entityId);

    /**
     * Find entries for a specific date
     */
    List<TimeEntry> findByUserIdAndDateOrderByCreatedAtDesc(String userId, LocalDate date);

    /**
     * Find active entries in an inclusive date range, including a single selected day.
     */
    @Query("{ 'userId': ?0, 'entityId': ?1, 'archivedAt': null, 'date': { $gte: ?2, $lte: ?3 } }")
    List<TimeEntry> findByUserIdAndEntityIdAndDateBetweenOrderByDateDesc(
            String userId, String entityId, LocalDate startDate, LocalDate endDate);

    /**
     * Find entries for a specific entity and date
     */
    List<TimeEntry> findByUserIdAndEntityIdAndDate(String userId, String entityId, LocalDate date);

    /**
     * Calculate total time spent on an entity
     */
    @Query("{ 'userId': ?0, 'entityId': ?1 }")
    List<TimeEntry> findAllByUserIdAndEntityId(String userId, String entityId);

    /**
     * Find entries by vault
     */
    List<TimeEntry> findByVaultIdOrderByCreatedAtDesc(String vaultId);

    /**
     * Delete entries for a specific entity-date combination
     */
    void deleteByUserIdAndEntityIdAndDate(String userId, String entityId, LocalDate date);

    /**
     * Find old events for cleanup
     */
    @Query("{ 'userId': ?0, 'date': { $lt: ?1 } }")
    List<TimeEntry> findOldEventsByUserId(String userId, LocalDate cutoffDate);

    /**
     * Delete all entries for an entity (cascade delete)
     */
    void deleteByEntityId(String entityId);
}
