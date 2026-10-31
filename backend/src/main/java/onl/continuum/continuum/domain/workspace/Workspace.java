package onl.continuum.continuum.domain.workspace;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/** A user-owned space (Journal, Studies, Work...) that scopes notes and entities. */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Document(collection = "workspaces")
public class Workspace {
    @Id
    private String id;
    @Indexed
    private String userId;
    private String name;
    private String color;
    private String icon;
    private Instant createdAt;
}
