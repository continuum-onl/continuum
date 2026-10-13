package onl.continuum.continuum.domain.note;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

@Document(collection = "note_types")
@CompoundIndex(name = "user_vault_name_unique", def = "{'userId': 1, 'vaultId': 1, 'name': 1}", unique = true)
public record NoteType(
        @Id String id,
        String userId,
        String vaultId,
        String name,
        Instant createdAt
) {}
