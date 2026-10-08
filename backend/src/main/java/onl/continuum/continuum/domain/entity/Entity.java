package onl.continuum.continuum.domain.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import jakarta.validation.constraints.NotBlank;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Document(collection = "entities")
public class Entity {

    @Id
    private String id;
    
    /**
     * User ID obrigatório para garantir isolamento de dados (SEGURANÇA: Horizontal Privilege Escalation)
     */
    @NotBlank(message = "userId é obrigatório")
    @Indexed
    private String userId;
    
    @NotBlank(message = "vaultId é obrigatório")
    @Indexed
    private String vaultId;
    
    @NotBlank(message = "title é obrigatório")
    @Indexed
    private String title;
    
    private EntityType type;
    private String description;
    private boolean favorite;
    private List<LocalDate> trackingDates;
    private String fileKey;
    private Instant createdAt;
    private Instant archivedAt;  // Added for soft-deletes

    /**
     * Método solicitado pelo TrackingService
     */
    public boolean isTrackable() {
        return type == EntityType.ACTIVITY || type == EntityType.PROJECT;
    }
}