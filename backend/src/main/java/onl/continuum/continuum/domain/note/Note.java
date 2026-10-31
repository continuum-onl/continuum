package onl.continuum.continuum.domain.note;

import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Transient;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.Instant;
import java.util.List;

@Document(collection = "notes")
public class Note {
    @Id
    private String id;
    @Indexed
    private String userId;
    private String entityId;
    @Indexed
    private List<String> entityIds;
    @Indexed
    private String title;
    @Transient
    private String content;
    private String fileKey;
    @Indexed
    private String vaultId;
    @Indexed
    private String type;
    @Indexed
    private boolean favorite = false;
    @Indexed
    private List<String> workspaceIds;
    private Instant createdAt;
    private Instant updatedAt;

    public Note() {}

    public Note(String id, String userId, String entityId, List<String> entityIds, String title, String content, String fileKey, String vaultId, String type, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.userId = userId;
        this.entityId = entityId;
        this.entityIds = entityIds;
        this.title = title;
        this.content = content;
        this.fileKey = fileKey;
        this.vaultId = vaultId;
        this.type = type;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public List<String> getWorkspaceIds() { return workspaceIds; }
    public void setWorkspaceIds(List<String> workspaceIds) { this.workspaceIds = workspaceIds; }

    public boolean isFavorite() { return favorite; }
    public void setFavorite(boolean favorite) { this.favorite = favorite; }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }

    public String getEntityId() { return entityId; }
    public void setEntityId(String entityId) { this.entityId = entityId; }

    public List<String> getEntityIds() { return entityIds; }
    public void setEntityIds(List<String> entityIds) { this.entityIds = entityIds; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public String getFileKey() { return fileKey; }
    public void setFileKey(String fileKey) { this.fileKey = fileKey; }

    public String getVaultId() { return vaultId; }
    public void setVaultId(String vaultId) { this.vaultId = vaultId; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }

    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}