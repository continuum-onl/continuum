package onl.continuum.continuum.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import onl.continuum.continuum.application.service.AuthService;
import onl.continuum.continuum.application.service.ExportService;
import onl.continuum.continuum.application.service.UserService;
import onl.continuum.continuum.controller.dto.account.UserLimitsResponse;
import onl.continuum.continuum.controller.dto.auth.UserContextResponse;
import onl.continuum.continuum.domain.plan.PlanConfiguration;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import onl.continuum.continuum.infra.vault.VaultStorageService;

import java.util.Map;
import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/api/account")
@Tag(name = "Account Management", description = "Endpoints for user account management and profile")
public class AccountController {

    private final AuthService authService;
    private final ExportService exportService;
    private final UserService userService;
    private final PlanConfiguration planConfig;
    private final UserRepository userRepo;
    private final VaultStorageService vaultStorageService;

    public AccountController(AuthService authService, ExportService exportService, UserService userService, PlanConfiguration planConfig, UserRepository userRepo, VaultStorageService vaultStorageService) {
        this.authService = authService;
        this.exportService = exportService;
        this.userService = userService;
        this.planConfig = planConfig;
        this.userRepo = userRepo;
        this.vaultStorageService = vaultStorageService;
    }

    @GetMapping("/me")
    @Operation(summary = "Get account info", description = "Retrieves the current user's account information and profile")
    public ResponseEntity<UserContextResponse> getMe(@AuthenticationPrincipal CustomUserDetails user) {
        return ResponseEntity.ok(authService.getContext(user.getUserId()));
    }

    @GetMapping("/limits")
    @Operation(summary = "Get user limits", description = "Retrieves the current user's usage limits and counts")
    public ResponseEntity<UserLimitsResponse> getLimits(@AuthenticationPrincipal CustomUserDetails user) {
        User u = userRepo.findById(user.getUserId()).orElseThrow();
        return ResponseEntity.ok(new UserLimitsResponse(
                u.getEntityCount(),
                planConfig.getLimits(u.getPlan()).maxEntities(),
                planConfig.getHistoryDays(u.getPlan())
        ));
    }

    @PatchMapping("/me")
    @Operation(summary = "Update profile", description = "Updates the user's username or email address")
    public ResponseEntity<Void> updateProfile(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestBody Map<String, String> body) {
        
        String username = body.get("username");
        String email = body.get("email");

        if (username != null && !username.isBlank()) {
            authService.updateUsername(user.getUserId(), username.trim());
        }
        
        // Email change functionality removed
        // if (email != null && !email.isBlank()) {
        //     authService.initiateEmailChange(user.getUserId(), email.trim());
        // }

        return ResponseEntity.noContent().build();
    }

    // Password change functionality removed
    // @PostMapping("/password/change")
    // @Operation(summary = "Change password", description = "Changes the user's password after verifying the current password")
    // public ResponseEntity<Void> changePassword(
    //         @AuthenticationPrincipal CustomUserDetails user,
    //         @RequestBody Map<String, String> body) {
    //     
    //     String current = body.get("currentPassword");
    //     String next = body.get("newPassword");
    //     
    //     if (current == null || next == null) return ResponseEntity.badRequest().build();
    //     
    //     authService.changePassword(user.getUserId(), current, next);
    //     return ResponseEntity.noContent().build();
    // }

    // Password reset functionality removed
    // @PostMapping("/password/forgot")
    // @Operation(summary = "Initiate password reset", description = "Sends a password reset link to the user's email")
    // public ResponseEntity<Void> forgotPassword(@RequestBody Map<String, String> body) {
    //     String email = body.get("email");
    //     if (email == null || email.isBlank()) return ResponseEntity.badRequest().build();
    //     
    //     authService.initiatePasswordReset(email.trim());
    //     return ResponseEntity.noContent().build();
    // }

    // @PostMapping("/password/reset")
    // @Operation(summary = "Complete password reset", description = "Completes the password reset process using the reset token")
    // public ResponseEntity<Void> resetPassword(@RequestBody Map<String, String> body) {
    //     String token = body.get("token");
    //     String newPass = body.get("newPassword");
    //     
    //     if (token == null || newPass == null) return ResponseEntity.badRequest().build();
    //     
    //     authService.completePasswordReset(token, newPass);
    //     return ResponseEntity.noContent().build();
    // }

