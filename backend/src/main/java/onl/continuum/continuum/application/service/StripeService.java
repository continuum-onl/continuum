package onl.continuum.continuum.application.service;

import com.stripe.Stripe;
import com.stripe.exception.StripeException;
import com.stripe.model.Customer;
import com.stripe.model.Refund;
import com.stripe.model.Subscription;
import com.stripe.model.billingportal.Session;
import com.stripe.param.CustomerCreateParams;
import com.stripe.param.CustomerUpdateParams;
import com.stripe.param.RefundCreateParams;
import com.stripe.param.SubscriptionCancelParams;
import com.stripe.param.SubscriptionUpdateParams;
import com.stripe.param.SubscriptionListParams;
import com.stripe.param.checkout.SessionCreateParams;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import onl.continuum.continuum.application.exception.BadRequestException;
import onl.continuum.continuum.application.exception.StripeConfigurationException;
import onl.continuum.continuum.application.exception.StripeIntegrationException;
import onl.continuum.continuum.controller.dto.subscription.CheckoutResponse;

/**
 * Thin, focused wrapper around the Stripe Java SDK. All Stripe API calls used
 * by the app live here: create Checkout Session, create Billing Portal Session,
 * cancel / update a subscription, and issue refunds.
 */
@Service
public class StripeService {

    private static final Logger log = LoggerFactory.getLogger(StripeService.class);

    private final String apiKey;
    private final String successUrl;
    private final String cancelUrl;
    private final String portalReturnUrl;
    private final String priceVisionMonthly;
    private final String priceVisionYearly;
    private final long trialDays;

    public StripeService(
            @Value("${stripe.api.key:}") String apiKey,
            @Value("${stripe.checkout.success.url}") String successUrl,
            @Value("${stripe.checkout.cancel.url}") String cancelUrl,
            @Value("${stripe.portal.return.url}") String portalReturnUrl,
            @Value("${stripe.price.vision.monthly:}") String priceVisionMonthly,
            @Value("${stripe.price.vision.yearly:}") String priceVisionYearly,
            @Value("${stripe.trial.days:0}") long trialDays) {
        this.apiKey = apiKey;
        this.successUrl = successUrl;
        this.cancelUrl = cancelUrl;
        this.portalReturnUrl = portalReturnUrl;
        this.priceVisionMonthly = priceVisionMonthly;
        this.priceVisionYearly = priceVisionYearly;
        this.trialDays = trialDays;
    }

    @PostConstruct
    void init() {
        if (apiKey != null && !apiKey.isBlank()) {
            Stripe.apiKey = apiKey;
            log.info("[Stripe] SDK initialized ({} key)", apiKey.startsWith("sk_live_") ? "live" : "test");
        } else {
            log.warn("[Stripe] STRIPE_API_KEY not configured — Stripe calls will fail until set");
        }
    }

    /* ─────────────────── Customers ─────────────────── */

    public String ensureCustomer(String existingCustomerId, String userId, String email) throws StripeException {
        if (existingCustomerId != null && !existingCustomerId.isBlank()) {
            Customer customer = Customer.retrieve(existingCustomerId);
            CustomerUpdateParams.Builder update = CustomerUpdateParams.builder()
                    .putMetadata("user_id", userId);
            if (email != null && !email.isBlank()) update.setEmail(email);
            customer.update(update.build());
            return existingCustomerId;
        }
        CustomerCreateParams params = CustomerCreateParams.builder()
                .setEmail(email)
                .putMetadata("user_id", userId)
                .build();
        Customer customer = Customer.create(params);
        return customer.getId();
    }

    /* ─────────────────── Checkout ─────────────────── */

    public CheckoutResponse createCheckout(String customerId, String userId, String email, String priceOrPlan) {
        if (apiKey == null || apiKey.isBlank()) {
            throw new StripeConfigurationException("Stripe checkout is not configured on the server");
        }
        String priceId = resolvePriceId(priceOrPlan);
        if (priceId == null || priceId.isBlank()) {
            throw new BadRequestException("Invalid Stripe price or plan: " + priceOrPlan);
        }
        try {
            String cid = ensureCustomer(customerId, userId, email);

            SessionCreateParams.Builder builder = SessionCreateParams.builder()
                    .setMode(SessionCreateParams.Mode.SUBSCRIPTION)
                    .setCustomer(cid)
                    .setSuccessUrl(successUrl)
                    .setCancelUrl(cancelUrl)
                    .setAllowPromotionCodes(true)
                    .setClientReferenceId(userId)
                    .putMetadata("user_id", userId)
                    .addLineItem(
                            SessionCreateParams.LineItem.builder()
                                    .setPrice(priceId)
                                    .setQuantity(1L)
                                    .build());

            SessionCreateParams.SubscriptionData.Builder subData =
                    SessionCreateParams.SubscriptionData.builder()
                            .putMetadata("user_id", userId);
            if (trialDays > 0) subData.setTrialPeriodDays(trialDays);
            builder.setSubscriptionData(subData.build());

            com.stripe.model.checkout.Session session =
                    com.stripe.model.checkout.Session.create(builder.build());
            return new CheckoutResponse(session.getId(), session.getUrl());
        } catch (StripeException e) {
            log.error("[Stripe] Failed to create Checkout Session: {}", e.getMessage(), e);
            throw new StripeIntegrationException("Failed to create Stripe checkout: " + e.getMessage(), e);
        }
    }

    /* ─────────────────── Billing Portal ─────────────────── */

