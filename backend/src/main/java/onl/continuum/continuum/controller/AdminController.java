package onl.continuum.continuum.controller;

import jakarta.servlet.http.HttpServletRequest;
import onl.continuum.continuum.domain.plan.PlanType;
import onl.continuum.continuum.domain.subscription.Subscription;
import onl.continuum.continuum.domain.subscription.SubscriptionRepository;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Admin API used only by the private admin panel.
 *
 * Single-admin model: access requires a valid JWT (normal login) belonging to the one account whose
 * e-mail matches the ADMIN_EMAIL env var. If ADMIN_EMAIL is not configured, every endpoint answers
 * 404 — the panel is disabled by default in self-hosted/open-source installs.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private static final Logger log = LoggerFactory.getLogger(AdminController.class);

    private final UserRepository users;
    private final SubscriptionRepository subscriptions;
    private final MongoTemplate mongo;
    private final String adminEmail;

    public AdminController(UserRepository users,
                           SubscriptionRepository subscriptions,
                           MongoTemplate mongo,
                           @Value("${ADMIN_EMAIL:}") String adminEmail) {
        this.users = users;
        this.subscriptions = subscriptions;
        this.mongo = mongo;
        this.adminEmail = adminEmail == null ? "" : adminEmail.trim().toLowerCase(Locale.ROOT);
    }

    private User guard(HttpServletRequest req, Authentication auth) {
        if (adminEmail.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        User me = null;
        if (auth != null && auth.getPrincipal() instanceof CustomUserDetails cud) {
            me = users.findById(cud.getUserId()).orElse(null);
        }
        if (me == null || me.getEmail() == null
                || !adminEmail.equals(me.getEmail().trim().toLowerCase(Locale.ROOT))) {
            log.warn("[admin] denied access from {}", req.getRemoteAddr());
            throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        }
        return me;
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest req, Authentication auth) {
        User me = guard(req, auth);
        return Map.of("email", me.getEmail(), "username", me.getUsername());
    }

    // ---------- Metrics & health ----------

    @GetMapping("/metrics")
    public Map<String, Object> metrics(HttpServletRequest req, Authentication auth) {
        guard(req, auth);
        Instant now = Instant.now();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("totalUsers", mongo.count(new Query(), "users"));
        m.put("activeUsers", mongo.count(Query.query(Criteria.where("active").is(true)), "users"));
        m.put("newUsers7d", mongo.count(Query.query(Criteria.where("createdAt").gte(now.minus(7, ChronoUnit.DAYS))), "users"));
        m.put("newUsers30d", mongo.count(Query.query(Criteria.where("createdAt").gte(now.minus(30, ChronoUnit.DAYS))), "users"));
        m.put("totalNotes", mongo.count(new Query(), "notes"));
        m.put("totalEntities", mongo.count(new Query(), "entities"));
        m.put("totalWorkspaces", mongo.count(new Query(), "workspaces"));
        Map<String, Long> byPlan = new LinkedHashMap<>();
        for (PlanType p : PlanType.values()) {
            byPlan.put(p.name(), mongo.count(Query.query(Criteria.where("plan").is(p)), "users"));
        }
        m.put("usersByPlan", byPlan);
        Runtime rt = Runtime.getRuntime();
        m.put("health", Map.of(
                "status", "UP",
                "heapUsedMb", (rt.totalMemory() - rt.freeMemory()) / 1_048_576,
                "heapMaxMb", rt.maxMemory() / 1_048_576,
                "processors", rt.availableProcessors(),
                "serverTime", now.toString()));
        return m;
    }

    // ---------- Users ----------

    @GetMapping("/users")
    public Map<String, Object> listUsers(HttpServletRequest req, Authentication auth,
                                         @RequestParam(defaultValue = "") String q,
                                         @RequestParam(defaultValue = "0") int page,
                                         @RequestParam(defaultValue = "25") int size) {
        guard(req, auth);
        size = Math.min(Math.max(size, 1), 100);
        Query query = new Query();
        if (!q.isBlank()) {
            String rx = Pattern.quote(q.trim());
            query.addCriteria(new Criteria().orOperator(
                    Criteria.where("email").regex(rx, "i"),
                    Criteria.where("username").regex(rx, "i")));
        }
        long total = mongo.count(query, User.class);
        query.with(PageRequest.of(Math.max(page, 0), size, Sort.by(Sort.Direction.DESC, "createdAt")));
        List<Map<String, Object>> items = mongo.find(query, User.class).stream().map(AdminController::toDto).toList();
        return Map.of("items", items, "total", total, "page", page, "size", size);
    }

    @PatchMapping("/users/{id}/active")
    public Map<String, Object> setActive(HttpServletRequest req, Authentication auth,
                                         @PathVariable String id, @RequestBody Map<String, Boolean> body) {
        User me = guard(req, auth);
        User u = users.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (me.getId().equals(u.getId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot change your own account");
        }
        u.setActive(Boolean.TRUE.equals(body.get("active")));
        u.setUpdatedAt(Instant.now());
        return toDto(users.save(u));
    }

    // ---------- Billing ----------

    @GetMapping("/subscriptions")
    public Map<String, Object> listSubscriptions(HttpServletRequest req, Authentication auth) {
        guard(req, auth);
        List<Subscription> subs = subscriptions.findAll(Sort.by(Sort.Direction.DESC, "createdAt"));
        Map<String, User> byId = new HashMap<>();
        users.findAllById(subs.stream().map(Subscription::getUserId).filter(Objects::nonNull).toList())
                .forEach(u -> byId.put(u.getId(), u));
        Map<String, Long> byStatus = new LinkedHashMap<>();
        List<Map<String, Object>> items = new ArrayList<>();
        for (Subscription s : subs) {
            String status = s.getStatus() == null ? "UNKNOWN" : s.getStatus().name();
            byStatus.merge(status, 1L, Long::sum);
            User u = byId.get(s.getUserId());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", s.getId());
            row.put("userEmail", u == null ? null : u.getEmail());
            row.put("plan", s.getPlanType() == null ? null : s.getPlanType().name());
            row.put("status", status);
            row.put("interval", s.getBillingInterval());
            row.put("currentPeriodEnd", s.getCurrentPeriodEnd());
            row.put("cancelAtPeriodEnd", s.getCancelAtPeriodEnd());
            row.put("stripeSubscriptionId", s.getStripeSubscriptionId());
            items.add(row);
        }
        return Map.of("items", items, "byStatus", byStatus, "total", subs.size());
    }

    private static Map<String, Object> toDto(User u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.getId());
        m.put("username", u.getUsername());
        m.put("email", u.getEmail());
        m.put("role", u.getRole());
        m.put("active", u.getActive());
        m.put("emailVerified", u.isEmailVerified());
        m.put("plan", u.getPlan() == null ? null : u.getPlan().name());
        m.put("noteCount", u.getNoteCount());
        m.put("entityCount", u.getEntityCount());
        m.put("createdAt", u.getCreatedAt());
        m.put("deletionRequestedAt", u.getDeletionRequestedAt());
        return m;
    }
}
