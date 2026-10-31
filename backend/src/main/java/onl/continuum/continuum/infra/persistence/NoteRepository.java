package onl.continuum.continuum.infra.persistence;

import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.data.mongodb.repository.Aggregation;
import org.springframework.stereotype.Repository;
import onl.continuum.continuum.domain.note.Note;

import java.util.List;

/**
 * Repository para notas com suporte a Text Search otimizado.
 * 
 * Índices de texto:
 * - { "title": "text", "userId": 1, "vaultId": 1 } para busca otimizada
 */
@Repository
public interface NoteRepository extends MongoRepository<Note, String> {
    List<Note> findByUserId(String userId);
    long countByUserId(String userId);
    long countByUserIdAndVaultId(String userId, String vaultId);
    void deleteByUserId(String userId);
    List<Note> findByUserIdAndType(String userId, String type);
    List<Note> findByUserIdAndTypeAndVaultId(String userId, String type, String vaultId);

    /**
     * Busca apenas os campos necessários para construir o grafo (id, title, entityIds).
     * Evita carregar o content que pode ser grande, economizando memória e banda.
     *
     * @param userId ID do usuário
     * @return Lista de notas com apenas os campos essenciais para o grafo
     */
    @Query(value = "{ 'userId': ?0 }", fields = "{ 'id': 1, 'title': 1, 'entityIds': 1, 'workspaceIds': 1 }")
    List<Note> findGraphDataByUserId(String userId);
    
    /**
     * Busca notas por texto usando MongoDB Text Search.
     * MUITO mais rápido do que Java Streams filter para datasets grandes.
     * 
     * Usa índice: { "title": "text", "userId": 1, "vaultId": 1 }
     * 
     * @param userId ID do usuário (filtro)
     * @param vaultId ID do vault (filtro)
     * @param query Texto para procurar (suporta múltiplas palavras)
     * @return Lista de notas que correspondem à query
     */
    @Query(value = """
        {
            $text: { $search: ?2 },
            userId: ?0,
            vaultId: ?1
        }
        """, fields = "{ score: { $meta: 'textScore' } }")
    List<Note> findByTextSearch(String userId, String vaultId, String query);
    
    /**
     * Busca apenas por título.
     * Ainda usa Text Search para case-insensitive e stemming automático.
     */
    @Query(value = """
        {
            $text: { $search: ?1 },
            userId: ?0
        }
        """)
    List<Note> findNotesByTitleText(String userId, String query);
    
    /**
     * Retorna lista de tipos únicos das notas de um usuário em um vault específico.
     * IMPORTANTE: Filtra por userId E vaultId para segurança em multi-tenant.
     * Usa MongoDB aggregation pipeline com $group e $match.
     * Filtra apenas documentos com type não-nulo e não-vazio.
     * 
     * @param userId ID do usuário para filtrar notas
     * @param vaultId ID do vault para garantir isolamento de dados
     * @return Lista contendo os tipos únicos, ordenada alfabeticamente
     */
    @Aggregation(pipeline = {
        "{ $match: { userId: ?0, vaultId: ?1, type: { $ne: null, $ne: '' } } }",
        "{ $group: { _id: '$type' } }",
        "{ $sort: { _id: 1 } }",
        "{ $project: { type: '$_id', _id: 0 } }"
    })
    List<TypeProjection> findDistinctTypes(String userId, String vaultId);
    
    /**
     * Conta o número de tipos únicos de notas para um usuário em um vault
     */
    @Aggregation(pipeline = {
        "{ $match: { userId: ?0, vaultId: ?1, type: { $ne: null, $ne: '' } } }",
        "{ $group: { _id: '$type' } }",
        "{ $count: 'total' }"
    })
    Long countDistinctTypes(String userId, String vaultId);
    
    /**
     * Busca as 10 notas mais recentes atualizadas para um usuário em um vault
     */
    List<Note> findTop10ByUserIdAndVaultIdOrderByUpdatedAtDesc(String userId, String vaultId);
    
    /**
     * Projeção para retornar apenas o campo type
     */
    interface TypeProjection {
        String getType();
    }
}