    @GetMapping("/export")
    @Operation(summary = "Export user data", description = "Exports all user data (notes, entities, etc) as JSON for backup or migration")
    public ResponseEntity<String> exportData(@AuthenticationPrincipal CustomUserDetails user) {
        try {
            String jsonData = exportService.exportUserDataAsJson(user.getUserId());
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.setContentDispositionFormData("attachment", "continuum-backup.json");
            headers.add("Content-Length", String.valueOf(jsonData.getBytes(StandardCharsets.UTF_8).length));
            
            return new ResponseEntity<>(jsonData, headers, HttpStatus.OK);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                     .body("{\"error\":\"Falha ao exportar dados\"}");
        }
    }

    @GetMapping("/export/zip")
    @Operation(summary = "Export full vault as ZIP", description = "Exports the entire user vault (notes & entities as Markdown plus a JSON backup) as a .zip archive")
    public ResponseEntity<byte[]> exportVaultZip(@AuthenticationPrincipal CustomUserDetails user) {
        try {
            byte[] zip = exportService.exportVaultAsZip(user.getUserId());

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.parseMediaType("application/zip"));
            headers.setContentDispositionFormData("attachment", "continuum-vault.zip");
            headers.add("Content-Length", String.valueOf(zip.length));

            return new ResponseEntity<>(zip, headers, HttpStatus.OK);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @DeleteMapping("/me")
    @Operation(summary = "Schedule account deletion", description = "Schedules permanent deletion of the account and all data after a 7-day grace period")
    public ResponseEntity<Map<String, Object>> deleteAccount(@AuthenticationPrincipal CustomUserDetails user) {
        java.time.Instant purgeAt = userService.scheduleDeletion(user.getUserId());
        return ResponseEntity.ok(Map.of("purgeAt", purgeAt.toString()));
    }

    @DeleteMapping("/me/now")
    @Operation(summary = "Delete a scheduled account immediately", description = "Permanently deletes an account that is already scheduled for deletion")
    public ResponseEntity<Void> deleteScheduledAccountNow(@AuthenticationPrincipal CustomUserDetails user) {
        userService.purgeScheduledDeletionNow(user.getUserId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/deletion")
    @Operation(summary = "Deletion status", description = "Returns when the account will be permanently deleted, if scheduled")
    public ResponseEntity<Map<String, Object>> deletionStatus(@AuthenticationPrincipal CustomUserDetails user) {
        User u = userRepo.findById(user.getUserId()).orElseThrow();
        if (u.getDeletionRequestedAt() == null) return ResponseEntity.ok(Map.of("scheduled", false));
        return ResponseEntity.ok(Map.of("scheduled", true, "purgeAt",
                u.getDeletionRequestedAt().plus(java.time.Duration.ofDays(UserService.DELETION_GRACE_DAYS)).toString()));
    }

    @PostMapping("/deletion/cancel")
    @Operation(summary = "Cancel account deletion", description = "Restores an account scheduled for deletion")
    public ResponseEntity<Void> cancelDeletion(@AuthenticationPrincipal CustomUserDetails user) {
        userService.cancelDeletion(user.getUserId());
        return ResponseEntity.noContent().build();
    }

    @GetMapping(value = "/preferences", produces = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Get user preferences", description = "Returns user UI preferences (wallpaper, etc.) stored in the vault")
    public ResponseEntity<String> getPreferences(@AuthenticationPrincipal CustomUserDetails user) {
        User u = userRepo.findById(user.getUserId()).orElseThrow();
        String json = vaultStorageService.loadPreferences(u.getVaultId()).orElse("{}");
        return ResponseEntity.ok(json);
    }

    @PutMapping(value = "/preferences", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Save user preferences", description = "Persists user UI preferences (wallpaper, etc.) in the vault")
    public ResponseEntity<Void> savePreferences(
            @AuthenticationPrincipal CustomUserDetails user,
            @RequestBody String body) {
        User u = userRepo.findById(user.getUserId()).orElseThrow();
        String payload = (body == null || body.isBlank()) ? "{}" : body;
        vaultStorageService.savePreferences(u.getVaultId(), payload);
        return ResponseEntity.noContent().build();
    }
}