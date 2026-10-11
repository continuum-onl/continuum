package onl.continuum.continuum.infra.email;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

/**
 * Sends transactional emails through the Resend HTTP API.
 * Sending is asynchronous and never throws to callers; failures are logged.
 */
@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);
    private static final URI RESEND_URI = URI.create("https://api.resend.com/emails");
    private static final DateTimeFormatter DATE_FMT =
            DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm 'UTC'").withZone(ZoneOffset.UTC);

    private final String apiKey;
    private final String from;
    private final String appUrl;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper mapper = new ObjectMapper();

    public EmailService(@Value("${resend.api-key:}") String apiKey,
                        @Value("${email.from:noreply@continuum.onl}") String from,
                        @Value("${app.url:http://localhost:5173}") String appUrl) {
        this.apiKey = apiKey;
        this.from = from;
        this.appUrl = appUrl;
    }

    public boolean isEnabled() {
        return apiKey != null && !apiKey.isBlank();
    }

    public CompletableFuture<Boolean> sendDeletionScheduled(String to, String name, Instant purgeAt) {
        String who = esc(name == null || name.isBlank() ? "there" : name);
        String html = layout("Account deletion scheduled",
                "<p>Hi " + who + ",</p>"
                + "<p>Your Continuum account is scheduled to be permanently deleted on <strong>"
                + DATE_FMT.format(purgeAt) + "</strong>.</p>"
                + "<p>All notes, entities, files and activity will be erased. If you changed your mind, "
                + "sign in and cancel the deletion in Settings before that date.</p>"
                + "<p><a href=\"" + esc(appUrl) + "/settings\" style=\"display:inline-block;padding:10px 18px;"
                + "background:#000;color:#fff;text-decoration:none;border-radius:6px\">Cancel deletion</a></p>"
                + "<p style=\"color:#737373\">If you didn't request this, cancel it right away.</p>");
        return send(to, "Your Continuum account is scheduled for deletion", html);
    }

    public CompletableFuture<Boolean> sendAccountDeleted(String to, String name) {
        String who = esc(name == null || name.isBlank() ? "there" : name);
        String html = layout("Account deleted",
                "<p>Hi " + who + ",</p>"
                + "<p>Your Continuum account and all its data have been permanently deleted.</p>"
                + "<p>Thank you for using Continuum. You're always welcome back.</p>");
        return send(to, "Your Continuum account has been deleted", html);
    }

    public CompletableFuture<Boolean> send(String to, String subject, String html) {
        if (!isEnabled() || to == null || to.isBlank()) {
            log.warn("Email not sent (Resend disabled or no recipient): {}", subject);
            return CompletableFuture.completedFuture(false);
        }
        try {
            String body = mapper.writeValueAsString(Map.of(
                    "from", from, "to", List.of(to), "subject", subject, "html", html));
            HttpRequest req = HttpRequest.newBuilder(RESEND_URI)
                    .timeout(Duration.ofSeconds(15))
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();
            return http.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                    .thenApply(res -> {
                        if (res.statusCode() / 100 == 2) return true;
                        log.error("Resend failed [{}]: {}", res.statusCode(), res.body());
                        return false;
                    })
                    .exceptionally(e -> { log.error("Resend request error", e); return false; });
        } catch (Exception e) {
            log.error("Failed to build email", e);
            return CompletableFuture.completedFuture(false);
        }
    }

    private static String layout(String title, String content) {
        return "<div style=\"background:#fff;font-family:Georgia,serif;color:#000;padding:32px\">"
                + "<div style=\"max-width:520px;margin:0 auto;border:1px solid rgba(0,0,0,.08);padding:28px;border-radius:8px\">"
                + "<h1 style=\"font-weight:400;font-size:24px;margin:0 0 16px\">" + title + "</h1>"
                + "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.6\">" + content + "</div>"
                + "<p style=\"font-family:Arial,sans-serif;font-size:12px;color:#737373;margin-top:24px\">Continuum</p>"
                + "</div></div>";
    }

    private static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
