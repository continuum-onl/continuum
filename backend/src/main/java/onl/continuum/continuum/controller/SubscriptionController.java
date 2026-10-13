package onl.continuum.continuum.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import onl.continuum.continuum.application.exception.BadRequestException;
import onl.continuum.continuum.application.service.SubscriptionService;
import onl.continuum.continuum.controller.dto.subscription.CheckoutResponse;
import onl.continuum.continuum.controller.dto.subscription.CheckoutConfigResponse;
import onl.continuum.continuum.controller.dto.subscription.SubscriptionDTO;
import onl.continuum.continuum.infra.security.CustomUserDetails;

import java.util.Map;

@RestController
@RequestMapping("/api/subscriptions")
public class SubscriptionController {

    private final SubscriptionService subscriptionService;

    public SubscriptionController(SubscriptionService subscriptionService) {
        this.subscriptionService = subscriptionService;
    }

    @GetMapping("/me")
    public ResponseEntity<SubscriptionDTO> me(@AuthenticationPrincipal CustomUserDetails user) {
        return ResponseEntity.ok(subscriptionService.getSubscription(user.getUserId()));
    }

    /**
     * Pulls the latest state straight from Stripe. The frontend calls this right
     * after returning from Checkout, so access is granted even if the webhook is
     * delayed or lost (removes the checkout/webhook race).
     */
    @PostMapping("/sync")
    public ResponseEntity<SubscriptionDTO> sync(@AuthenticationPrincipal CustomUserDetails user) {
        return ResponseEntity.ok(subscriptionService.syncFromStripe(user.getUserId()));
    }

    @PostMapping("/checkout")
    public ResponseEntity<CheckoutResponse> checkout(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestBody Map<String, String> body) {
        String priceOrPlan = body.getOrDefault("priceId", body.get("planId"));
        if (priceOrPlan == null || priceOrPlan.isBlank())
            throw new BadRequestException("priceId or planId is required");
        return ResponseEntity.ok(
                subscriptionService.createCheckout(user.getUserId(), user.getEmail(), priceOrPlan));
    }

    @PostMapping("/checkout/embedded")
    public ResponseEntity<CheckoutResponse> embeddedCheckout(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestBody Map<String, String> body) {
        String priceOrPlan = body.getOrDefault("priceId", body.get("planId"));
        if (priceOrPlan == null || priceOrPlan.isBlank())
            throw new BadRequestException("priceId or planId is required");
        return ResponseEntity.ok(
                subscriptionService.createEmbeddedCheckout(user.getUserId(), user.getEmail(), priceOrPlan));
    }

    @GetMapping("/checkout/config")
    public ResponseEntity<CheckoutConfigResponse> checkoutConfig() {
        return ResponseEntity.ok(new CheckoutConfigResponse(subscriptionService.getCheckoutPublishableKey()));
    }

    @PostMapping("/cancel")
    public ResponseEntity<SubscriptionDTO> cancel(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestBody(required = false) Map<String, Object> body) {
        boolean immediately = body != null && Boolean.TRUE.equals(body.get("immediately"));
        return ResponseEntity.ok(subscriptionService.cancel(user.getUserId(), immediately));
    }

    @PostMapping("/change-plan")
    public ResponseEntity<SubscriptionDTO> changePlan(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestBody Map<String, String> body) {
        String priceOrPlan = body.getOrDefault("priceId", body.get("planId"));
        if (priceOrPlan == null || priceOrPlan.isBlank())
            throw new BadRequestException("priceId or planId is required");
        return ResponseEntity.ok(subscriptionService.changePlan(user.getUserId(), priceOrPlan));
    }

    @PostMapping("/portal")
    public ResponseEntity<Map<String, String>> portal(@AuthenticationPrincipal CustomUserDetails user) {
        String url = subscriptionService.createPortalSession(user.getUserId());
        return ResponseEntity.ok(Map.of("url", url));
    }

    @PostMapping("/refund")
    public ResponseEntity<Map<String, String>> refund(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestBody Map<String, Object> body) {
        boolean isAdmin = user.getAuthorities().stream()
                .anyMatch(a -> "ROLE_ADMIN".equalsIgnoreCase(a.getAuthority()));
        if (!isAdmin) {
            throw new BadRequestException("Only admins can issue refunds");
        }
        String chargeId = (String) body.get("chargeId");
        if (chargeId == null || chargeId.isBlank())
            throw new BadRequestException("chargeId is required");
        Long amount = body.get("amountCents") instanceof Number n ? n.longValue() : null;
        subscriptionService.refund(chargeId, amount);
        return ResponseEntity.ok(Map.of("status", "ok"));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// [SEC-1] Stripe webhook — path /api/webhooks/stripe bate com SecurityConfig
// ─────────────────────────────────────────────────────────────────────────────
