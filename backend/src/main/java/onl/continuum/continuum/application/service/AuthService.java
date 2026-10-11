package onl.continuum.continuum.application.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import onl.continuum.continuum.application.exception.BadRequestException;
import onl.continuum.continuum.application.exception.NotFoundException;
import onl.continuum.continuum.controller.dto.auth.AuthResponse;
import onl.continuum.continuum.controller.dto.auth.UserContextResponse;
import onl.continuum.continuum.domain.plan.PlanConfiguration;
import onl.continuum.continuum.domain.plan.PlanType;
import onl.continuum.continuum.domain.subscription.Subscription;
import onl.continuum.continuum.domain.subscription.SubscriptionRepository;
import onl.continuum.continuum.domain.subscription.SubscriptionStatus;
import onl.continuum.continuum.domain.token.TokenBlacklist;
import onl.continuum.continuum.domain.token.TokenBlacklistRepository;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.notification.TelegramNotificationService;
import onl.continuum.continuum.infra.security.JwtService;
import onl.continuum.continuum.infra.security.RefreshTokenService;
import onl.continuum.continuum.infra.vault.VaultStorageService;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final UserRepository users;
    private final SubscriptionRepository subscriptions;
    private final TokenBlacklistRepository tokenBlacklistRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RefreshTokenService refreshTokenService;
    private final VaultStorageService vaultStorage;
    private final TelegramNotificationService telegramNotificationService;
    private final PlanConfiguration planConfig;

    public AuthService(UserRepository users,
                       SubscriptionRepository subscriptions,
                       TokenBlacklistRepository tokenBlacklistRepository,
                       PasswordEncoder passwordEncoder,
                       JwtService jwtService,
                       RefreshTokenService refreshTokenService,
                       VaultStorageService vaultStorage,
                       TelegramNotificationService telegramNotificationService,
                       PlanConfiguration planConfig) {
        this.users = users;
        this.subscriptions = subscriptions;
        this.tokenBlacklistRepository = tokenBlacklistRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.refreshTokenService = refreshTokenService;
        this.vaultStorage = vaultStorage;
        this.telegramNotificationService = telegramNotificationService;
        this.planConfig = planConfig;
    }

    @Transactional
    public User upsertGoogleUser(String googleId, String email, String name, Boolean emailVerified, String avatarUrl) {
        if (email == null || email.isBlank()) {
            throw new BadRequestException("Google login requires an email");
        }

        User user = users.findByEmail(email).orElse(null);
        if (user == null) {
            String vaultId = UUID.randomUUID().toString().replace("-", "");
            String username = name != null && !name.isBlank() ? name : email.split("@")[0].replaceAll("[^a-zA-Z0-9]", "");
            user = User.builder()
                    .username(username)
                    .email(email)
                    .googleId(googleId)
                    .avatarUrl(avatarUrl)
                    .password(null)
                    .active(true)
                    .emailVerified(Boolean.TRUE.equals(emailVerified))
                    .role("USER")
                    .plan(PlanType.FREE)
                    .vaultId(vaultId)
                    .entityCount(0)
                    .noteCount(0)
                    .createdAt(Instant.now())
                    .updatedAt(Instant.now())
                    .build();
            user = users.save(user);
            createFreeSubscription(user.getId());
            initVaultAsync(vaultId);
            notifyTelegramNewUser(user);
        } else {
            boolean changed = false;
            if (user.getGoogleId() == null) {
                user.setGoogleId(googleId);
                changed = true;
            }
            if (avatarUrl != null && !avatarUrl.isBlank() && (user.getAvatarUrl() == null || user.getAvatarUrl().isBlank())) {
                user.setAvatarUrl(avatarUrl);
                changed = true;
            }
            if (!Boolean.TRUE.equals(user.getActive())) {
                user.setActive(true);
                changed = true;
            }
            if (!Boolean.TRUE.equals(user.isEmailVerified())) {
                user.setEmailVerified(true);
                changed = true;
            }
            if (user.getPassword() != null) {
                user.setPassword(null);
                changed = true;
            }
            if ((user.getUsername() == null || user.getUsername().isBlank()) && name != null && !name.isBlank()) {
                user.setUsername(name);
                changed = true;
            }
            if (changed) {
                user.setUpdatedAt(Instant.now());
                user = users.save(user);
            }
        }
        return user;
    }

    private void notifyTelegramNewUser(User user) {
        try {
            telegramNotificationService.notifyNewUser(user.getUsername(), user.getEmail());
        } catch (Exception e) {
            log.warn("Erro ao disparar notificação Telegram para novo usuário {} <{}>: {}", user.getUsername(), user.getEmail(), e.getMessage());
        }
    }

    @Transactional
    public AuthResponse googleAuth(String googleId, String email, String name, Boolean emailVerified, String avatarUrl) {
        boolean isNew = users.findByEmail(email).isEmpty();
        User user = upsertGoogleUser(googleId, email, name, emailVerified, avatarUrl);
        return buildAuthResponseWithTokenPair(user).withNewUserFlag(isNew);
    }

    @Transactional
    public AuthResponse googleAuth(onl.continuum.continuum.infra.google.GoogleOAuthService.GoogleUserInfo googleUser) {
        boolean isNew = users.findByEmail(googleUser.email()).isEmpty();
        User user = upsertGoogleUser(googleUser.googleId(), googleUser.email(), googleUser.name(), googleUser.emailVerified(), googleUser.picture());
        return buildAuthResponseWithTokenPair(user).withNewUserFlag(isNew);
    }


    @Transactional
    public AuthResponse register(String username, String email, String password) {
        if (email == null || email.isBlank()) throw new BadRequestException("Email is required");
        if (users.existsByEmail(email)) throw new BadRequestException("Email already in use");
        if (users.existsByUsername(username)) throw new BadRequestException("Username already in use");
        String vaultId = UUID.randomUUID().toString().replace("-", "");
        User user = User.builder()
                .username(username)
                .email(email)
                .password(password == null || password.isBlank() ? null : passwordEncoder.encode(password))
                .role("USER")
                .active(true)
                .emailVerified(true)
                .plan(PlanType.FREE)
                .vaultId(vaultId)
                .entityCount(0)
                .noteCount(0)
                .createdAt(Instant.now())
                .updatedAt(Instant.now())
                .build();
        user = users.save(user);
        createFreeSubscription(user.getId());
        initVaultAsync(vaultId);
        notifyTelegramNewUser(user);
        return buildAuthResponseWithTokenPair(user).withNewUserFlag(true);
    }

    @Transactional
    public AuthResponse login(String email, String password) {
        User user = users.findByEmail(email)
                .orElseThrow(() -> new BadRequestException("Invalid email or password"));
        if (user.getPassword() == null ? password != null && !password.isBlank() : password == null || !passwordEncoder.matches(password, user.getPassword())) {
            throw new BadRequestException("Invalid email or password");
        }
        if (!Boolean.TRUE.equals(user.getActive())) {
            throw new BadRequestException("Account is not active");
        }
        return buildAuthResponseWithTokenPair(user);
    }

    /**
     * Revoga todos os tokens do usuário (logout).
     * Atualiza lastLogoutAt para invalidar tokens anteriores.
     */
    @Transactional
    public void logout(String userId, String accessToken, String refreshToken) {
        log.info("Logout for user: {}", userId);
        
        User user = users.findById(userId).orElseThrow(() -> new NotFoundException("User not found"));
        user.setLastLogoutAt(Instant.now());
        users.save(user);
        
        // Revogar Access Token se fornecido
        if (accessToken != null && jwtService.isValid(accessToken)) {
            String jti = jwtService.extractJti(accessToken);
            if (jti != null) {
                long expirationMs = jwtService.getTimeUntilExpiration(accessToken);
                Instant expiresAt = Instant.now().plus(expirationMs, ChronoUnit.MILLIS);
                TokenBlacklist blacklistEntry = new TokenBlacklist(jti, userId, JwtService.TOKEN_TYPE_ACCESS, expiresAt);
                tokenBlacklistRepository.save(blacklistEntry);
            }
        }
        
        // Revogar Refresh Token se fornecido
        if (refreshToken != null && jwtService.isValid(refreshToken)) {
            String jti = jwtService.extractJti(refreshToken);
            if (jti != null) {
                long expirationMs = jwtService.getTimeUntilExpiration(refreshToken);
                Instant expiresAt = Instant.now().plus(expirationMs, ChronoUnit.MILLIS);
                TokenBlacklist blacklistEntry = new TokenBlacklist(jti, userId, JwtService.TOKEN_TYPE_REFRESH, expiresAt);
                tokenBlacklistRepository.save(blacklistEntry);
            }
        }
    }

    /**
     * Versão simplificada de logout.
     * Atualiza lastLogoutAt para invalidar todos os tokens anteriores.
     */
    @Transactional
    public void logout(String userId) {
        log.info("Logout for user: {} (all tokens will be invalidated via lastLogoutAt)", userId);
        User user = users.findById(userId).orElseThrow(() -> new NotFoundException("User not found"));
        user.setLastLogoutAt(Instant.now());
        users.save(user);
    }

    @Transactional
    public void updateUsername(String userId, String username) {
        User user = users.findById(userId).orElseThrow(() -> new NotFoundException("User not found"));
        user.setUsername(username);
        user.setUpdatedAt(Instant.now());
        users.save(user);
    }

    @Transactional
    public void updatePreferences(String userId, String theme, String language) {
        User user = users.findById(userId).orElseThrow(() -> new NotFoundException("User not found"));
        user.setTheme(user.getTheme());
        if (theme != null) user.setTheme(theme);
        if (language != null) user.setLanguage(language);
        user.setUpdatedAt(Instant.now());
        users.save(user);
    }

    public UserContextResponse getContext(String userId) {
        User user = users.findById(userId).orElseThrow(() -> new NotFoundException("User not found"));
        List<Subscription> subs = subscriptions.findAllByUserId(userId);
        Subscription sub = (subs == null || subs.isEmpty()) ? null : subs.stream()
                .max(Comparator.comparing(s -> s.getCurrentPeriodEnd() == null ? Instant.EPOCH : s.getCurrentPeriodEnd()))
                .orElse(null);
        PlanType effectivePlan = sub != null ? sub.getEffectivePlan() : user.getPlan();
        return UserContextResponse.from(user, sub, planConfig.getLimits(effectivePlan));
    }

    @Async
    public void initVaultAsync(String vaultId) {
        try { 
            vaultStorage.initializeVault(vaultId); 
        } catch (Exception e) {
            log.error("Erro ao inicializar vault {}: {}", vaultId, e.getMessage());
        }
    }

    private void createFreeSubscription(String userId) {
        Subscription sub = Subscription.builder()
                .userId(userId).planType(PlanType.FREE).status(SubscriptionStatus.ACTIVE)
                .currentPeriodStart(Instant.now()).currentPeriodEnd(Instant.now().plus(36500, ChronoUnit.DAYS)).build();
        subscriptions.save(sub);
    }

    /**
     * Constrói AuthResponse com TokenPair (Access + Refresh).
     */
    private AuthResponse buildAuthResponseWithTokenPair(User user) {
        // Access token (curta duração) gerado diretamente.
        String accessToken = jwtService.generateFromUser(user);
        // Refresh token (longa duração) gerado E persistido no banco para que
        // o endpoint /api/auth/refresh consiga validá-lo depois. Sem isso o
        // refresh falha com TOKEN_NOT_FOUND.
        String refreshToken = refreshTokenService.generateRefreshToken(user.getId(), "login");
        return AuthResponse.withTokenPair(
            accessToken,
            refreshToken,
            user.getId(),
            user.getUsername(),
            user.getEmail(),
            user.getPlan()
        );
    }

    /**
     * Constrói AuthResponse com apenas 1 token (compatibilidade com código antigo).
     */
    private AuthResponse buildAuthResponse(User user) {
        return new AuthResponse(jwtService.generateFromUser(user), user.getId(), user.getUsername(), user.getEmail(), user.getPlan());
    }
}