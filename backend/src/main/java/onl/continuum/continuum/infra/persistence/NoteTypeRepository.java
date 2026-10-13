package onl.continuum.continuum.infra.persistence;

import onl.continuum.continuum.domain.note.NoteType;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface NoteTypeRepository extends MongoRepository<NoteType, String> {
    List<NoteType> findByUserIdOrderByNameAsc(String userId);
    List<NoteType> findByUserIdAndVaultIdOrderByNameAsc(String userId, String vaultId);
    Optional<NoteType> findByUserIdAndVaultIdAndName(String userId, String vaultId, String name);
    void deleteByUserIdAndVaultIdAndName(String userId, String vaultId, String name);
}
