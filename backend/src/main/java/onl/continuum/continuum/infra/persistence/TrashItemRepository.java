package onl.continuum.continuum.infra.persistence;

import onl.continuum.continuum.domain.trash.TrashItem;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;

@Repository
public interface TrashItemRepository extends MongoRepository<TrashItem, String> {
    List<TrashItem> findByUserIdOrderByDeletedAtDesc(String userId);
    List<TrashItem> findByVaultIdAndKind(String vaultId, String kind);
    List<TrashItem> findByUserIdAndDeletedAtBefore(String userId, Instant cutoff);
    List<TrashItem> findByDeletedAtBefore(Instant cutoff);
    void deleteByUserId(String userId);
}
