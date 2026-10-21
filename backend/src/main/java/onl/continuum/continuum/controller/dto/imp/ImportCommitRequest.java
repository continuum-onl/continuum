package onl.continuum.continuum.controller.dto.imp;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

public record ImportCommitRequest(
        List<CommitFile> files,
        List<EntityDecision> entities,
        List<CustomEntity> customEntities
) {
    public record CommitFile(
            String filename,
            String title,
            JsonNode content,
            List<String> candidateKeys,
            Long lastModified,
            List<ImportedAsset> assets
    ) {}

    public record ImportedAsset(String reference, String fileId) {}

    public record EntityDecision(
            String key,
            String name,
            String type,
            boolean accept
    ) {}

    public record CustomEntity(
            String name,
            String type
    ) {}
}