    public String createPortalSession(String customerId) {
        if (customerId == null || customerId.isBlank()) {
            throw new BadRequestException("User has no Stripe customer yet");
        }
        try {
            com.stripe.param.billingportal.SessionCreateParams params =
                    com.stripe.param.billingportal.SessionCreateParams.builder()
                            .setCustomer(customerId)
                            .setReturnUrl(portalReturnUrl)
                            .build();
            Session session = Session.create(params);
            return session.getUrl();
        } catch (StripeException e) {
            log.error("[Stripe] Failed to create Billing Portal Session: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to open billing portal: " + e.getMessage(), e);
        }
    }

    /* ─────────────────── Cancel / Update ─────────────────── */

    public Subscription cancelAtPeriodEnd(String subscriptionId) {
        try {
            Subscription sub = Subscription.retrieve(subscriptionId);
            return sub.update(SubscriptionUpdateParams.builder().setCancelAtPeriodEnd(true).build());
        } catch (StripeException e) {
            throw new RuntimeException("Failed to cancel subscription: " + e.getMessage(), e);
        }
    }

    public Subscription cancelImmediately(String subscriptionId) {
        try {
            Subscription sub = Subscription.retrieve(subscriptionId);
            return sub.cancel(SubscriptionCancelParams.builder().build());
        } catch (StripeException e) {
            throw new RuntimeException("Failed to cancel subscription: " + e.getMessage(), e);
        }
    }

    public Subscription changePlan(String subscriptionId, String newPriceOrPlan) {
        String newPrice = resolvePriceId(newPriceOrPlan);
        if (newPrice == null) throw new BadRequestException("Invalid new price/plan");
        try {
            Subscription sub = Subscription.retrieve(subscriptionId);
            String itemId = sub.getItems().getData().get(0).getId();
            SubscriptionUpdateParams params = SubscriptionUpdateParams.builder()
                    .setCancelAtPeriodEnd(false)
                    .setProrationBehavior(SubscriptionUpdateParams.ProrationBehavior.CREATE_PRORATIONS)
                    .addItem(SubscriptionUpdateParams.Item.builder()
                            .setId(itemId)
                            .setPrice(newPrice)
                            .build())
                    .build();
            return sub.update(params);
        } catch (StripeException e) {
            throw new RuntimeException("Failed to change plan: " + e.getMessage(), e);
        }
    }

    /* ─────────────────── Refunds ─────────────────── */

    public Refund refundCharge(String chargeId, Long amountCents) {
        try {
            RefundCreateParams.Builder builder = RefundCreateParams.builder().setCharge(chargeId);
            if (amountCents != null && amountCents > 0) builder.setAmount(amountCents);
            return Refund.create(builder.build());
        } catch (StripeException e) {
            throw new RuntimeException("Failed to refund: " + e.getMessage(), e);
        }
    }

    /* ─────────────────── Helpers ─────────────────── */

    /**
     * Most relevant subscription for a customer: prefers a live one
     * (active / trialing / past_due), falling back to the most recently created.
     * Used by the post-checkout sync and by the reconciliation job.
     */
    public Subscription findLatestRelevantSubscription(String customerId) throws StripeException {
        if (customerId == null || customerId.isBlank()) return null;
        var list = Subscription.list(SubscriptionListParams.builder()
                .setCustomer(customerId)
                .setStatus(SubscriptionListParams.Status.ALL)
                .setLimit(20L)
                .build());
        Subscription fallback = null;
        for (Subscription s : list.getData()) {
            if (fallback == null) fallback = s;
            String st = s.getStatus();
            if ("active".equals(st) || "trialing".equals(st) || "past_due".equals(st)) return s;
        }
        return fallback;
    }

    /** All live subscriptions on the account — the source of truth for reconciliation. */
    public Iterable<Subscription> iterateLiveSubscriptions() throws StripeException {
        return Subscription.list(SubscriptionListParams.builder()
                .setStatus(SubscriptionListParams.Status.ALL)
                .setLimit(100L)
                .build()).autoPagingIterable();
    }

    public String resolvePriceId(String value) {
        if (value == null || value.isBlank()) return null;
        if (value.startsWith("price_")) return value;
        return switch (value.toUpperCase()) {
            case "VISION", "VISION_MONTHLY" -> priceVisionMonthly;
            case "VISION_YEARLY", "VISION_ANNUAL" -> priceVisionYearly;
            default -> null;
        };
    }

    public String getPriceVisionMonthly() { return priceVisionMonthly; }
    public String getPriceVisionYearly() { return priceVisionYearly; }

    /**
     * Read-only price info straight from Stripe (base currency + any configured
     * currency_options such as BRL). Display only; Checkout decides the charge.
     */
    public java.util.Map<String, Object> getPriceDisplay(String priceId) {
        java.util.Map<String, Object> out = new java.util.HashMap<>();
        if (priceId == null || !priceId.startsWith("price_")) return out;
        try {
            com.stripe.model.Price p = com.stripe.model.Price.retrieve(priceId,
                    com.stripe.param.PriceRetrieveParams.builder().addExpand("currency_options").build(), null);
            out.put("currency", p.getCurrency());
            out.put("unitAmount", p.getUnitAmount());
            java.util.Map<String, Long> opts = new java.util.HashMap<>();
            if (p.getCurrencyOptions() != null) {
                p.getCurrencyOptions().forEach((cur, o) -> { if (o.getUnitAmount() != null) opts.put(cur, o.getUnitAmount()); });
            }
            out.put("currencyOptions", opts);
        } catch (Exception e) {
            org.slf4j.LoggerFactory.getLogger(StripeService.class)
                    .warn("[Stripe] Could not load price {}: {}", priceId, e.getMessage());
        }
        return out;
    }
}