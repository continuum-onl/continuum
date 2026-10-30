package onl.continuum.continuum.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import io.jsonwebtoken.Claims;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import onl.continuum.continuum.application.service.AuthService;
import onl.continuum.continuum.controller.dto.auth.*;
import onl.continuum.continuum.infra.google.GoogleOAuthService;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import onl.continuum.continuum.infra.security.OAuthStateService;
import onl.continuum.continuum.infra.security.RefreshTokenService;

@RestController
@RequestMapping("/api/auth")
@Tag(name = "Authentication", description = "Endpoints for user authentication")
public class AuthController {

    private final AuthService authService;
    private final GoogleOAuthService googleOAuthService;
    private final OAuthStateService oauthStateService;
    private final RefreshTokenService refreshTokenService;

    public AuthController(AuthService authService, 
                          GoogleOAuthService googleOAuthService, 
                          OAuthStateService oauthStateService,
                          RefreshTokenService refreshTokenService) {
        this.authService = authService;
        this.googleOAuthService = googleOAuthService;
        this.oauthStateService = oauthStateService;
        this.refreshTokenService = refreshTokenService;
    }

    @PostMapping("/register")
    @Operation(summary = "Register with email and password")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.ok(authService.register(request.username(), request.email(), request.password()));
    }

    @PostMapping("/login")
    @Operation(summary = "Login with email and password")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok(authService.login(request.email(), request.password()));
    }

    @GetMapping("/google/url")
    @Operation(summary = "Start Google OAuth2 login")
    public ResponseEntity<GoogleAuthUrlResponse> startGoogleOAuth(
            @RequestParam(value = "platform", required = false) String platform) {
        OAuthStateService.OAuthState state = oauthStateService.createState(platform);
        String authorizationUrl = googleOAuthService.buildAuthorizationUrl(
                state.redirectUri(),
                state.signedState(),
                state.nonce()
        );
        return ResponseEntity.ok(new GoogleAuthUrlResponse(authorizationUrl));
    }

    @PostMapping("/google/callback")
    @Operation(summary = "Google OAuth callback")
    public ResponseEntity<AuthResponse> googleCallback(@Valid @RequestBody GoogleAuthCallbackRequest request) {
        OAuthStateService.OAuthState state = oauthStateService.parseState(request.state());

        // CRÍTICO: o redirect_uri da troca de code DEVE ser idêntico ao enviado na
        // etapa 1. Ignoramos qualquer valor que o cliente mandar.
        GoogleOAuthService.GoogleUserInfo userInfo = googleOAuthService.exchangeCodeForUserInfo(
                request.code(),
                state.redirectUri(),
                state.nonce()
        );
        return ResponseEntity.ok(authService.googleAuth(userInfo));
    }

    @GetMapping("/me")
    @Operation(summary = "Get current user info")
    public ResponseEntity<?> getCurrentUser(@AuthenticationPrincipal CustomUserDetails user) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok(authService.getContext(user.getUserId()));
    }

    @PostMapping("/logout")
    @Operation(summary = "Logout user")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal CustomUserDetails user) {
        if (user != null) {
            authService.logout(user.getUserId());
        }
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/refresh")
    @Operation(summary = "Refresh access token using refresh token",
            description = """
                    Valida o refresh token fornecido e retorna um novo access token.
                    
                    O refresh token pode ser enviado:
                    1. Via JSON body (padrão): { "refreshToken": "..." }
                    2. Via Cookie HttpOnly (descomente @CookieValue)
                    
                    Resposta inclui:
                    - accessToken: Novo JWT access token
                    - expiresIn: Tempo de expiração em segundos
                    - tokenType: Sempre "Bearer"
                    - refreshToken: Novo refresh token (null se não usar rotation)
                    """)
    public ResponseEntity<RefreshTokenResponse> refresh(
            @Valid @RequestBody RefreshTokenRequest request,
            @RequestHeader(value = "User-Agent", required = false) String userAgent) {
        
        String refreshToken = request.refreshToken();
        
        Claims claims = refreshTokenService.validateRefreshToken(refreshToken);
        String newAccessToken = refreshTokenService.generateAccessTokenFromRefresh(claims);
        
        long expiresIn = 3600L;
        return ResponseEntity.ok(new RefreshTokenResponse(newAccessToken, expiresIn));
    }

    @GetMapping("/test-oauth")
    public ResponseEntity<String> testOAuth() {
        return ResponseEntity.ok("OAuth endpoint is working.");
    }
}
