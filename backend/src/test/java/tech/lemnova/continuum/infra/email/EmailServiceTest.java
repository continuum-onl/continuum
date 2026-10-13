package onl.continuum.continuum.infra.email;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.assertj.core.api.Assertions.*;

class EmailServiceTest {

    @Test
    @DisplayName("welcome email is rendered with app styling and recipient locale")
    void welcomeEmailUsesAppBrandingAndLanguage() {
        EmailService emailService = new EmailService("test-key", "noreply@continuum.onl", "https://app.continuum.onl");

        String html = emailService.buildWelcomeEmail("João", "pt");

        assertThat(html)
            .contains("Continuum")
            .contains("Bem-vindo")
            .contains("https://app.continuum.onl")
            .contains("background:#000000")
            .contains("font-family:Inter");
    }

    @Test
    @DisplayName("deletion emails follow the user's language")
    void deletionEmailsUseRecipientLanguage() {
        EmailService emailService = new EmailService("test-key", "noreply@continuum.onl", "https://app.continuum.onl");

        String scheduledHtml = emailService.buildDeletionScheduledEmail("Ana", java.time.Instant.parse("2026-10-20T12:00:00Z"), "es");
        String deletedHtml = emailService.buildAccountDeletedEmail("Ana", "es");

        assertThat(scheduledHtml)
            .contains("Tu cuenta")
            .contains("Cancelar eliminación");
        assertThat(deletedHtml)
            .contains("Tu cuenta de Continuum")
            .contains("han sido eliminados");
    }

    @ParameterizedTest
    @ValueSource(strings = {"en", "es", "pt", "fr"})
    @DisplayName("all account emails share the flat app layout and favicon")
    void accountEmailsShareFlatLayout(String language) {
        EmailService service = new EmailService("", "noreply@continuum.onl", "https://app.continuum.onl/");
        String welcome = service.buildWelcomeEmail("Ana", language);
        String scheduled = service.buildDeletionScheduledEmail("Ana", java.time.Instant.parse("2026-10-20T12:00:00Z"), language);
        String deleted = service.buildAccountDeletedEmail("Ana", language);

        for (String html : java.util.List.of(welcome, scheduled, deleted)) {
            assertThat(html)
                .startsWith("<!doctype html>")
                .contains("lang=\"" + language + "\"", "https://app.continuum.onl/icon-transparent.png")
                .contains("Continuum • Capture, Connect, Resurface.")
                .contains("background:#000000", "color:#EAE8E2", "color:#A3A19B", "font-family:Inter")
                .contains("role=\"presentation\"", "name=\"viewport\"")
                .doesNotContain("favicon.png", "box-shadow", "border:1px", "border-radius:999px", "display:flex");
        }
        assertThat(welcome).contains("href=\"https://app.continuum.onl\"", "border-radius:8px");
        assertThat(scheduled).contains("href=\"https://app.continuum.onl/settings\"", "20/10/2026 12:00 UTC");
        assertThat(deleted).doesNotContain("<a ");
    }

    @Test
    @DisplayName("recipient names are escaped in all templates")
    void recipientNamesAreEscaped() {
        EmailService service = new EmailService("", "noreply@continuum.onl", "https://app.continuum.onl");
        String name = "<img src=x onerror=alert(1)> & Ana";
        for (String html : java.util.List.of(
                service.buildWelcomeEmail(name, "pt-BR"),
                service.buildDeletionScheduledEmail(name, java.time.Instant.EPOCH, "pt"),
                service.buildAccountDeletedEmail(name, "pt"))) {
            assertThat(html).contains("&lt;img src=x onerror=alert(1)&gt; &amp; Ana").doesNotContain(name);
        }
    }
}
