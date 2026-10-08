package onl.continuum.continuum.application.service;

import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Service;
import onl.continuum.continuum.application.exception.BadRequestException;
import onl.continuum.continuum.application.exception.NotFoundException;
import onl.continuum.continuum.domain.subscription.Subscription;
import onl.continuum.continuum.domain.subscription.SubscriptionStatus;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.persistence.EntityRepository;
import onl.continuum.continuum.domain.subscription.SubscriptionRepository;
import onl.continuum.continuum.domain.token.TokenBlacklistRepository;

@Service
public class UserService {

    private final MongoTemplate mongoTemplate;
    private final UserRepository userRepository;
    private final NoteRepository noteRepository;
    private final EntityRepository entityRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final TokenBlacklistRepository tokenBlacklistRepository;

    public UserService(MongoTemplate mongoTemplate,
                      UserRepository userRepository,
                      NoteRepository noteRepository,
                      EntityRepository entityRepository,
                      SubscriptionRepository subscriptionRepository,
                      TokenBlacklistRepository tokenBlacklistRepository) {
        this.mongoTemplate = mongoTemplate;
        this.userRepository = userRepository;
        this.noteRepository = noteRepository;
        this.entityRepository = entityRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.tokenBlacklistRepository = tokenBlacklistRepository;
    }

    public void incrementNoteCount(String userId) {
        mongoTemplate.updateFirst(
            Query.query(Criteria.where("_id").is(userId)),
            new Update().inc("noteCount", 1),
            User.class
        );
    }

    public void incrementEntityCount(String userId) {
        mongoTemplate.updateFirst(
            Query.query(Criteria.where("_id").is(userId)),
            new Update().inc("entityCount", 1),
            User.class
        );
    }

    public void decrementNoteCount(String userId) {
        mongoTemplate.updateFirst(
            Query.query(Criteria.where("_id").is(userId)),
            new Update().inc("noteCount", -1),
            User.class
        );
    }

    public void decrementEntityCount(String userId) {
        mongoTemplate.updateFirst(
            Query.query(Criteria.where("_id").is(userId)),
            new Update().inc("entityCount", -1),
            User.class
        );
    }

    /**
     * Deletes a user and all associated data (cascade delete).
     * Removes: Notes, Entities, Subscriptions, and Token Blacklist entries.
     * @param userId The ID of the user to delete
     * @throws NotFoundException if user not found
     */
    public void deleteUserWithCascade(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found: " + userId));
        purgeEverything(user);
    }

    public static final int DELETION_GRACE_DAYS = 7;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private onl.continuum.continuum.infra.vault.VaultStorageService vaultStorage;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    @org.springframework.context.annotation.Lazy
    private SubscriptionService subscriptionService;

    /** Marks the account for deletion; it can be restored within the grace period. */
    public java.time.Instant scheduleDeletion(String userId) {
        java.time.Instant now = java.time.Instant.now();
        mongoTemplate.updateFirst(Query.query(Criteria.where("_id").is(userId)),
            new Update().set("deletionRequestedAt", now), User.class);
        return now.plus(java.time.Duration.ofDays(DELETION_GRACE_DAYS));
    }

    public void cancelDeletion(String userId) {
        mongoTemplate.updateFirst(Query.query(Criteria.where("_id").is(userId)),
            new Update().unset("deletionRequestedAt"), User.class);
    }

    /** Permanently deletes an account that is already scheduled for deletion. */
    public void purgeScheduledDeletionNow(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found: " + userId));
        if (user.getDeletionRequestedAt() == null) {
            throw new BadRequestException("Account deletion is not scheduled");
        }
        purgeEverything(user);
    }

    /** Hourly: permanently erase accounts whose grace period has ended. */
    @org.springframework.scheduling.annotation.Scheduled(cron = "0 0 * * * *")
    public void purgeScheduledDeletions() {
        java.time.Instant cutoff = java.time.Instant.now().minus(java.time.Duration.ofDays(DELETION_GRACE_DAYS));
        java.util.List<User> due = mongoTemplate.find(
            Query.query(Criteria.where("deletionRequestedAt").lt(cutoff)), User.class);
        for (User u : due) {
            try { purgeEverything(u); } catch (Exception e) {
                org.slf4j.LoggerFactory.getLogger(UserService.class).error("Account purge failed for {}", u.getId(), e);
            }
        }
    }

    /** Removes every record and file belonging to the user, then the user itself. */
    public void purgeEverything(User user) {
        String userId = user.getId();
        Subscription subscription = subscriptionRepository.findByUserId(userId).orElse(null);
        if (subscription != null && subscription.getStripeSubscriptionId() != null
                && subscription.getStatus() != SubscriptionStatus.CANCELED) {
            if (subscriptionService == null) {
                throw new IllegalStateException("Subscription service unavailable; refusing to purge account");
            }
            subscriptionService.cancel(userId, true);
        }
        if (user.getVaultId() != null) {
            if (vaultStorage == null) {
                throw new IllegalStateException("Vault storage unavailable; refusing to purge account");
            }
            vaultStorage.deleteVault(user.getVaultId());
        }
        Query byUser = Query.query(Criteria.where("userId").is(userId));
        for (String c : java.util.List.of("notes", "entities", "entity_links", "note_links", "refresh_tokens",
                "subscriptions", "time_entries", "timer_sessions", "token_blacklist", "tracking_events",
                "user_score_snapshots", "trash_items", "folders", "stripe_event_logs")) {
            mongoTemplate.remove(byUser, c);
        }
        userRepository.deleteById(userId);
    }

    public User getById(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found: " + userId));
    }
}