package onl.continuum.continuum.infra.persistence;

import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.stereotype.Repository;
import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.entity.EntityType;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import java.util.List;

/**
 * Repository para entidades com suporte a Text Search otimizado.
 * 
 * Índices de texto:
 * - { "title": "text", "userId": 1 } para busca otimizada
 */
@Repository
public interface EntityRepository extends MongoRepository<Entity, String> {
        List<Entity> findByVaultIdAndArchivedAtIsNull(String vaultId);
        List<Entity> findByVaultIdAndTypeAndArchivedAtIsNull(String vaultId, EntityType type);
    List<Entity> findByUserId(String userId);
    Page<Entity> findByUserId(String userId, Pageable pageable);
    long countByUserId(String userId);
    long countByUserIdAndVaultId(String userId, String vaultId);
    void deleteByUserId(String userId);
    List<Entity> findByVaultId(String vaultId);
    List<Entity> findByVaultIdAndType(String vaultId, EntityType type);
    long countByUserIdAndVaultIdAndType(String userId, String vaultId, String type);
    List<Entity> findByIdIn(List<String> ids);

    /**
     * Busca apenas os campos necessários para construir o grafo (id, title).
     * Evita carregar campos desnecessários, economizando memória e banda.
     *
     * @param userId ID do usuário
     * @return Lista de entidades com apenas os campos essenciais para o grafo
     */
    @Query(value = "{ 'userId': ?0, 'archivedAt': null }", fields = "{ 'id': 1, 'title': 1, 'type': 1, 'workspaceIds': 1 }")
    List<Entity> findGraphDataByUserId(String userId);
    
    /**
     * Busca entidades por texto usando MongoDB Text Search.
     * MUCH mais rápido do que Java Streams filter para datasets grandes.
     * 
     * Usa índice: { "title": "text", "userId": 1 }
     * 
     * @param userId ID do usuário (filtro de segurança)
     * @param query Texto para procurar (suporta múltiplas palavras e operadores)
     * @return Lista de entidades que correspondem à query
     */
    @Query(value = """
        {
            $text: { $search: ?1 },
            userId: ?0
        }
        """, fields = "{ score: { $meta: 'textScore' } }")
    List<Entity> findByTextSearch(String userId, String query);

    /**
     * Fallback: Search entities by title using case-insensitive regex.
     * Used when text search indexes are not available.
     * 
     * @param userId ID do usuário
     * @param query Texto para procurar
     * @return Lista de entidades com título contendo a query
     */
    @Query(value = """
        {
            userId: ?0,
            title: { $regex: ?1, $options: 'i' }
        }
        """)
    List<Entity> findByTitleContainingIgnoreCase(String userId, String query);

    /**
     * Find active (non-archived) entities by userId
     */
    List<Entity> findByUserIdAndArchivedAtIsNull(String userId);

    /**
     * Find active (non-archived) entities by userId with pagination
     */
    Page<Entity> findByUserIdAndArchivedAtIsNull(String userId, Pageable pageable);

    /**
     * Find active (non-archived) entities by list of IDs
     */
    List<Entity> findByIdInAndArchivedAtIsNull(List<String> ids);
}

