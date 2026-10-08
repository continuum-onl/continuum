package onl.continuum.continuum.infra.vault;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.stats.CacheStats;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import onl.continuum.continuum.infra.notification.TelegramLogService;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.retry.RetryPolicy;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Service
public class BackblazeVaultStorage implements VaultStorageService {

    private static final Logger log = LoggerFactory.getLogger(BackblazeVaultStorage.class);

    private final S3Client s3;
    private final String bucket;
    private final boolean configured;
    private final TelegramLogService telegramLogService;

    /**
     * Local per-instance cache. When Render scales horizontally, instances have
     * independent caches and no cross-instance invalidation. This is acceptable
     * until a shared cache is justified.
     *
     * Missing B2 objects are intentionally cached as an empty string for up to
     * 30 minutes. The service stays active through an external ping, so this
     * cache no longer gets reset by Render sleep; explicit memory limits matter.
     * Render Free has 512 MB RAM and the Dockerfile caps the heap at 256 MB;
     * this cache is limited to 16 MB, leaving room for the rest of the stack.
     */
    private final Cache<String, String> noteContentCache = Caffeine.newBuilder()
            .maximumWeight(16L * 1024 * 1024)
            .weigher((String cacheKey, String content) ->
                    Math.max(1, content.getBytes(StandardCharsets.UTF_8).length))
            .expireAfterAccess(Duration.ofMinutes(30))
            .recordStats()
            .build();

    public BackblazeVaultStorage(VaultConfig cfg, TelegramLogService telegramLogService) {
        this.bucket = cfg.getBucketName();
        this.telegramLogService = telegramLogService;
        boolean hasCredentials = cfg.getAccessKey() != null && !cfg.getAccessKey().isBlank()
                && cfg.getSecretKey() != null && !cfg.getSecretKey().isBlank();
        this.configured = hasCredentials;

        if (!configured) {
            log.warn("B2 credentials absent — vault storage disabled (ok for local dev)");
            this.s3 = null;
            return;
        }

        String endpoint = cfg.getEndpoint().startsWith("http")
                ? cfg.getEndpoint() : "https://" + cfg.getEndpoint();

        this.s3 = S3Client.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.of(cfg.getRegion()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(cfg.getAccessKey(), cfg.getSecretKey())))
                .httpClient(UrlConnectionHttpClient.builder()
                        .connectionTimeout(Duration.ofSeconds(10))
                        .socketTimeout(Duration.ofSeconds(30))
                        .build())
                .overrideConfiguration(b -> b.retryPolicy(RetryPolicy.builder().numRetries(3).build()))
                .build();

