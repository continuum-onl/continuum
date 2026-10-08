package onl.continuum.continuum.application.service;

import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.application.exception.BadRequestException;
import onl.continuum.continuum.domain.subscription.SubscriptionRepository;
import onl.continuum.continuum.domain.token.TokenBlacklistRepository;
import onl.continuum.continuum.infra.persistence.EntityRepository;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.vault.VaultStorageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import java.time.Instant;
import java.util.Optional;

@ExtendWith(MockitoExtension.class)
class UserServicePurgeTest {

    @Mock
    private MongoTemplate mongoTemplate;
    @Mock
    private UserRepository userRepository;
    @Mock
    private NoteRepository noteRepository;
    @Mock
    private EntityRepository entityRepository;
    @Mock
    private SubscriptionRepository subscriptionRepository;
    @Mock
    private TokenBlacklistRepository tokenBlacklistRepository;
    @Mock
    private VaultStorageService vaultStorage;

    private UserService userService;

    @BeforeEach
    void setUp() {
        userService = new UserService(mongoTemplate, userRepository, noteRepository, entityRepository,
                subscriptionRepository, tokenBlacklistRepository);
        ReflectionTestUtils.setField(userService, "vaultStorage", vaultStorage);
    }

    @Test
    void purgeDeletesVaultBeforeDatabaseRecordsAndUser() {
        User user = User.builder().id("user-id").vaultId("vault-id").build();
        InOrder order = inOrder(vaultStorage, mongoTemplate, userRepository);

        userService.purgeEverything(user);

        order.verify(vaultStorage).deleteVault("vault-id");
        order.verify(mongoTemplate).remove(any(Query.class), eq("notes"));
        order.verify(mongoTemplate).remove(any(Query.class), eq("stripe_event_logs"));
        order.verify(userRepository).deleteById("user-id");
    }

    @Test
    void purgeKeepsAccountRecordsWhenVaultDeletionFails() {
        User user = User.builder().id("user-id").vaultId("vault-id").build();
        org.mockito.Mockito.doThrow(new IllegalStateException("B2 unavailable"))
                .when(vaultStorage).deleteVault("vault-id");

        assertThatThrownBy(() -> userService.purgeEverything(user))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("B2 unavailable");

        verifyNoInteractions(mongoTemplate, userRepository);
        verify(vaultStorage).deleteVault("vault-id");
    }

    @Test
    void immediatePurgeDeletesAccountOnlyWhenDeletionWasScheduled() {
        User user = User.builder()
                .id("user-id")
                .vaultId("vault-id")
                .deletionRequestedAt(Instant.now())
                .build();
        when(userRepository.findById("user-id")).thenReturn(Optional.of(user));
        InOrder order = inOrder(vaultStorage, mongoTemplate, userRepository);

        userService.purgeScheduledDeletionNow("user-id");

        order.verify(vaultStorage).deleteVault("vault-id");
        order.verify(mongoTemplate).remove(any(Query.class), eq("notes"));
        order.verify(userRepository).deleteById("user-id");
    }

    @Test
    void immediatePurgeRejectsAccountsWithoutScheduledDeletion() {
        User user = User.builder().id("user-id").build();
        when(userRepository.findById("user-id")).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> userService.purgeScheduledDeletionNow("user-id"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Account deletion is not scheduled");

        verifyNoInteractions(mongoTemplate, vaultStorage);
        verify(userRepository, never()).deleteById("user-id");
    }
}