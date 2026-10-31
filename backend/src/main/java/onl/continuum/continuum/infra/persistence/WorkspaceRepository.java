package onl.continuum.continuum.infra.persistence;

import onl.continuum.continuum.domain.workspace.Workspace;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface WorkspaceRepository extends MongoRepository<Workspace, String> {
    List<Workspace> findByUserIdOrderByCreatedAtAsc(String userId);
    Optional<Workspace> findByIdAndUserId(String id, String userId);
}
