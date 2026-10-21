package tech.lemnova.continuum.infra.persistence;

import onl.continuum.continuum.infra.repository.TimeEntryRepository;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.repository.Query;
import java.time.LocalDate;
import static org.junit.jupiter.api.Assertions.*;

class TimeEntryRangeTest {
    @Test
    void selectedPastDayUsesInclusiveBoundsAndExcludesArchivedEntries() throws Exception {
        var method = TimeEntryRepository.class.getMethod(
                "findByUserIdAndEntityIdAndDateBetweenOrderByDateDesc",
                String.class, String.class, LocalDate.class, LocalDate.class);
        Query query = method.getAnnotation(Query.class);
        assertNotNull(query, "Mongo Between defaults to exclusive bounds and returns nothing for a single day");
        assertTrue(query.value().contains("$gte: ?2"));
        assertTrue(query.value().contains("$lte: ?3"));
        assertTrue(query.value().contains("'archivedAt': null"));
        assertTrue(query.value().contains("'userId': ?0"));
        assertTrue(query.value().contains("'entityId': ?1"));
    }
}