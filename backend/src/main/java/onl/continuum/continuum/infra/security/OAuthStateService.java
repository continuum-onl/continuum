package onl.continuum.continuum.infra.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import onl.continuum.continuum.application.exception.BadRequestException;

import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.util.Date;
import java.util.UUID;

@Service
public class OAuthStateService {

    private static final long STATE_EXPIRATION_MS = 5 * 60 * 1000L;
    private static final String STATE_TYPE = "oauth_state";
    
    private static final String GOOGLE_CALLBACK_PATH = "/google-callback"; 
    private static final String REACT_CALLBACK_PATH = "/google-callback";

    private final Key stateKey;
    private final String googleRedirectUrl;
    private final String finalFrontendUrl;

    public OAuthStateService(@Value("${jwt.secret}") String jwtSecret,
                             @Value("${frontend.url:https://api-continuum.vercel.app}") String frontendUrl) {
        this.stateKey = Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8));
        
        String baseUrl = frontendUrl.endsWith("/") 
                ? frontendUrl.substring(0, frontendUrl.length() - 1) 
                : frontendUrl;

        this.googleRedirectUrl = baseUrl + GOOGLE_CALLBACK_PATH;
        this.finalFrontendUrl = baseUrl + REACT_CALLBACK_PATH;
    }

    public OAuthState createState() {
        return createState(false);
    }

    /** nativeApp=true marks the flow so the web callback hands the code back to the Android app. */
    public OAuthState createState(boolean nativeApp) {
        String nonce = UUID.randomUUID().toString();
        String stateToken = Jwts.builder()
                .setSubject("google-oauth")
                .claim("type", STATE_TYPE)
                .claim("nonce", nonce)
                // IMPORTANTE: guardamos a URL EXATA enviada ao Google na etapa 1.
                // O Google exige que a etapa 2 (troca do code) use a mesma string.
                .claim("redirectUri", googleRedirectUrl)
                .claim("platform", nativeApp ? "native" : "web")
                .setIssuedAt(new Date())
                .setExpiration(new Date(System.currentTimeMillis() + STATE_EXPIRATION_MS))
                .signWith(stateKey, SignatureAlgorithm.HS256)
                .compact();
        return new OAuthState(stateToken, nonce, googleRedirectUrl);
    }

    public OAuthState parseState(String stateToken) {
        try {
            Jws<Claims> jws = Jwts.parserBuilder()
                    .setSigningKey(stateKey)
                    .build()
                    .parseClaimsJws(stateToken);

            Claims claims = jws.getBody();
            if (!STATE_TYPE.equals(claims.get("type", String.class))) {
                throw new BadRequestException("Invalid OAuth state token");
            }

            return new OAuthState(stateToken,
                                 claims.get("nonce", String.class),
                                 claims.get("redirectUri", String.class));
        } catch (Exception ex) {
            throw new BadRequestException("Google OAuth state validation failed: " + ex.getMessage());
        }
    }

    public String getGoogleRedirectUrl() { return googleRedirectUrl; }
    public String getFinalFrontendUrl() { return finalFrontendUrl; }
    public static record OAuthState(String signedState, String nonce, String redirectUri) {}
}