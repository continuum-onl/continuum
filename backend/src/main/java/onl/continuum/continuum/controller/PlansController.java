package onl.continuum.continuum.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import onl.continuum.continuum.application.service.StripeService;
import onl.continuum.continuum.controller.dto.plan.PlanInfo;
import onl.continuum.continuum.domain.plan.PlanConfiguration;
import onl.continuum.continuum.domain.plan.PlanType;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/plans")
public class PlansController {

    private final PlanConfiguration planConfig;
    private final StripeService stripe;

    public PlansController(PlanConfiguration planConfig, StripeService stripe) {
        this.planConfig = planConfig;
        this.stripe = stripe;
    }

    @GetMapping
    public ResponseEntity<List<PlanInfo>> list() {
        return ResponseEntity.ok(List.of(
                new PlanInfo(PlanType.FREE,   planConfig.getLimits(PlanType.FREE),   ""),
                new PlanInfo(PlanType.VISION, planConfig.getLimits(PlanType.VISION), stripe.getPriceVisionMonthly())
        ));
    }

    @GetMapping("/prices")
    public ResponseEntity<Map<String, Object>> prices() {
        return ResponseEntity.ok(Map.of(
                "vision", Map.of(
                        "monthly", stripe.getPriceVisionMonthly(),
                        "yearly",  stripe.getPriceVisionYearly(),
                        "monthlyDisplay", stripe.getPriceDisplay(stripe.getPriceVisionMonthly())
                )
        ));
    }
}
