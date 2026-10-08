package onl.continuum.continuum.application.service;

import org.jsoup.Jsoup;
import org.jsoup.safety.Safelist;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Caching;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import onl.continuum.continuum.application.exception.BadRequestException;
import onl.continuum.continuum.application.exception.NotFoundException;
import onl.continuum.continuum.application.exception.PlanLimitException;
import onl.continuum.continuum.controller.dto.note.BacklinkMentionDTO;
import onl.continuum.continuum.controller.dto.note.BacklinksResponse;
import onl.continuum.continuum.controller.dto.note.NoteCreateRequest;
import onl.continuum.continuum.controller.dto.note.NoteResponse;
import onl.continuum.continuum.controller.dto.note.NoteUpdateRequest;
import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.domain.note.NoteLink;
import onl.continuum.continuum.domain.note.LinkType;
import onl.continuum.continuum.domain.plan.PlanConfiguration;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.persistence.NoteLinkRepository;
import onl.continuum.continuum.infra.persistence.EntityRepository;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import onl.continuum.continuum.infra.vault.VaultStorageService;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class NoteService {

    private final NoteRepository noteRepo;
    private final NoteLinkRepository noteLinkRepo;
    private final EntityRepository entityRepo;
    private final ExtractionService extractionService;
    private final TiptapParserService tiptapParser;
    private final VaultStorageService storageService;
    private final UserService userService;
    private final PlanConfiguration planConfig;
    private final UserRepository userRepo;
    private final ObjectMapper objectMapper;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private onl.continuum.continuum.infra.persistence.TrashItemRepository trashRepo;

    public NoteService(
            NoteRepository noteRepo, 
            NoteLinkRepository noteLinkRepo, 
            EntityRepository entityRepo, 
            ExtractionService extractionService, 
            TiptapParserService tiptapParser,
            VaultStorageService storageService, 
            UserService userService, 
            PlanConfiguration planConfig, 
            UserRepository userRepo,
            ObjectMapper objectMapper) {
        this.noteRepo = noteRepo;
        this.noteLinkRepo = noteLinkRepo;
        this.entityRepo = entityRepo;
        this.extractionService = extractionService;
        this.tiptapParser = tiptapParser;
        this.storageService = storageService;
        this.userService = userService;
        this.planConfig = planConfig;
        this.userRepo = userRepo;
        this.objectMapper = objectMapper;
    }

    @Caching(evict = {
        @CacheEvict(value = "insights:notes",    allEntries = true),
        @CacheEvict(value = "insights:entities", allEntries = true)
    })
    public NoteResponse create(NoteCreateRequest req) {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        
        // Verificar limite de notas baseado no plano do usuário
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found: " + userId));
        long currentNoteCount = noteRepo.countByUserId(userId);
        if (!planConfig.canCreateNote(user.getPlan(), currentNoteCount)) {
            throw new PlanLimitException("Limite de notas atingido para seu plano. Atualize para uma assinatura superior.");
        }
        
        // Validar e processar o conteúdo Tiptap (JsonNode)
        JsonNode contentJson = req.content();
        if (contentJson == null || contentJson.isNull()) {
            throw new IllegalArgumentException("Conteúdo Tiptap não pode ser nulo");
        }
        
        // Extrair menções do JSON do Tiptap
        List<TiptapParserService.Mention> mentions = tiptapParser.extractMentions(contentJson);
        
        // Extrair referências a notas
        List<TiptapParserService.NoteReference> noteReferences = tiptapParser.extractNoteReferences(contentJson);
        
        // Converter JsonNode para String para armazenamento
        String content = contentJson.toString();
        
        // Extrair texto plano para preview/busca
        String plainText = tiptapParser.extractPlainText(contentJson);
        
        // Gerar título a partir do texto ou do request
        String title = req.title() != null && !req.title().isBlank() 
                ? req.title() 
                : extractTitle(plainText);
        
        // Extrair Entity IDs das menções encontradas
        List<String> entityIds = mentions.stream()
                .map(m -> m.entityId)
                .distinct()
                .collect(Collectors.toList());
        
        // Gerar ID da nota
        String noteId = UUID.randomUUID().toString();

        // Fazer upload do conteúdo JSON para B2
        String fileKey = storageService.saveNoteContent(vaultId, noteId, content);

        // Salvar nota no MongoDB
        Note note = new Note();
        note.setId(noteId);
        note.setUserId(userId);
        note.setVaultId(vaultId);
        note.setTitle(title);
        note.setContent(content);
        note.setFileKey(fileKey);
        note.setType(req.type());
        note.setEntityIds(entityIds);
        note.setCreatedAt(Instant.now());
        note.setUpdatedAt(Instant.now());

        note = noteRepo.save(note);
        storageService.cacheNoteContent(vaultId, noteId, content);
        
        // ===================================================================
        // CRIAR LINKS AUTOMÁTICOS A PARTIR DAS MENÇÕES
        // ===================================================================
        
        // Criar um link para cada entidade mencionada
        for (TiptapParserService.Mention mention : mentions) {
            try {
                // Validar que a entidade existe
                Entity entity = entityRepo.findById(mention.entityId).orElse(null);
                if (entity != null) {
                    // Criar um NoteLink com tipo REFERENCES
                    NoteLink link = NoteLink.builder()
                            .sourceNoteId(noteId)
                            .targetNoteId(mention.entityId)
                            .userId(userId)
                            .vaultId(vaultId)
                            .linkType(LinkType.RELATED)
                            .context(mention.label)
                            .createdAt(Instant.now())
                            .build();
                    
                    noteLinkRepo.save(link);
                }
            } catch (Exception e) {
                // Log mas não falha a criação da nota
                org.slf4j.LoggerFactory.getLogger(NoteService.class)
                        .warn("Erro ao criar link para entidade {}: {}", mention.entityId, e.getMessage());
            }
        }
        
        // Criar links para referências a outras notas (se existirem)
        for (TiptapParserService.NoteReference noteRef : noteReferences) {
            try {
                // Validar que a nota target existe
                Note targetNote = noteRepo.findById(noteRef.noteId).orElse(null);
                if (targetNote != null && targetNote.getUserId().equals(userId) && !targetNote.getId().equals(noteId)) {
                    // Criar NoteLink entre notas
                    NoteLink link = NoteLink.builder()
                            .sourceNoteId(noteId)
                            .targetNoteId(noteRef.noteId)
                            .userId(userId)
                            .vaultId(vaultId)
                            .linkType(LinkType.REFERENCES)
                            .context(noteRef.label)
                            .createdAt(Instant.now())
                            .build();
                    
                    noteLinkRepo.save(link);
                }
            } catch (Exception e) {
                org.slf4j.LoggerFactory.getLogger(NoteService.class)
                        .warn("Erro ao criar link para nota {}: {}", noteRef.noteId, e.getMessage());
            }
        }

        userService.incrementNoteCount(userId);

        return NoteResponse.from(note, content);
    }

    /** Atualiza uma nota existente e aquece o cache após a persistência. */
    @Caching(evict = {
        @CacheEvict(
            value = "insights:notes", allEntries = true),
        @CacheEvict(value = "insights:entities", allEntries = true)
    })
    public NoteResponse update(String noteId, NoteUpdateRequest req) {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        Note note = noteRepo.findById(noteId)
            .filter(n -> n.getUserId().equals(userId))
            .orElseThrow(() -> new NotFoundException("Note not found: " + noteId));

        String storedContent = storageService.loadNoteContent(vaultId, noteId).orElse("");
        boolean contentChanged = false;
        if (req.content() != null && !req.content().isNull()) {
            try {
                JsonNode storedJson = storedContent.isBlank() ? null
                        : new com.fasterxml.jackson.databind.ObjectMapper().readTree(storedContent);
                contentChanged = storedJson == null || !storedJson.equals(req.content());
            } catch (Exception e) {
                contentChanged = true;
            }
        }
        boolean titleChanged = req.title() != null && !req.title().isBlank()
                && !req.title().equals(note.getTitle());
        String reqType = req.type() == null ? null : (req.type().isBlank() ? null : req.type());
        boolean typeChanged = req.type() != null && !java.util.Objects.equals(reqType, note.getType());
        if (!contentChanged && !titleChanged && !typeChanged) {
            // Nothing changed (e.g. note only opened/read): keep updatedAt intact.
            return NoteResponse.from(note, storedContent);
        }

        String newContent = storedContent;
        List<String> newEntityIds = note.getEntityIds();
        
        // Se novo conteúdo foi fornecido (JsonNode), processar
        if (req.content() != null && !req.content().isNull()) {
            JsonNode contentJson = req.content();
            
            // Extrair menções do novo JSON
            List<TiptapParserService.Mention> mentions = tiptapParser.extractMentions(contentJson);
            List<TiptapParserService.NoteReference> noteReferences = tiptapParser.extractNoteReferences(contentJson);
            
            // Converter para String
            newContent = contentJson.toString();
            
            // Extrair texto plano
            String plainText = tiptapParser.extractPlainText(contentJson);
            
            // Atualizar entity IDs
            newEntityIds = mentions.stream()
                    .map(m -> m.entityId)
                    .distinct()
                    .collect(Collectors.toList());
            
            // Remover links antigos (serão recriados)
            deleteNoteLinks(noteId, userId, vaultId);
            
            // Criar novos links a partir das menções
            for (TiptapParserService.Mention mention : mentions) {
                try {
                    Entity entity = entityRepo.findById(mention.entityId).orElse(null);
                    if (entity != null) {
                        NoteLink link = NoteLink.builder()
                                .sourceNoteId(noteId)
                                .targetNoteId(mention.entityId)
                                .userId(userId)
                                .vaultId(vaultId)
                                .linkType(LinkType.RELATED)
                                .context(mention.label)
                                .createdAt(Instant.now())
                                .build();
                        
                        noteLinkRepo.save(link);
                    }
                } catch (Exception e) {
                    org.slf4j.LoggerFactory.getLogger(NoteService.class)
                            .warn("Erro ao criar link: {}", e.getMessage());
                }
            }
            
            // Criar links para referências a notas
            for (TiptapParserService.NoteReference noteRef : noteReferences) {
                try {
                    Note targetNote = noteRepo.findById(noteRef.noteId).orElse(null);
                    if (targetNote != null && targetNote.getUserId().equals(userId) && !targetNote.getId().equals(noteId)) {
                        NoteLink link = NoteLink.builder()
                                .sourceNoteId(noteId)
                                .targetNoteId(noteRef.noteId)
                                .userId(userId)
                                .vaultId(vaultId)
                                .linkType(LinkType.REFERENCES)
                                .context(noteRef.label)
                                .createdAt(Instant.now())
                                .build();
                        
                        noteLinkRepo.save(link);
                    }
                } catch (Exception e) {
                    org.slf4j.LoggerFactory.getLogger(NoteService.class)
                            .warn("Erro ao criar link: {}", e.getMessage());
                }
            }
        }
        
        // Atualizar título se fornecido
        if (req.title() != null && !req.title().isBlank()) {
            note.setTitle(req.title());
        }
        
        // Atualizar tipo se fornecido
        if (req.type() != null) {
            note.setType(req.type().isBlank() ? null : req.type());
        }
        
        note.setContent(newContent);
        note.setEntityIds(newEntityIds);
        note.setUpdatedAt(Instant.now());

        // Fazer upload para B2
        String fileKey = storageService.saveNoteContent(vaultId, noteId, newContent);
        note.setFileKey(fileKey);

        // Salvar no MongoDB
        note = noteRepo.save(note);
        storageService.cacheNoteContent(vaultId, noteId, newContent);

        return NoteResponse.from(note, newContent);
    }

    @Caching(evict = {
        @CacheEvict(value = "insights:notes", allEntries = true),
        @CacheEvict(value = "insights:entities", allEntries = true)
    })
    public List<Note> updateTypes(List<String> noteIds, String type) {
        String userId = getCurrentUserId();
        if (noteIds == null || noteIds.isEmpty()) {
            throw new BadRequestException("noteIds cannot be empty");
        }
        String cleanType = type == null ? "" : type.trim();
        if (cleanType.isEmpty()) {
            throw new BadRequestException("type cannot be empty");
        }

        Set<String> requestedIds = new LinkedHashSet<>(noteIds);
        List<Note> notes = noteRepo.findAllById(requestedIds).stream()
                .filter(note -> userId.equals(note.getUserId()))
                .toList();

        if (notes.size() != requestedIds.size()) {
            throw new NotFoundException("One or more notes were not found");
        }

        Instant now = Instant.now();
        notes.forEach(note -> {
            note.setType(cleanType);
            note.setUpdatedAt(now);
        });
        return noteRepo.saveAll(notes);
    }

    public NoteResponse getById(String noteId) {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        Note note = noteRepo.findById(noteId)
            .filter(n -> n.getUserId().equals(userId))
            .orElseThrow(() -> new NotFoundException("Note not found: " + noteId));
        String content = storageService.loadNoteContent(vaultId, noteId).orElse("");
        return NoteResponse.from(note, content);
    }

    public List<Note> listByUser() {
        return noteRepo.findByUserId(getCurrentUserId());
    }

    /**
     * Carrega apenas os dados necessários para construir o grafo de conhecimento.
     * Otimizado para trazer apenas id, title e entityIds, economizando memória e banda de rede.
     * O campo content não é incluído nesta query.
     */
    public List<Note> listByUserForGraph() {
        String userId = getCurrentUserId();
        return noteRepo.findGraphDataByUserId(userId);
    }

    /** Deleta uma nota, seu conteúdo no storage e todos os links associados. */
    @Caching(evict = {
        @CacheEvict(value = "insights:notes",    allEntries = true),
        @CacheEvict(value = "insights:entities", allEntries = true)
    })
    public void deleteNote(String noteId) {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        Note note = noteRepo.findById(noteId)
            .orElseThrow(() -> new NotFoundException("Note not found: " + noteId));
        
        // OWNERSHIP: Validar que a nota pertence ao usuário autenticado
        if (!note.getUserId().equals(userId)) {
            throw new AccessDeniedException("You do not have permission to delete this note");
        }

        // Snapshot into the trash so the note can be restored for 30 days.
        if (trashRepo != null) {
            try {
                String snapshot = storageService.loadNoteContent(vaultId, noteId).orElse("");
                trashRepo.save(onl.continuum.continuum.domain.trash.TrashItem.builder()
                    .userId(userId).vaultId(vaultId).kind("NOTE").originalId(noteId)
                    .title(note.getTitle()).subtype(note.getType()).note(note).noteContent(snapshot)
                    .deletedAt(Instant.now()).build());
            } catch (Exception ignored) { }
        }

        // Delete file from B2 if fileKey exists
        if (note.getFileKey() != null && !note.getFileKey().isEmpty()) {
            storageService.deleteNote(vaultId, noteId);
        }

        // Delete all associated links (backlinks e forward links) - IMPORTANTE!
        deleteNoteLinks(noteId, userId, vaultId);

        // Delete from MongoDB
        noteRepo.deleteById(noteId);
        // Fallback for notes without fileKey, which skip storageService.deleteNote().
        storageService.invalidateNoteContent(vaultId, noteId);

        // Decrement user count
        userService.decrementNoteCount(userId);
    }

    /**
     * Alterna o status de favorito de uma nota. Persiste no MongoDB.
     */
    @Caching(evict = {
        @CacheEvict(value = "insights:notes",    allEntries = true),
        @CacheEvict(value = "insights:entities", allEntries = true)
    })
    public NoteResponse toggleFavorite(String noteId) {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        Note note = noteRepo.findById(noteId)
            .filter(n -> n.getUserId().equals(userId))
            .orElseThrow(() -> new NotFoundException("Note not found: " + noteId));
        note.setFavorite(!note.isFavorite());
        note.setUpdatedAt(Instant.now());
        note = noteRepo.save(note);
        String content = storageService.loadNoteContent(vaultId, noteId).orElse("");
        return NoteResponse.from(note, content);
    }

    private List<String> findMatchingEntityIds(String userId, String content) {
        List<Entity> userEntities = entityRepo.findByUserId(userId);
        return extractionService.extractEntityIds(content, userEntities);
    }

    private String getCurrentUserId() {
        Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        if (principal instanceof CustomUserDetails userDetails) {
            return userDetails.getUserId();
        }
        throw new IllegalStateException("Authenticated user not found");
    }

    private String getCurrentVaultId() {
        Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        if (principal instanceof CustomUserDetails userDetails) {
            return userDetails.getVaultId();
        }
        throw new IllegalStateException("Authenticated user not found");
    }

    private String extractTitle(String content) {
        if (content == null || content.isBlank()) return "Untitled";
        String firstLine = content.trim().split("\\n")[0];
        return firstLine.length() > 80 ? firstLine.substring(0, 80) : firstLine;
    }

    /**
     * Sanitiza o conteúdo da nota removendo tags <script>, eventos JS (onclick, onload, etc)
     * e outras tags potencialmente maliciosas, enquanto preserva formatação HTML segura.
     * Protege contra ataques XSS (Cross-Site Scripting).
     */
    private String sanitizeContent(String content) {
        if (content == null || content.isBlank()) {
            return content;
        }

        // Usar jsoup com Safelist para permitir apenas tags seguras
        // Safelist.basic() permite: b, em, i, strong, u, thead, tbody, tr, th, td...
        // Mas vamos usar basicWithImages() para permitir imagens também
        Safelist safelist = Safelist.basicWithImages()
                .addTags("p", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "code", "blockquote")
                .addAttributes("a", "href", "title")
                .addAttributes("img", "src", "alt", "title")
                .addAttributes("code", "class"); // Para syntax highlighting class names

        // Usar jsoup para limpar. removeAll remove scripts, iframes e outros maliciosos
        String sanitized = Jsoup.clean(content, "", safelist);

        // Remover qualquer ocorrência de javascript: protocol
        sanitized = sanitized.replaceAll("(?i)javascript:", "");

        // Remover atributos de evento (onclick, onload, etc)
        sanitized = sanitized.replaceAll("(?i)on\\w+\\s*=", "");

        return sanitized;
    }
    
    // ============================================================================
    // BACKLINKS - Links Bidirecionais no Grafo de Conhecimento
    // ============================================================================
    
    /**
     * Cria um link bidirecional entre duas notas.
     * Usado quando uma nota referencia outra.
     * 
     * @param sourceNoteId ID da nota que faz a referência
     * @param targetNoteId ID da nota que é referenciada
     * @param linkType Tipo do link (REFERENCES, CONTRADICTS, EXTENDS, etc)
     * @param context Trecho de contexto (até 200 caracteres) onde o link aparece
     */
    public void createNoteLink(String sourceNoteId, String targetNoteId, LinkType linkType, String context) {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        
        // Validar que ambas as notas existem e pertencem ao usuário
        Note sourceNote = noteRepo.findById(sourceNoteId)
                .filter(n -> n.getUserId().equals(userId))
                .orElseThrow(() -> new NotFoundException("Source note not found: " + sourceNoteId));
                
        Note targetNote = noteRepo.findById(targetNoteId)
                .filter(n -> n.getUserId().equals(userId))
                .orElseThrow(() -> new NotFoundException("Target note not found: " + targetNoteId));
        
        // Evitar auto-referências
        if (sourceNoteId.equals(targetNoteId)) {
            throw new IllegalArgumentException("Uma nota não pode referenciar a si mesma");
        }
        
        // Verificar se o link já existe
        NoteLink existingLink = noteLinkRepo.findBySourceNoteIdAndTargetNoteId(sourceNoteId, targetNoteId);
        if (existingLink != null) {
            return; // Link já existe, não precisa duplicar
        }
        
        // Truncar contexto a 200 caracteres
        String truncatedContext = context != null && context.length() > 200 
                ? context.substring(0, 200) 
                : context;
        
        // Criar o link
        NoteLink link = NoteLink.builder()
                .sourceNoteId(sourceNoteId)
                .targetNoteId(targetNoteId)
                .userId(userId)
                .vaultId(vaultId)
                .linkType(linkType != null ? linkType : LinkType.RELATED)
                .context(truncatedContext)
                .createdAt(Instant.now())
                .build();
        
        noteLinkRepo.save(link);
    }
    
    /**
     * Recupera todos os backlinks de uma nota por interseção de entityIds.
     * 
     * @param noteId ID da nota para buscar backlinks
     * @return Lista de notas que compartilham pelo menos uma entidade com a nota solicitada
     */
    public BacklinksResponse getBacklinks(String noteId) {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();

        Note note = noteRepo.findById(noteId)
                .filter(n -> n.getUserId().equals(userId))
                .orElseThrow(() -> new NotFoundException("Note not found: " + noteId));

        List<String> entityIds = note.getEntityIds();
        if (entityIds == null || entityIds.isEmpty()) {
            return new BacklinksResponse(Collections.emptyList(), Collections.emptyList());
        }

        Set<String> filterIds = new HashSet<>(entityIds);

        List<BacklinkMentionDTO> linkedMentions = noteRepo.findByUserId(userId).stream()
                .filter(n -> !n.getId().equals(noteId))
                .filter(n -> n.getEntityIds() != null && n.getEntityIds().stream().anyMatch(filterIds::contains))
                .map(n -> new BacklinkMentionDTO(n.getId(), n.getTitle(), extractSnippet(n, vaultId)))
                .collect(Collectors.toList());

        return new BacklinksResponse(linkedMentions, Collections.emptyList());
    }

    private String extractSnippet(Note note, String vaultId) {
        String rawContent = storageService.loadNoteContent(vaultId, note.getId()).orElse("");
        if (rawContent.isBlank()) {
            return "";
        }
        try {
            JsonNode contentJson = objectMapper.readTree(rawContent);
            return tiptapParser.extractPlainText(contentJson);
        } catch (Exception e) {
            return "";
        }
    }
    
    /**
     * Recupera todos os links forward de uma nota (notas que esta nota referencia).
     * 
     * @param noteId ID da nota para buscar links forward
     * @return Lista de Notas mencionadas por esta nota
     */
    public List<Note> getForwardLinks(String noteId) {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        
        // Validar que a nota existe e pertence ao usuário
        noteRepo.findById(noteId)
                .filter(n -> n.getUserId().equals(userId))
                .orElseThrow(() -> new NotFoundException("Note not found: " + noteId));
        
        // Buscar todos os links que partem desta nota
        List<NoteLink> forwardLinks = noteLinkRepo.findBySourceNoteIdAndUserIdAndVaultId(noteId, userId, vaultId);
        
        // Extrair os IDs das notas target e carregá-las
        return forwardLinks.stream()
                .map(link -> noteRepo.findById(link.getTargetNoteId()).orElse(null))
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
    }
    
    /**
     * Remove todos os links relacionados a uma nota quando ela é deletada.
     * 
     * @param noteId ID da nota sendo deletada
     * @param userId ID do usuário
     * @param vaultId ID do vault
     */
    private void deleteNoteLinks(String noteId, String userId, String vaultId) {
        // Deletar links onde esta nota é a source
        noteLinkRepo.deleteBySourceNoteIdAndUserIdAndVaultId(noteId, userId, vaultId);
        
        // Deletar links onde esta nota é a target
        noteLinkRepo.deleteByTargetNoteIdAndUserIdAndVaultId(noteId, userId, vaultId);
    }
    
    /**
     * Retorna a quantidade de backlinks que uma nota possui.
     * Útil para exibir no frontend quantas notas mencionam uma noa específica.
     *      * Retorna lista de tipos únicos das notas do usuário.
     * Filtra apenas tipos não-nulos e não-vazios.
     * 
     * @return Lista de tipos ordenada alfabeticamente
     */
    public List<String> getDistinctTypes() {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        List<NoteRepository.TypeProjection> projections = noteRepo.findDistinctTypes(userId, vaultId);
        return projections.stream()
                .map(NoteRepository.TypeProjection::getType)
                .filter(type -> type != null && !type.isBlank())
                .sorted()
                .collect(Collectors.toList());
    }

    /**
     * Busca notas por tipo, garantindo que pertencem ao vault do usuário.
     * 
     * @param type O tipo das notas a buscar
     * @return Lista de notas do tipo especificado para o usuário no seu vault
     */
    public List<Note> getNotesByType(String type) {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        if (type == null || type.isBlank()) {
            return Collections.emptyList();
        }
        return noteRepo.findByUserIdAndTypeAndVaultId(userId, type, vaultId);
    }

    /**
     * @param noteId ID da nota
     * @return Quantidade de backlinks
     */
    public long getBacklinkCount(String noteId) {
        String userId = getCurrentUserId();
        String vaultId = getCurrentVaultId();
        
        // Validar que a nota existe e pertence ao usuário
        noteRepo.findById(noteId)
                .filter(n -> n.getUserId().equals(userId))
                .orElseThrow(() -> new NotFoundException("Note not found: " + noteId));
        
        return noteLinkRepo.countByTargetNoteIdAndUserIdAndVaultId(noteId, userId, vaultId);
    }
}