        log.info("B2 client initialized — bucket: {}", bucket);
    }

    @PostConstruct
    public void validateBucket() {
        if (!configured) return;
        try {
            s3.headBucket(HeadBucketRequest.builder().bucket(bucket).build());
            log.info("B2 bucket '{}' validated", bucket);
        } catch (NoSuchBucketException e) {
            throw new IllegalStateException("B2 bucket '" + bucket + "' not found");
        } catch (S3Exception e) {
            throw new IllegalStateException("Cannot access B2 bucket: " + e.awsErrorDetails().errorMessage());
        }
    }

    @Override
    public void initializeVault(String vaultId) {
        if (!configured) return;
        String now = Instant.now().toString();
        put(key(vaultId, "_notes/.keep"),                  "",                "text/plain");
        put(key(vaultId, "_notes/index.json"),             "[]",              "application/json");
        put(key(vaultId, "_entities/entities.json"),       "[]",              "application/json");
        put(key(vaultId, "_entities/entity_index.json"),
                "{\"entities\":{},\"updatedAt\":\"" + now + "\"}", "application/json");
        put(key(vaultId, "_folders/folders.json"),         "[]",              "application/json");
        put(key(vaultId, "_tracking/events.json"),         "[]",              "application/json");
        put(key(vaultId, "_refs/refs.json"),               "[]",              "application/json");
        put(key(vaultId, "_files/.keep"),                  "",                "text/plain");
        log.info("Vault {} initialized", vaultId);
    }

    // ── Notes ────────────────────────────────────────────────────────────────

    @Override
    public void saveNote(String vaultId, String noteId, String content) {
        if (!configured) return;
        put(key(vaultId, "_notes/" + noteId + ".md"), content, "text/markdown");
    }

    @Override
    public String saveNoteContent(String vaultId, String noteId, String content) {
        if (!configured) return "";
        String objectKey = key(vaultId, "notes/" + noteId + ".md");
        put(objectKey, content, "text/markdown");
        return objectKey;
    }

    /**
     * Loads note content from the L1 cache or B2. A confirmed missing object is
     * cached as an empty string for up to the cache TTL to avoid repeated B2 GETs.
     */
    @Override
    public Optional<String> loadNoteContent(String vaultId, String noteId) {
        if (!configured) return Optional.empty();
        String cacheKey = noteCacheKey(vaultId, noteId);
        String cached = noteContentCache.getIfPresent(cacheKey);
        if (cached != null) {
            log.debug("Note content cache HIT: vault={}, noteId={}", vaultId, noteId);
            return Optional.of(cached);
        }

        log.debug("Note content cache MISS: vault={}, noteId={}", vaultId, noteId);
        String content = noteContentCache.get(cacheKey, ignored -> {
            log.info("Loading note content from B2: vault={}, noteId={}", vaultId, noteId);
            return get(key(vaultId, "notes/" + noteId + ".md")).orElse("");
        });
        return Optional.of(content);
    }

    @Scheduled(fixedDelay = 900_000, initialDelay = 900_000)
    public void logNoteContentCacheStats() {
        CacheStats stats = noteContentCache.stats();
        log.info("Note content cache stats: hitRate={}, hitCount={}, missCount={}, evictionCount={}, estimatedSize={}",
                stats.hitRate(), stats.hitCount(), stats.missCount(), stats.evictionCount(),
                noteContentCache.estimatedSize());
        telegramLogService.notifyServerEvent(
            "Note content cache stats",
            "hitRate=" + stats.hitRate()
                + ", hitCount=" + stats.hitCount()
                + ", missCount=" + stats.missCount()
                + ", evictionCount=" + stats.evictionCount()
                + ", estimatedSize=" + noteContentCache.estimatedSize());
    }

    @Override
    public void cacheNoteContent(String vaultId, String noteId, String content) {
        if (!configured) return;
        noteContentCache.put(noteCacheKey(vaultId, noteId), content);
        log.debug("Note content cache UPDATE: vault={}, noteId={}", vaultId, noteId);
    }

    @Override
    public void invalidateNoteContent(String vaultId, String noteId) {
        noteContentCache.invalidate(noteCacheKey(vaultId, noteId));
        log.debug("Note content cache INVALIDATE: vault={}, noteId={}", vaultId, noteId);
    }

    @Override
    public Optional<String> loadNote(String vaultId, String noteId) {
        if (!configured) return Optional.empty();
        return get(key(vaultId, "_notes/" + noteId + ".md"));
    }

    @Override
    public void deleteNote(String vaultId, String noteId) {
        invalidateNoteContent(vaultId, noteId);
        if (!configured) return;
        try {
            s3.deleteObject(DeleteObjectRequest.builder()
                    .bucket(bucket)
                    .key(key(vaultId, "notes/" + noteId + ".md"))
                    .build());
        } catch (Exception e) {
            log.warn("Failed to delete note {} from vault {}: {}", noteId, vaultId, e.getMessage());
        }
    }

    @Override
    public void saveNoteIndex(String vaultId, String indexJson) {
        if (!configured) return;
        put(key(vaultId, "_notes/index.json"), indexJson, "application/json");
    }

    @Override
    public Optional<String> loadNoteIndex(String vaultId) {
        if (!configured) return Optional.of("[]");
        return get(key(vaultId, "_notes/index.json"));
    }

    @Override
    public void saveFile(String vaultId, String fileId, byte[] content, String contentType) {
        if (!configured) return;
        String objectKey = key(vaultId, "files/" + fileId);
        s3.putObject(PutObjectRequest.builder()
                .bucket(bucket)
                .key(objectKey)
                .contentType(contentType)
                .build(), RequestBody.fromBytes(content));
        log.info("Successfully uploaded file to B2: {}", objectKey);
    }

    @Override
    public Optional<byte[]> loadFile(String vaultId, String fileId) {
        if (!configured) return Optional.empty();
        String objectKey = key(vaultId, "files/" + fileId);
        try {
            return Optional.of(s3.getObjectAsBytes(GetObjectRequest.builder().bucket(bucket).key(objectKey).build()).asByteArray());
        } catch (NoSuchKeyException e) {
            return Optional.empty();
        }
    }

    @Override
    public void deleteFile(String vaultId, String fileId) {
        if (!configured) return;
        try {
            s3.deleteObject(DeleteObjectRequest.builder()
                    .bucket(bucket)
                    .key(key(vaultId, "files/" + fileId))
                    .build());
        } catch (RuntimeException e) {
            log.warn("Failed to delete vault file {} from vault {}: {}", fileId, vaultId, e.getMessage());
            throw e;
        }
    }

    @Override
    public List<VaultStorageService.VaultFileDescriptor> listFiles(String vaultId) {
        if (!configured) return List.of();

        String prefix = key(vaultId, "files/");
        String continuationToken = null;
        List<VaultStorageService.VaultFileDescriptor> files = new ArrayList<>();

        do {
            ListObjectsV2Request.Builder request = ListObjectsV2Request.builder()
                    .bucket(bucket)
                    .prefix(prefix)
                    .maxKeys(1000);
            if (continuationToken != null) {
                request.continuationToken(continuationToken);
            }
            ListObjectsV2Response response = s3.listObjectsV2(request.build());
            for (S3Object objectSummary : response.contents()) {
                if (objectSummary.key().endsWith("/")) continue;
                String fileId = objectSummary.key().substring(prefix.length());
                if (fileId.equals(".keep")) continue;
                String fileName = decodeFileName(fileId);
                String contentType = determineContentType(fileName);
                files.add(new VaultStorageService.VaultFileDescriptor(
                        fileId,
                        fileName,
                        contentType,
                        objectSummary.size(),
                        objectSummary.lastModified()));
            }
            continuationToken = response.nextContinuationToken();
        } while (continuationToken != null);

        return files;
    }

    @Override
    public void deleteVault(String vaultId) {
        if (!configured) {
            throw new IllegalStateException("Vault storage is not configured; refusing to purge account data");
        }

        String prefix = key(vaultId, "");
        String continuationToken = null;
        do {
            ListObjectsV2Request.Builder listRequest = ListObjectsV2Request.builder()
                    .bucket(bucket)
                    .prefix(prefix)
                    .maxKeys(1000);
            if (continuationToken != null) {
                listRequest.continuationToken(continuationToken);
            }

            ListObjectsV2Response listed = s3.listObjectsV2(listRequest.build());
            List<ObjectIdentifier> objects = listed.contents().stream()
                    .map(object -> ObjectIdentifier.builder().key(object.key()).build())
                    .toList();
            if (!objects.isEmpty()) {
                DeleteObjectsResponse deleted = s3.deleteObjects(DeleteObjectsRequest.builder()
                        .bucket(bucket)
                        .delete(Delete.builder().objects(objects).build())
                        .build());
                if (!deleted.errors().isEmpty()) {
                    S3Error firstError = deleted.errors().get(0);
                    throw new IllegalStateException("Failed to delete vault object " + firstError.key()
                            + ": " + firstError.message());
                }
            }
            continuationToken = listed.nextContinuationToken();
        } while (continuationToken != null);

        String cachePrefix = vaultId + ":";
        noteContentCache.asMap().keySet().removeIf(cacheKey -> cacheKey.startsWith(cachePrefix));
        log.info("Deleted all B2 objects for vault {}", vaultId);
    }

    // ── Entities ─────────────────────────────────────────────────────────────

    @Override
    public void saveEntities(String vaultId, String entitiesJson) {
        if (!configured) return;
        put(key(vaultId, "_entities/entities.json"), entitiesJson, "application/json");
    }

    @Override
    public Optional<String> loadEntities(String vaultId) {
        if (!configured) return Optional.of("[]");
        return get(key(vaultId, "_entities/entities.json"));
    }

    @Override
    public void saveEntityIndex(String vaultId, String indexJson) {
        if (!configured) return;
        put(key(vaultId, "_entities/entity_index.json"), indexJson, "application/json");
    }

    @Override
    public Optional<String> loadEntityIndex(String vaultId) {
        if (!configured) return Optional.empty();
        return get(key(vaultId, "_entities/entity_index.json"));
    }

    // ── Folders ──────────────────────────────────────────────────────────────

    @Override
    public void saveFolders(String vaultId, String foldersJson) {
        if (!configured) return;
        put(key(vaultId, "_folders/folders.json"), foldersJson, "application/json");
    }

    @Override
    public Optional<String> loadFolders(String vaultId) {
        if (!configured) return Optional.of("[]");
        return get(key(vaultId, "_folders/folders.json"));
    }

    // ── Tracking ─────────────────────────────────────────────────────────────

    @Override
    public void saveTrackingEvents(String vaultId, String eventsJson) {
        if (!configured) return;
        put(key(vaultId, "_tracking/events.json"), eventsJson, "application/json");
    }

    @Override
    public Optional<String> loadTrackingEvents(String vaultId) {
        if (!configured) return Optional.of("[]");
        return get(key(vaultId, "_tracking/events.json"));
    }

    // ── Refs ─────────────────────────────────────────────────────────────────

    @Override
    public void saveRefs(String vaultId, String refsJson) {
        if (!configured) return;
        put(key(vaultId, "_refs/refs.json"), refsJson, "application/json");
    }

    @Override
    public Optional<String> loadRefs(String vaultId) {
        if (!configured) return Optional.of("[]");
        return get(key(vaultId, "_refs/refs.json"));
    }

    // ── Preferences ──────────────────────────────────────────────────────────

    @Override
    public void savePreferences(String vaultId, String prefsJson) {
        if (!configured) return;
        put(key(vaultId, "_prefs/preferences.json"), prefsJson, "application/json");
    }

    @Override
    public Optional<String> loadPreferences(String vaultId) {
        if (!configured) return Optional.of("{}");
        return get(key(vaultId, "_prefs/preferences.json"));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private String decodeFileName(String fileId) {
        try {
            int separator = fileId.indexOf('_');
            if (separator <= 0) {
                return URLDecoder.decode(fileId, StandardCharsets.UTF_8);
            }
            String encodedName = fileId.substring(separator + 1);
            return URLDecoder.decode(encodedName, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return fileId;
        }
    }

    private String determineContentType(String fileName) {
        try {
            return java.nio.file.Files.probeContentType(java.nio.file.Path.of(fileName));
        } catch (Exception e) {
            return "application/octet-stream";
        }
    }

    private String key(String vaultId, String rel) {
        return "vaults/" + vaultId + "/" + rel;
    }

    private String noteCacheKey(String vaultId, String noteId) {
        return vaultId + ":" + noteId;
    }

    private void put(String key, String content, String contentType) {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        s3.putObject(
                PutObjectRequest.builder().bucket(bucket).key(key).contentType(contentType).build(),
                RequestBody.fromInputStream(new ByteArrayInputStream(bytes), bytes.length));
        log.info("Successfully uploaded file to B2: {}", key);
    }

    private Optional<String> get(String key) {
        try {
            byte[] bytes = s3.getObjectAsBytes(
                    GetObjectRequest.builder().bucket(bucket).key(key).build()
            ).asByteArray();
            return Optional.of(new String(bytes, StandardCharsets.UTF_8));
        } catch (NoSuchKeyException e) {
            return Optional.empty();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// [V11-ARCH] VaultDataService — abstração de serialização/deserialização JSON
// para acesso aos dados do vault. Toda leitura/escrita de dados do usuário
// passa aqui — os services nunca manipulam JSON diretamente.
// ─────────────────────────────────────────────────────────────────────────────
