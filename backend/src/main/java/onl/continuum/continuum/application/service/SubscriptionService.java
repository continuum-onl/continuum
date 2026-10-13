package onl.continuum.continuum.application.service;

import com.stripe.model.Event;
import com.stripe.model.EventDataObjectDeserializer;
import com.stripe.exception.StripeException;
import com.stripe.model.Customer;
import com.stripe.model.Invoice;
import com.stripe.model.StripeObject;
import com.stripe.model.checkout.Session;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import onl.continuum.continuum.application.exception.BadRequestException;
import onl.continuum.continuum.application.exception.NotFoundException;
import onl.continuum.continuum.application.exception.StripeIntegrationException;
import onl.continuum.continuum.controller.dto.subscription.CheckoutResponse;
import onl.continuum.continuum.controller.dto.subscription.SubscriptionDTO;
import onl.continuum.continuum.domain.plan.PlanConfiguration;
import onl.continuum.continuum.domain.plan.PlanType;
import onl.continuum.continuum.domain.stripe.StripeEventLog;
import onl.continuum.continuum.domain.stripe.StripeEventLogRepository;
import onl.continuum.continuum.domain.stripe.StripeEventStatus;
import onl.continuum.continuum.domain.subscription.Subscription;
import onl.continuum.continuum.domain.subscription.SubscriptionRepository;
import onl.continuum.continuum.domain.subscription.SubscriptionStatus;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;

import java.time.Instant;
import java.util.concurrent.Callable;

/**
 * Business logic around user subscriptions. The Stripe HTTP layer lives in
 * {@link StripeService}; this class owns the persistence + user plan sync.
 * Stripe is the source of truth — webhooks reconcile local state.
 */
