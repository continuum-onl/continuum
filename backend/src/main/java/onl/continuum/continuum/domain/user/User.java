package onl.continuum.continuum.domain.user;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import onl.continuum.continuum.domain.plan.PlanType;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

@NoArgsConstructor
@AllArgsConstructor
@Builder
@Document(collection = "users")
public class User {

    @Id
    private String id;

    @Indexed(unique = true)
    @NotBlank @Size(min = 3, max = 50)
    private String username;

    @Indexed(unique = true)
    @NotBlank @Email
    private String email;

    @Size(max = 100)
    private String password;

    @Builder.Default
    private String role = "USER";

    @Builder.Default
    private Boolean active = false;

    private String googleId;

    private String avatarUrl;

    // Email verification fields
    @Builder.Default
    private boolean emailVerified = false;

    private String verificationToken;
    private Instant tokenExpiry;

    @Indexed(unique = true, sparse = true)
    private String stripeCustomerId;

    @Indexed(unique = true)
    private String vaultId;

    @Builder.Default
    private PlanType plan = PlanType.FREE;

    @Builder.Default
    private String theme = "CLASSIC";

    private String language;

    @Builder.Default
    private int entityCount = 0;

    @Builder.Default
    private int noteCount = 0;

    @Builder.Default
    private int activityCount = 0;

    @Builder.Default
    private Instant createdAt = Instant.now();

    @Builder.Default
    private Instant updatedAt = Instant.now();

    private Instant lastLogoutAt;

    /** When set, the account is scheduled for permanent deletion 7 days later. */
    private Instant deletionRequestedAt;

    // Getters
    public String getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getEmail() {
        return email;
    }

    public String getPassword() {
        return password;
    }

    public String getRole() {
        return role;
    }

    public Boolean getActive() {
        return active;
    }

    public String getGoogleId() {
        return googleId;
    }

    public String getAvatarUrl() {
        return avatarUrl;
    }

    public boolean isEmailVerified() {
        return emailVerified;
    }

    public String getVerificationToken() {
        return verificationToken;
    }

    public Instant getTokenExpiry() {
        return tokenExpiry;
    }

    public String getStripeCustomerId() {
        return stripeCustomerId;
    }

    public String getVaultId() {
        return vaultId;
    }

    public PlanType getPlan() {
        return plan;
    }

    public String getTheme() {
        if (theme == null || "AMOLED".equals(theme)) return "CLASSIC";
        return theme;
    }

    public String getLanguage() {
        return language;
    }

    public int getEntityCount() {
        return entityCount;
    }

    public int getNoteCount() {
        return noteCount;
    }

    public int getHabitCount() {
        return activityCount;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public Instant getLastLogoutAt() {
        return lastLogoutAt;
    }

    // Setters
    public void setId(String id) {
        this.id = id;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public void setRole(String role) {
        this.role = role;
    }

    public void setActive(Boolean active) {
        this.active = active;
    }

    public void setGoogleId(String googleId) {
        this.googleId = googleId;
    }

    public void setAvatarUrl(String avatarUrl) {
        this.avatarUrl = avatarUrl;
    }

    public void setEmailVerified(boolean emailVerified) {
        this.emailVerified = emailVerified;
    }

    public void setVerificationToken(String verificationToken) {
        this.verificationToken = verificationToken;
    }

    public void setTokenExpiry(Instant tokenExpiry) {
        this.tokenExpiry = tokenExpiry;
    }

    public void setStripeCustomerId(String stripeCustomerId) {
        this.stripeCustomerId = stripeCustomerId;
    }

    public void setVaultId(String vaultId) {
        this.vaultId = vaultId;
    }

    public void setPlan(PlanType plan) {
        this.plan = plan;
    }

    public void setTheme(String theme) {
        this.theme = theme;
    }

    public void setLanguage(String language) {
        this.language = language;
    }

    public void setEntityCount(int entityCount) {
        this.entityCount = entityCount;
    }

    public void setNoteCount(int noteCount) {
        this.noteCount = noteCount;
    }

    public void setHabitCount(int activityCount) {
        this.activityCount = activityCount;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public void setLastLogoutAt(Instant lastLogoutAt) {
        this.lastLogoutAt = lastLogoutAt;
    }

    public void syncPlan(PlanType newPlan) {
        this.plan = newPlan;
        this.updatedAt = Instant.now();
    }

    public void incrementEntityCount() {
        this.entityCount++;
        this.updatedAt = Instant.now();
    }

    public void decrementEntityCount() {
        this.entityCount = Math.max(0, this.entityCount - 1);
        this.updatedAt = Instant.now();
    }

    public void incrementNoteCount() {
        this.noteCount++;
        this.updatedAt = Instant.now();
    }

    public void decrementNoteCount() {
        this.noteCount = Math.max(0, this.noteCount - 1);
        this.updatedAt = Instant.now();
    }

    public void incrementHabitCount() {
        this.activityCount++;
        this.updatedAt = Instant.now();
    }

    public void decrementHabitCount() {
        this.activityCount = Math.max(0, this.activityCount - 1);
        this.updatedAt = Instant.now();
    }


    public Instant getDeletionRequestedAt() { return deletionRequestedAt; }
    public void setDeletionRequestedAt(Instant deletionRequestedAt) { this.deletionRequestedAt = deletionRequestedAt; }
}
