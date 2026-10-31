package onl.continuum.continuum.infra.security;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class OAuthStateServiceTest {

    @Test
    void createAndParseState_shouldReturnSameNonceAndRedirectUri() {
        String secret = "01234567890123456789012345678901";
        String frontendUrl = "http://localhost:5173";
        OAuthStateService service = new OAuthStateService(secret, frontendUrl, "https://admin.continuum.onl/");

        OAuthStateService.OAuthState state = service.createState();

        assertThat(state.signedState()).isNotBlank();
        assertThat(state.nonce()).isNotBlank();
        assertThat(state.redirectUri()).isEqualTo("http://localhost:5173/google-callback");

        OAuthStateService.OAuthState parsed = service.parseState(state.signedState());

        assertThat(parsed.nonce()).isEqualTo(state.nonce());
        assertThat(parsed.redirectUri()).isEqualTo(state.redirectUri());
    }

    @Test
    void createAdminState_shouldUseAdminCallbackForAuthorizationAndCodeExchange() {
        String secret = "01234567890123456789012345678901";
        OAuthStateService service = new OAuthStateService(
                secret, "http://localhost:5173", "https://admin.continuum.onl/");

        OAuthStateService.OAuthState state = service.createState("admin");
        OAuthStateService.OAuthState parsed = service.parseState(state.signedState());

        assertThat(state.redirectUri()).isEqualTo("https://admin.continuum.onl/google-callback");
        assertThat(parsed.redirectUri()).isEqualTo(state.redirectUri());
    }

    @Test
    void createNativeState_shouldKeepMainFrontendCallback() {
        String secret = "01234567890123456789012345678901";
        OAuthStateService service = new OAuthStateService(
                secret, "http://localhost:5173/", "https://admin.continuum.onl");

        OAuthStateService.OAuthState state = service.createState("native");

        assertThat(state.redirectUri()).isEqualTo("http://localhost:5173/google-callback");
    }
}
