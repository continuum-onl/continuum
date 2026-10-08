package onl.continuum.continuum.application.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import onl.continuum.continuum.controller.dto.entity.EntityCreateRequest;
import onl.continuum.continuum.controller.dto.entity.EntityUpdateRequest;
import onl.continuum.continuum.domain.entity.Entity;
import onl.continuum.continuum.domain.entity.EntityType;
import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.domain.plan.PlanConfiguration;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.persistence.EntityRepository;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.security.CustomUserDetails;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class EntityServiceTest {

    @Mock private EntityRepository entityRepo;
    @Mock private NoteRepository noteRepo;
    @Mock private UserRepository userRepo;
    @Mock private UserService userService;
    @Mock private PlanConfiguration planConfig;

    @InjectMocks
    private EntityService entityService;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        // Mock user response for tests
        User mockUser = new User();
        mockUser.setId("user1");
        mockUser.setEmail("test@test.com");
        when(userRepo.findById(anyString())).thenReturn(Optional.of(mockUser));
        when(planConfig.canCreateEntity(any(), anyLong())).thenReturn(true);

        // Set authenticated user
        setAuthenticatedUser("user1");
    }

    private void setAuthenticatedUser(String userId) {
        User user = new User();
        user.setId(userId);
        user.setUsername("tester");
        user.setEmail("tester@example.com");
        user.setVaultId("vault1");

        CustomUserDetails details = new CustomUserDetails(user);
        SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken(details, null));
    }

    @Test
    @DisplayName("create: saves entity with title and description")
    void create_savesEntity() {
        String userId = "user1";
        String vaultId = "vault1";
        EntityCreateRequest req = new EntityCreateRequest("AI", onl.continuum.continuum.domain.entity.EntityType.PERSON, "Artificial Intelligence");
        
        Entity savedEntity = new Entity();
        savedEntity.setId("e1");
        savedEntity.setVaultId(vaultId);
        savedEntity.setTitle("AI");
        savedEntity.setDescription("Artificial Intelligence");
        savedEntity.setCreatedAt(Instant.now());

        when(entityRepo.save(any(Entity.class))).thenReturn(savedEntity);

        Entity result = entityService.create(userId, vaultId, req);
        
        assertThat(result).isNotNull();
        assertThat(result.getId()).isEqualTo("e1");
        assertThat(result.getTitle()).isEqualTo("AI");
    }

    @Test
    @DisplayName("getEntity: retrieves entity by vault and id")
    void getEntity_returnEntity() {
        String vaultId = "vault1";
        String entityId = "e1";
        
        Entity entity = new Entity();
        entity.setId(entityId);
        entity.setVaultId(vaultId);
        entity.setTitle("AI");

        when(entityRepo.findById(entityId)).thenReturn(Optional.of(entity));

        Entity result = entityService.getEntity(vaultId, entityId);
        
        assertThat(result).isNotNull();
        assertThat(result.getTitle()).isEqualTo("AI");
    }

    @Test
    @DisplayName("toggleFavorite: toggles and saves an owned entity")
    void toggleFavorite_togglesAndSavesEntity() {
        Entity entity = new Entity();
        entity.setId("e1");
        entity.setUserId("user1");
        entity.setVaultId("vault1");
        entity.setFavorite(false);

        when(entityRepo.findById("e1")).thenReturn(Optional.of(entity));
        when(entityRepo.save(any(Entity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Entity result = entityService.toggleFavorite("e1");

        assertThat(result.isFavorite()).isTrue();
        verify(entityRepo).save(entity);
    }

    @Test
    @DisplayName("getNotesForEntity: retrieves all notes linked to entity")
    void getNotesForEntity_returnsNotes() {
        String userId = "user1";
        String vaultId = "vault1";
        String entityId = "e1";

        Note note1 = new Note();
        note1.setId("n1");
        note1.setEntityIds(List.of(entityId));
        note1.setTitle("Note 1");

        Note note2 = new Note();
        note2.setId("n2");
        note2.setEntityIds(List.of("other"));

        Entity entity = new Entity();
        entity.setId(entityId);
        entity.setVaultId(vaultId);
        entity.setTitle("Entity 1");

        when(entityRepo.findById(entityId)).thenReturn(java.util.Optional.of(entity));
        when(noteRepo.findByUserId(userId)).thenReturn(List.of(note1, note2));

        List<Note> result = entityService.getNotesForEntity(userId, vaultId, entityId);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getTitle()).isEqualTo("Note 1");
    }

    @Test
    @DisplayName("update: updates entity title and description")
    void update_updatesEntity() {
        String userId = "user1";
        String vaultId = "vault1";
        String entityId = "e1";
        EntityUpdateRequest req = new EntityUpdateRequest("Updated Title", onl.continuum.continuum.domain.entity.EntityType.PERSON, "Updated Description");
        
        Entity entity = new Entity();
        entity.setId(entityId);
        entity.setVaultId(vaultId);
        entity.setUserId(userId);
        entity.setTitle("Old Title");

        when(entityRepo.findById(entityId)).thenReturn(Optional.of(entity));
        when(entityRepo.save(any(Entity.class))).thenAnswer(i -> i.getArgument(0));

        Entity result = entityService.update(userId, vaultId, entityId, req);
        
        assertThat(result.getTitle()).isEqualTo("Updated Title");
        assertThat(result.getDescription()).isEqualTo("Updated Description");
    }

    @Test
    @DisplayName("trackHabit: adds today to tracking dates for existing activity")
    void trackHabit_addsTodayToTrackingDates() {
        String userId = "user1";
        String entityId = "e1";

        Entity activity = new Entity();
        activity.setId(entityId);
        activity.setUserId(userId);
        activity.setVaultId("vault1");
        activity.setType(EntityType.ACTIVITY);

        when(entityRepo.findById(entityId)).thenReturn(Optional.of(activity));
        when(entityRepo.save(any(Entity.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Entity result = entityService.trackHabit(userId, entityId);

        assertThat(result.getTrackingDates()).contains(java.time.LocalDate.now());
        verify(entityRepo, times(1)).save(activity);
    }

    @Test
    @DisplayName("delete: removes entity")
    void delete_removesEntity() {
        String userId = "user1";
        String vaultId = "vault1";
        String entityId = "e1";

        Entity entity = new Entity();
        entity.setId(entityId);
        entity.setVaultId(vaultId);
        entity.setUserId(userId);

        when(entityRepo.findById(entityId)).thenReturn(Optional.of(entity));

        entityService.delete(userId, vaultId, entityId);

        verify(entityRepo, times(1)).delete(entity);
    }
}