@Service
public class SubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

    private final SubscriptionRepository subRepo;
    private final UserRepository userRepo;
    private final StripeEventLogRepository eventLog;
    private final PlanConfiguration planConfig;
    private final StripeService stripe;

    public SubscriptionService(SubscriptionRepository subRepo,
                               UserRepository userRepo,
                               StripeEventLogRepository eventLog,
                               PlanConfiguration planConfig,
                               StripeService stripe) {
        this.subRepo = subRepo;
        this.userRepo = userRepo;
        this.eventLog = eventLog;
        this.planConfig = planConfig;
        this.stripe = stripe;
    }

    /* ─────────────────── Queries ─────────────────── */

    public SubscriptionDTO getSubscription(String userId) {
        Subscription sub = subRepo.findByUserId(userId).orElseGet(() -> {
            Subscription s = new Subscription();
            s.setUserId(userId);
            s.setPlanType(PlanType.FREE);
            s.setStatus(SubscriptionStatus.ACTIVE);
            return s;
        });
        return SubscriptionDTO.from(sub, planConfig);
    }

    /* ─────────────────── Checkout / Portal ─────────────────── */

    public CheckoutResponse createCheckout(String userId, String email, String priceOrPlan) {
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found"));
        try {
            String customerId = stripe.ensureCustomer(user.getStripeCustomerId(), userId, email);
            if (!customerId.equals(user.getStripeCustomerId())) {
                user.setStripeCustomerId(customerId);
                userRepo.save(user);
            }
            return stripe.createCheckout(customerId, userId, email, priceOrPlan);
        } catch (StripeException e) {
            log.error("[Stripe] Failed to prepare checkout customer: {}", e.getMessage(), e);
            throw new StripeIntegrationException("Failed to create Stripe checkout: " + e.getMessage(), e);
        }
    }

    public CheckoutResponse createEmbeddedCheckout(String userId, String email, String priceOrPlan) {
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found"));
        try {
            String customerId = stripe.ensureCustomer(user.getStripeCustomerId(), userId, email);
            if (!customerId.equals(user.getStripeCustomerId())) {
                user.setStripeCustomerId(customerId);
                userRepo.save(user);
            }
            return stripe.createEmbeddedCheckout(customerId, userId, email, priceOrPlan);
        } catch (StripeException e) {
            log.error("[Stripe] Failed to prepare embedded checkout customer: {}", e.getMessage(), e);
            throw new StripeIntegrationException("Failed to create Stripe checkout: " + e.getMessage(), e);
        }
    }

    public String getCheckoutPublishableKey() {
        return stripe.getCheckoutPublishableKey();
    }

    public String createPortalSession(String userId) {
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found"));
        if (user.getStripeCustomerId() == null) {
            throw new BadRequestException("No Stripe customer found for user");
        }
        return stripe.createPortalSession(user.getStripeCustomerId());
    }

    /* ─────────────────── Cancel / Change plan / Refund ─────────────────── */

    @Transactional
    public SubscriptionDTO cancel(String userId, boolean immediately) {
        Subscription sub = subRepo.findByUserId(userId)
                .orElseThrow(() -> new NotFoundException("No subscription found"));
        if (sub.getStripeSubscriptionId() == null) {
            throw new BadRequestException("No active paid subscription to cancel");
        }
        com.stripe.model.Subscription updated = immediately
                ? stripe.cancelImmediately(sub.getStripeSubscriptionId())
                : stripe.cancelAtPeriodEnd(sub.getStripeSubscriptionId());
        applyStripeSubscription(sub.getUserId(), updated);
        return SubscriptionDTO.from(subRepo.findByUserId(userId).orElse(sub), planConfig);
    }

    @Transactional
    public SubscriptionDTO changePlan(String userId, String newPriceOrPlan) {
        Subscription sub = subRepo.findByUserId(userId)
                .orElseThrow(() -> new NotFoundException("No subscription found"));
        if (sub.getStripeSubscriptionId() == null) {
            throw new BadRequestException("No active subscription to change");
        }
        com.stripe.model.Subscription updated =
                stripe.changePlan(sub.getStripeSubscriptionId(), newPriceOrPlan);
        applyStripeSubscription(userId, updated);
        return SubscriptionDTO.from(subRepo.findByUserId(userId).orElse(sub), planConfig);
    }

    public void refund(String chargeId, Long amountCents) {
        stripe.refundCharge(chargeId, amountCents);
    }

    /* ─────────────────── Post-checkout sync (race-condition guard) ─────────────────── */

    /**
     * Pulls the truth from Stripe for a single user and applies it locally. Called
     * when the browser comes back from Checkout and by the reconciliation job, so
     * access is granted even if the webhook is late, lost, or failed.
     */
    public SubscriptionDTO syncFromStripe(String userId) {
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new NotFoundException("User not found"));
        String customerId = user.getStripeCustomerId();
        if (customerId == null || customerId.isBlank()) {
            log.info("[Stripe][sync] user={} has no Stripe customer yet — nothing to sync", userId);
            return getSubscription(userId);
        }
        try {
            com.stripe.model.Subscription remote = withRetry(
                    () -> stripe.findLatestRelevantSubscription(customerId), "list-subscriptions");
            if (remote == null) {
                log.info("[Stripe][sync] no subscription found on Stripe for customer={} (user={})", customerId, userId);
                return getSubscription(userId);
            }
            applyStripeSubscription(userId, remote);
            log.info("[Stripe][sync] user={} reconciled from Stripe sub={} status={}",
                    userId, remote.getId(), remote.getStatus());
        } catch (Exception e) {
            log.error("[Stripe][sync] Failed to sync user={} from Stripe: {}", userId, e.getMessage(), e);
        }
        return getSubscription(userId);
    }

    /* ─────────────────── Webhook entrypoint ─────────────────── */

    /**
     * Idempotent webhook entrypoint.
     *
     * <p>Contract: the event id is claimed atomically <em>before</em> any business
     * logic runs (unique index on {@code eventId}), so concurrent deliveries of the
     * same event can never both process. The claim is only flipped to
     * {@code PROCESSED} after the handler fully succeeded — a failure marks it
     * {@code FAILED} and rethrows, so Stripe retries and the reconciliation job can
     * replay it. Nothing is ever "silently" acknowledged.
     *
     * @return true when the event was applied (or was already applied), false never —
     *         failures throw so the caller answers 5xx and Stripe retries.
     */
    public boolean handleStripeEvent(Event event) {
        if (event == null || event.getId() == null) return true;
        String eventId = event.getId();
        String type = event.getType();

        StripeEventLog claim = claim(eventId, type);
        if (claim == null) {
            log.info("[Stripe][webhook] event={} type={} already processed — acknowledging duplicate", eventId, type);
            return true;
        }

        log.info("[Stripe][webhook] processing event={} type={} attempt={}", eventId, type, claim.getAttempts());
        try {
            switch (type) {
                case "checkout.session.completed", "checkout.session.async_payment_succeeded"
                        -> handleCheckoutCompleted(event);
                case "customer.subscription.created",
                     "customer.subscription.updated",
                     "customer.subscription.trial_will_end" -> handleSubscriptionUpsert(event);
                case "customer.subscription.deleted" -> handleSubscriptionDeleted(event);
                case "invoice.paid", "invoice.payment_succeeded" -> handleInvoicePaymentSucceeded(event);
                case "invoice.payment_failed" -> handleInvoicePaymentFailed(event);
                case "charge.refunded" -> log.info("[Stripe][webhook] refund event={} recorded", eventId);
                default -> log.info("[Stripe][webhook] event={} type={} not handled (no-op)", eventId, type);
            }
            markProcessed(claim);
            log.info("[Stripe][webhook] event={} type={} applied successfully", eventId, type);
            return true;
        } catch (Exception e) {
            markFailed(claim, e);
            log.error("[Stripe][webhook] event={} type={} FAILED (will be retried): {}",
                    eventId, type, e.getMessage(), e);
            throw new RuntimeException("Failed to process Stripe event " + eventId, e);
        }
    }

    /* ─────────────────── Event handlers ─────────────────── */

    private void handleCheckoutCompleted(Event event) {
        Session session = (Session) deserialize(event);
        if (session == null) throw new IllegalStateException("Could not deserialize checkout.session payload");

        String userId = session.getClientReferenceId();
        String customerId = session.getCustomer();
        String subscriptionId = session.getSubscription();
        log.info("[Stripe][checkout] session={} user={} customer={} subscription={} payment_status={}",
                session.getId(), userId, customerId, subscriptionId, session.getPaymentStatus());

        if (userId != null && customerId != null) {
            userRepo.findById(userId).ifPresent(u -> {
                if (u.getStripeCustomerId() == null || u.getStripeCustomerId().isBlank()) {
                    u.setStripeCustomerId(customerId);
                    userRepo.save(u);
                    log.info("[Stripe][checkout] linked customer={} to user={}", customerId, userId);
                }
            });
        }

        String uid = userId != null ? userId : resolveUserIdFromCustomer(customerId);
        if (uid == null) {
            // Do NOT swallow: without a user we cannot deliver the service.
            throw new IllegalStateException(
                    "Paid checkout session " + session.getId() + " could not be mapped to a user (customer="
                            + customerId + ") — access NOT granted");
        }

        if (subscriptionId == null) {
            log.warn("[Stripe][checkout] session={} has no subscription (one-off payment?) — nothing to provision",
                    session.getId());
            return;
        }

        final String subId = subscriptionId;
        com.stripe.model.Subscription sub =
                withRetry(() -> com.stripe.model.Subscription.retrieve(subId), "retrieve-subscription");
        applyStripeSubscription(uid, sub);
    }

    private void handleSubscriptionUpsert(Event event) {
        com.stripe.model.Subscription sub = (com.stripe.model.Subscription) deserialize(event);
        if (sub == null) throw new IllegalStateException("Could not deserialize customer.subscription payload");
        String userId = metadataUserId(sub);
        if (userId == null) userId = resolveUserIdFromCustomer(sub.getCustomer());
        if (userId == null) {
            throw new IllegalStateException("Cannot resolve user for subscription " + sub.getId()
                    + " (customer=" + sub.getCustomer() + ")");
        }
        applyStripeSubscription(userId, sub);
    }

    private void handleSubscriptionDeleted(Event event) {
        com.stripe.model.Subscription sub = (com.stripe.model.Subscription) deserialize(event);
        if (sub == null) throw new IllegalStateException("Could not deserialize customer.subscription payload");
        Subscription local = subRepo.findByStripeSubscriptionId(sub.getId()).orElse(null);
        if (local == null) {
            log.info("[Stripe][sub-deleted] no local subscription for {} — nothing to revoke", sub.getId());
            return;
        }
        local.setStatus(SubscriptionStatus.CANCELED);
        local.setPlanType(PlanType.FREE);
        local.setCanceledAt(Instant.now());
        local.setCancelAtPeriodEnd(false);
        local.setUpdatedAt(Instant.now());
        subRepo.save(local);
        userRepo.findById(local.getUserId()).ifPresent(u -> {
            u.syncPlan(PlanType.FREE);
            userRepo.save(u);
        });
        log.info("[Stripe][sub-deleted] user={} downgraded to FREE (sub={})", local.getUserId(), sub.getId());
    }

    private void handleInvoicePaymentSucceeded(Event event) {
        Invoice invoice = (Invoice) deserialize(event);
        if (invoice == null) throw new IllegalStateException("Could not deserialize invoice payload");
        String subId = getInvoiceSubscriptionId(invoice);
        if (subId == null) {
            log.info("[Stripe][invoice-paid] invoice={} not tied to a subscription — skipping", invoice.getId());
            return;
        }
        com.stripe.model.Subscription sub =
                withRetry(() -> com.stripe.model.Subscription.retrieve(subId), "retrieve-subscription");
        String userId = metadataUserId(sub);
        if (userId == null) userId = resolveUserIdFromCustomer(sub.getCustomer());
        if (userId == null) {
            throw new IllegalStateException("Paid invoice " + invoice.getId()
                    + " could not be mapped to a user (customer=" + sub.getCustomer() + ")");
        }
        applyStripeSubscription(userId, sub);
    }

    private void handleInvoicePaymentFailed(Event event) {
        Invoice invoice = (Invoice) deserialize(event);
        if (invoice == null) throw new IllegalStateException("Could not deserialize invoice payload");
        String subId = getInvoiceSubscriptionId(invoice);
        if (subId == null) return;
        subRepo.findByStripeSubscriptionId(subId).ifPresent(local -> {
            local.setStatus(SubscriptionStatus.PAST_DUE);
            local.setUpdatedAt(Instant.now());
            subRepo.save(local);
            log.warn("[Stripe][invoice-failed] user={} marked PAST_DUE (sub={})", local.getUserId(), subId);
        });
    }

    /* ─────────────────── Reconciliation ─────────────────── */

    /** Exposes Stripe's subscription list to the reconciliation job. */
    public Iterable<com.stripe.model.Subscription> stripeIterateLiveSubscriptions() throws StripeException {
        return stripe.iterateLiveSubscriptions();
    }

    /** Statuses that actually grant (or may still grant) access. */
    private static boolean isLiveStatus(SubscriptionStatus s) {
        return s == SubscriptionStatus.ACTIVE
                || s == SubscriptionStatus.TRIALING
                || s == SubscriptionStatus.PAST_DUE;
    }

    /**
     * Compares one Stripe subscription against local state and repairs it when they
     * diverge. Returns true when a repair was applied (used for job reporting).
     *
     * <p>A user can own several dead Stripe subscriptions (canceled, incomplete…).
     * Since we keep a single local record per user, adopting each dead remote in turn
     * made two dead subscriptions ping-pong forever on every sweep. We therefore only
     * take over the local record for a <i>different</i> subscription id when the remote
     * one is live; dead ones are ignored (they can't change the effective plan).</p>
     */
    public boolean reconcileRemoteSubscription(com.stripe.model.Subscription remote) {
        if (remote == null) return false;
        String userId = metadataUserId(remote);
        if (userId == null) userId = resolveUserIdFromCustomer(remote.getCustomer());
        if (userId == null) {
            log.debug("[Stripe][reconcile] sub={} customer={} has no matching local user — skipping",
                    remote.getId(), remote.getCustomer());
            return false;
        }
        final String uid = userId;
        Subscription local = subRepo.findByStripeSubscriptionId(remote.getId())
                .or(() -> subRepo.findByUserId(uid))
                .orElse(null);

        SubscriptionStatus remoteStatus = mapStatus(remote.getStatus());
        PlanType remotePlan = determinePlan(firstPriceId(remote));

        boolean sameSubscription = local != null && remote.getId().equals(local.getStripeSubscriptionId());

        // Never let a dead remote subscription steal the local record from another one.
        if (!sameSubscription && !isLiveStatus(remoteStatus)) {
            if (local != null) {
                log.debug("[Stripe][reconcile] ignoring dead sub={} ({}) for user={} — local record tracks sub={}",
                        remote.getId(), remoteStatus, uid, local.getStripeSubscriptionId());
                return false;
            }
            // No local record at all: adopt it once so the user has a (FREE) baseline.
        }

        boolean diverged = local == null
                || !sameSubscription
                || local.getStatus() != remoteStatus
                || local.getPlanType() != remotePlan;

        PlanType userPlan = userRepo.findById(uid).map(User::getPlan).orElse(null);
        if (!diverged && userPlan != local.getEffectivePlan()) {
            diverged = true;
        }
        if (!diverged) return false;

        log.info("[Stripe][reconcile] repairing user={} sub={} local={}/{} remote={}/{}",
                uid, remote.getId(),
                local == null ? "none" : local.getPlanType(), local == null ? "none" : local.getStatus(),
                remotePlan, remoteStatus);
        applyStripeSubscription(uid, remote);
        return true;
    }


    private static String firstPriceId(com.stripe.model.Subscription sSub) {
        if (sSub.getItems() == null || sSub.getItems().getData().isEmpty()) return null;
        var item = sSub.getItems().getData().get(0);
        return item.getPrice() == null ? null : item.getPrice().getId();
    }

    @Transactional
    public void applyStripeSubscription(String userId, com.stripe.model.Subscription sSub) {
        Subscription local = subRepo.findByStripeSubscriptionId(sSub.getId())
                .or(() -> subRepo.findByUserId(userId))
                .orElseGet(Subscription::new);

        String priceId = null;
        String interval = null;
        if (sSub.getItems() != null && !sSub.getItems().getData().isEmpty()) {
            var item = sSub.getItems().getData().get(0);
            if (item.getPrice() != null) {
                priceId = item.getPrice().getId();
                if (item.getPrice().getRecurring() != null) {
                    interval = item.getPrice().getRecurring().getInterval();
                }
            }
        }

        local.setUserId(userId);
        local.setStripeSubscriptionId(sSub.getId());
        local.setStripeCustomerId(sSub.getCustomer());
        local.setStripePriceId(priceId);
        local.setBillingInterval(interval);
        local.setPlanType(determinePlan(priceId));
        local.setStatus(mapStatus(sSub.getStatus()));
        local.setCancelAtPeriodEnd(Boolean.TRUE.equals(sSub.getCancelAtPeriodEnd()));
        var subscriptionItems = sSub.getItems() == null ? null : sSub.getItems().getData();
        var periodItem = subscriptionItems == null || subscriptionItems.isEmpty()
                ? null
                : subscriptionItems.get(0);
        local.setCurrentPeriodStart(toInstant(periodItem == null ? null : periodItem.getCurrentPeriodStart()));
        local.setCurrentPeriodEnd(toInstant(periodItem == null ? null : periodItem.getCurrentPeriodEnd()));
        local.setTrialEnd(toInstant(sSub.getTrialEnd()));
        local.setCancelAt(toInstant(sSub.getCancelAt()));
        local.setCanceledAt(toInstant(sSub.getCanceledAt()));
        if (local.getCreatedAt() == null) local.setCreatedAt(Instant.now());
        local.setUpdatedAt(Instant.now());
        subRepo.save(local);

        userRepo.findById(userId).ifPresent(user -> {
            if (sSub.getCustomer() != null && user.getStripeCustomerId() == null) {
                user.setStripeCustomerId(sSub.getCustomer());
            }
            user.syncPlan(local.getEffectivePlan());
            userRepo.save(user);
        });

        log.info("[Stripe][apply] sub={} user={} plan={} status={} effective={} periodEnd={}",
                sSub.getId(), userId, local.getPlanType(), local.getStatus(),
                local.getEffectivePlan(), local.getCurrentPeriodEnd());
    }

    private PlanType determinePlan(String priceId) {
        if (priceId == null) return PlanType.FREE;
        String monthly = stripe.getPriceVisionMonthly();
        String yearly = stripe.getPriceVisionYearly();
        if ((!monthly.isBlank() && priceId.equals(monthly)) || (!yearly.isBlank() && priceId.equals(yearly))) return PlanType.VISION;
        if (priceId.startsWith("price_")) {
            log.warn("[Stripe] Unknown configured price {} mapped to VISION because VISION is the only paid plan", priceId);
            return PlanType.VISION;
        }
        return PlanType.FREE;
    }

    private SubscriptionStatus mapStatus(String s) {
        if (s == null) return SubscriptionStatus.INCOMPLETE;
        return switch (s) {
            case "active" -> SubscriptionStatus.ACTIVE;
            case "trialing" -> SubscriptionStatus.TRIALING;
            case "past_due" -> SubscriptionStatus.PAST_DUE;
            case "canceled", "cancelled" -> SubscriptionStatus.CANCELED;
            case "unpaid" -> SubscriptionStatus.UNPAID;
            default -> SubscriptionStatus.INCOMPLETE;
        };
    }

    private String metadataUserId(com.stripe.model.Subscription sub) {
        if (sub == null || sub.getMetadata() == null) return null;
        String uid = sub.getMetadata().get("user_id");
        return (uid == null || uid.isBlank()) ? null : uid;
    }

    private String resolveUserIdFromCustomer(String customerId) {
        if (customerId == null) return null;
        return userRepo.findByStripeCustomerId(customerId)
                .map(User::getId)
                .orElseGet(() -> resolveUserIdFromStripeCustomer(customerId));
    }

    private String resolveUserIdFromStripeCustomer(String customerId) {
        try {
            Customer customer = Customer.retrieve(customerId);
            if (customer == null) return null;
            String metadataUserId = customer.getMetadata() == null ? null : customer.getMetadata().get("user_id");
            if (metadataUserId != null && !metadataUserId.isBlank()) {
                userRepo.findById(metadataUserId).ifPresent(user -> {
                    if (user.getStripeCustomerId() == null || user.getStripeCustomerId().isBlank()) {
                        user.setStripeCustomerId(customerId);
                        userRepo.save(user);
                    }
                });
                return metadataUserId;
            }
            String email = customer.getEmail();
            if (email != null && !email.isBlank()) {
                return userRepo.findByEmail(email).map(user -> {
                    if (user.getStripeCustomerId() == null || user.getStripeCustomerId().isBlank()) {
                        user.setStripeCustomerId(customerId);
                        userRepo.save(user);
                    }
                    return user.getId();
                }).orElse(null);
            }
        } catch (Exception e) {
            log.warn("[Stripe] Failed to resolve customer {} from Stripe: {}", customerId, e.getMessage());
        }
        return null;
    }

    private static Instant toInstant(Long epochSeconds) {
        return epochSeconds == null ? null : Instant.ofEpochSecond(epochSeconds);
    }

    private static String getInvoiceSubscriptionId(Invoice invoice) {
        if (invoice.getParent() == null || invoice.getParent().getSubscriptionDetails() == null) {
            return null;
        }
        return invoice.getParent().getSubscriptionDetails().getSubscription();
    }

    private static StripeObject deserialize(Event event) {
        EventDataObjectDeserializer d = event.getDataObjectDeserializer();
        return d.getObject().orElseGet(() -> {
            try { return d.deserializeUnsafe(); } catch (Exception e) { return null; }
        });
    }

    /* ─────────────────── Retry for transient Stripe failures ─────────────────── */

    static <T> T withRetry(Callable<T> call, String label) {
        int attempts = 3;
        RuntimeException last = null;
        for (int i = 1; i <= attempts; i++) {
            try {
                return call.call();
            } catch (Exception e) {
                last = (e instanceof RuntimeException re) ? re : new RuntimeException(e);
                boolean transientFailure = !(e instanceof com.stripe.exception.InvalidRequestException);
                log.warn("[Stripe][retry] {} attempt {}/{} failed ({}): {}",
                        label, i, attempts, transientFailure ? "transient" : "permanent", e.getMessage());
                if (!transientFailure || i == attempts) break;
                try {
                    Thread.sleep(300L * (1L << (i - 1)));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        throw last;
    }

    /* ─────────────────── Idempotency ─────────────────── */

    /**
     * Atomically claims an event id. Returns {@code null} when the event was already
     * fully processed (duplicate delivery), otherwise the claim row to complete.
     * Relies on the unique index on {@code eventId} so two concurrent deliveries
     * cannot both win the claim.
     */
    private StripeEventLog claim(String eventId, String type) {
        StripeEventLog existing = eventLog.findByEventId(eventId).orElse(null);
        if (existing != null) {
            if (existing.getStatus() == StripeEventStatus.PROCESSED) return null;
            // Previous attempt crashed (or is stuck) — retry it.
            existing.setStatus(StripeEventStatus.PROCESSING);
            existing.setAttempts(existing.getAttempts() + 1);
            existing.setUpdatedAt(Instant.now());
            return eventLog.save(existing);
        }
        StripeEventLog entry = new StripeEventLog();
        entry.setEventId(eventId);
        entry.setEventType(type);
        entry.setStatus(StripeEventStatus.PROCESSING);
        entry.setAttempts(1);
        entry.setReceivedAt(Instant.now());
        entry.setUpdatedAt(Instant.now());
        try {
            return eventLog.insert(entry);
        } catch (DuplicateKeyException e) {
            // Another delivery of the same event won the race — it owns the work.
            log.info("[Stripe][webhook] event={} claimed concurrently — acknowledging duplicate", eventId);
            return null;
        }
    }

    private void markProcessed(StripeEventLog claim) {
        claim.setStatus(StripeEventStatus.PROCESSED);
        claim.setLastError(null);
        claim.setProcessedAt(Instant.now());
        claim.setUpdatedAt(Instant.now());
        eventLog.save(claim);
    }

    private void markFailed(StripeEventLog claim, Exception e) {
        try {
            claim.setStatus(StripeEventStatus.FAILED);
            claim.setLastError(e.getClass().getSimpleName() + ": " + e.getMessage());
            claim.setUpdatedAt(Instant.now());
            eventLog.save(claim);
        } catch (Exception persistError) {
            log.error("[Stripe][webhook] could not persist failure for event={}: {}",
                    claim.getEventId(), persistError.getMessage());
        }
    }
}