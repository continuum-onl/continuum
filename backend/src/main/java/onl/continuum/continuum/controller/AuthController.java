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
            @org.springframework.web.bind.annotation.RequestParam(value = "platform", required = false) String platform) {
        OAuthStateService.OAuthState state = oauthStateService.createState("native".equalsIgnoreCase(platform));
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
            // Alternativa: receber de Cookie HttpOnly
            // @CookieValue(value = "refreshToken", required = false) String refreshTokenFromCookie
            @RequestHeader(value = "User-Agent", required = false) String userAgent) {
        
        String refreshToken = request.refreshToken();
        
        // Valida o refresh token
        Claims claims = refreshTokenService.validateRefreshToken(refreshToken);
        
        // Gera novo access token
        String newAccessToken = refreshTokenService.generateAccessTokenFromRefresh(claims);
        
        // Tempo de expiração: 1 hora em segundos
        long expiresIn = 3600L;
        
        // Retorna resposta (sem rotação de refresh token neste exemplo)
        // Para rotação, use: RefreshTokenResponse.withRotation(newAccessToken, expiresIn, newRefreshToken)
        return ResponseEntity.ok(new RefreshTokenResponse(newAccessToken, expiresIn));
    }

    /**
     * ALTERNATIVA: Endpoint com rotação de refresh token.
     * Use este se quiser gerar um novo refresh token a cada refresh (mais seguro).
     * 
     * Descomente para usar rotation:
     */
    /*
    @PostMapping("/refresh-with-rotation")
    @Operation(summary = "Refresh access token with rotation (more secure)",
            description = """
                    Valida o refresh token e retorna novo access token E novo refresh token.
                    Revoga o refresh token antigo automaticamente.
                    """)
    public ResponseEntity<RefreshTokenResponse> refreshWithRotation(
            @Valid @RequestBody RefreshTokenRequest request,
            @RequestHeader(value = "User-Agent", required = false) String userAgent) {
        
        String oldRefreshToken = request.refreshToken();
        
        // Valida refresh token
        Claims claims = refreshTokenService.validateRefreshToken(oldRefreshToken);
        String userId = claims.get("userId", String.class);
        
        // Gera novo access token
        String newAccessToken = refreshTokenService.generateAccessTokenFromRefresh(claims);
        
        // Gera novo refresh token
        String newRefreshToken = refreshTokenService.generateRefreshToken(userId, userAgent);
        
        // Revoga o token antigo
        refreshTokenService.revokeToken(oldRefreshToken);
        
        long expiresIn = 3600L;
        return ResponseEntity.ok(RefreshTokenResponse.withRotation(newAccessToken, expiresIn, newRefreshToken));
    }
    */

    @GetMapping("/test-oauth")
    public ResponseEntity<String> testOAuth() {
        return ResponseEntity.ok("OAuth endpoint is working.");
    }
}