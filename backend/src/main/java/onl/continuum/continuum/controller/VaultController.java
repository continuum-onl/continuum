package onl.continuum.continuum.controller;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import onl.continuum.continuum.application.exception.NotFoundException;
import onl.continuum.continuum.application.service.TrashService;
import java.net.URLDecoder;
import java.util.List;
import java.util.Set;
import onl.continuum.continuum.application.service.EntityIndexService;
import onl.continuum.continuum.controller.dto.vault.VaultFileDTO;
import onl.continuum.continuum.domain.plan.PlanConfiguration;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import onl.continuum.continuum.infra.vault.VaultStorageService;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@RestController
@RequestMapping("/api/vault")
public class VaultController {

    private final EntityIndexService entityIndexService;
    private final VaultStorageService vaultStorageService;
    private final PlanConfiguration planConfig;
    private final UserRepository userRepo;
    private final TrashService trashService;

    public VaultController(EntityIndexService entityIndexService, VaultStorageService vaultStorageService,
                           PlanConfiguration planConfig, UserRepository userRepo, TrashService trashService) {
        this.entityIndexService = entityIndexService;
        this.vaultStorageService = vaultStorageService;
        this.planConfig = planConfig;
        this.userRepo = userRepo;
        this.trashService = trashService;
    }

    @GetMapping(value = "/entity-index", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> getEntityIndex(@AuthenticationPrincipal CustomUserDetails userDetails) {
        User user = userRepo.findById(userDetails.getUserId())
                .orElseThrow(() -> new NotFoundException("User not found"));
        return ResponseEntity.ok(entityIndexService.loadIndex(user.getVaultId()));
    }

    @GetMapping(value = "/files", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<List<VaultFileDTO>> listFiles(@AuthenticationPrincipal CustomUserDetails userDetails) {
        User user = userRepo.findById(userDetails.getUserId())
                .orElseThrow(() -> new NotFoundException("User not found"));
        List<VaultStorageService.VaultFileDescriptor> files = activeFiles(user.getVaultId());
        return ResponseEntity.ok(files.stream().map(this::toDto).toList());
    }

    @DeleteMapping(value = "/files/{fileId}")
    public ResponseEntity<Void> deleteFile(
            @AuthenticationPrincipal CustomUserDetails userDetails,
            @PathVariable String fileId) {
        User user = userRepo.findById(userDetails.getUserId())
                .orElseThrow(() -> new NotFoundException("User not found"));

        // Spring already percent-decodes the path segment. The stored fileId may contain '+',
        // which is a valid path char (only form-encoding treats '+' as space), so do NOT
        // run URLDecoder on it — that would corrupt fileIds containing '+'.
        List<VaultStorageService.VaultFileDescriptor> files = activeFiles(user.getVaultId());
        boolean exists = files.stream().anyMatch(f -> f.fileId().equals(fileId));
        if (!exists) {
            throw new NotFoundException("File not found");
        }
        VaultStorageService.VaultFileDescriptor file = files.stream()
            .filter(f -> f.fileId().equals(fileId))
            .findFirst()
            .orElseThrow(() -> new NotFoundException("File not found"));
        trashService.trashFile(userDetails.getUserId(), user.getVaultId(), file);
        return ResponseEntity.noContent().build();
    }

    @GetMapping(value = "/files/{fileId}")
    public ResponseEntity<byte[]> downloadFile(
            @AuthenticationPrincipal CustomUserDetails userDetails,
            @PathVariable String fileId) {
        User user = userRepo.findById(userDetails.getUserId())
                .orElseThrow(() -> new NotFoundException("User not found"));

        // Do not URLDecoder.decode — see deleteFile note above.
        List<VaultStorageService.VaultFileDescriptor> files = activeFiles(user.getVaultId());
        VaultStorageService.VaultFileDescriptor descriptor = files.stream()
                .filter(f -> f.fileId().equals(fileId))
                .findFirst()
                .orElseThrow(() -> new NotFoundException("File not found"));

        byte[] fileData = vaultStorageService.loadFile(user.getVaultId(), fileId)
                .orElseThrow(() -> new NotFoundException("File not found"));

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(descriptor.contentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + descriptor.fileName() + "\"")
                .body(fileData);
    }

    private static final Set<String> ALLOWED_CONTENT_TYPES = Set.of(
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
            "audio/mpeg",
            "audio/mp4",
            "audio/x-m4a",
            "audio/m4a"
    );

    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            "jpg",
            "jpeg",
            "png",
            "webp",
            "pdf",
            "mp3",
            "m4a"
    );

    @PostMapping(value = "/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<VaultFileDTO> uploadFile(
            @AuthenticationPrincipal CustomUserDetails userDetails,
            @RequestParam("file") MultipartFile file) {
        User user = userRepo.findById(userDetails.getUserId())
                .orElseThrow(() -> new NotFoundException("User not found"));

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        String contentType = file.getContentType();
        String originalFilename = file.getOriginalFilename();
        if (!isAllowedUpload(originalFilename, contentType)) {
            return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).build();
        }

        long fileSizeBytes = file.getSize();
        long currentSizeBytes = getCurrentVaultSizeBytes(user.getVaultId());
        int maxVaultSizeMB = planConfig.getLimits(user.getPlan()).maxVaultSizeMB();

        if (maxVaultSizeMB != -1 && currentSizeBytes + fileSizeBytes > maxVaultSizeMB * 1024L * 1024L) {
            return ResponseEntity.badRequest().body(null);
        }

        String fileId = buildFileId(originalFilename);
        org.slf4j.Logger logger = org.slf4j.LoggerFactory.getLogger(VaultController.class);
        try {
            byte[] bytes = file.getBytes();
            logger.info("Vault upload start: vault={}, file={}, size={}, contentType={}",
                    user.getVaultId(), originalFilename, fileSizeBytes, contentType);
            vaultStorageService.saveFile(user.getVaultId(), fileId, bytes, contentType != null ? contentType : "application/octet-stream");
            VaultStorageService.VaultFileDescriptor saved = new VaultStorageService.VaultFileDescriptor(
                    fileId,
                    originalFilename != null ? originalFilename : fileId,
                    contentType != null ? contentType : "application/octet-stream",
                    fileSizeBytes,
                    java.time.Instant.now());
            return ResponseEntity.ok(toDto(saved));
        } catch (java.io.IOException e) {
            logger.error("Failed to read uploaded file bytes for vault {}: {}", user.getVaultId(), e.getMessage(), e);
            return ResponseEntity.internalServerError()
                    .body(null);
        } catch (software.amazon.awssdk.services.s3.model.S3Exception e) {
            logger.error("B2/S3 upload error for vault {} (file: {}, size: {}): code={}, status={}, msg={}",
                    user.getVaultId(), originalFilename, fileSizeBytes,
                    e.awsErrorDetails() != null ? e.awsErrorDetails().errorCode() : "?",
                    e.statusCode(),
                    e.awsErrorDetails() != null ? e.awsErrorDetails().errorMessage() : e.getMessage(), e);
            throw new onl.continuum.continuum.application.exception.BadRequestException(
                    "Storage upload failed: " + (e.awsErrorDetails() != null ? e.awsErrorDetails().errorMessage() : e.getMessage()));
        } catch (Exception e) {
            logger.error("Vault upload failed for vault {} (file: {}, size: {} bytes): {} - {}",
                    user.getVaultId(), originalFilename, fileSizeBytes, e.getClass().getSimpleName(), e.getMessage(), e);
            throw new onl.continuum.continuum.application.exception.BadRequestException(
                    "Upload failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private boolean isAllowedUpload(String filename, String contentType) {
        if (contentType != null && ALLOWED_CONTENT_TYPES.contains(contentType.toLowerCase())) {
            return true;
        }
        if (filename == null) {
            return false;
        }
        String lowercase = filename.toLowerCase();
        int dotIndex = lowercase.lastIndexOf('.');
        if (dotIndex < 0 || dotIndex == lowercase.length() - 1) {
            return false;
        }
        String extension = lowercase.substring(dotIndex + 1);
        return ALLOWED_EXTENSIONS.contains(extension);
    }

    private VaultFileDTO toDto(VaultStorageService.VaultFileDescriptor source) {
        return new VaultFileDTO(
                source.fileId(),
                source.fileName(),
                source.contentType(),
                source.size(),
                source.createdAt()
        );
    }

    private long getCurrentVaultSizeBytes(String vaultId) {
        return activeFiles(vaultId).stream()
                .mapToLong(VaultStorageService.VaultFileDescriptor::size)
                .sum();
    }

    private List<VaultStorageService.VaultFileDescriptor> activeFiles(String vaultId) {
        Set<String> trashedFileIds = Set.copyOf(trashService.trashedFileIds(vaultId));
        return vaultStorageService.listFiles(vaultId).stream()
                .filter(file -> !trashedFileIds.contains(file.fileId()))
                .toList();
    }

    private String buildFileId(String originalFilename) {
        String safeFilename = originalFilename == null ? "file" : URLEncoder.encode(originalFilename, StandardCharsets.UTF_8);
        return UUID.randomUUID() + "_" + safeFilename;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
