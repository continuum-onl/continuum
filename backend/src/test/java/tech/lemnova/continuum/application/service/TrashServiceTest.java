package onl.continuum.continuum.application.service;

import onl.continuum.continuum.domain.trash.TrashItem;
import onl.continuum.continuum.infra.persistence.EntityRepository;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.persistence.TrashItemRepository;
import onl.continuum.continuum.infra.vault.VaultStorageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TrashServiceTest {

    @Mock
    private TrashItemRepository trashRepo;
    @Mock
    private NoteRepository noteRepo;
    @Mock
    private EntityRepository entityRepo;
    @Mock
    private VaultStorageService storage;
    @Mock
    private UserService userService;

    private TrashService trashService;

    @BeforeEach
    void setUp() {
        trashService = new TrashService(trashRepo, noteRepo, entityRepo, storage, userService);
    }

    @Test
    void trashFileSavesMetadataWithoutDeletingBlob() {
        var file = new VaultStorageService.VaultFileDescriptor(
                "file-id", "photo.png", "image/png", 1024, Instant.now());

        trashService.trashFile("user-id", "vault-id", file);

        ArgumentCaptor<TrashItem> itemCaptor = ArgumentCaptor.forClass(TrashItem.class);
        verify(trashRepo).save(itemCaptor.capture());
        TrashItem item = itemCaptor.getValue();
        assertThat(item.getKind()).isEqualTo("FILE");
        assertThat(item.getUserId()).isEqualTo("user-id");
        assertThat(item.getVaultId()).isEqualTo("vault-id");
        assertThat(item.getOriginalId()).isEqualTo("file-id");
        assertThat(item.getTitle()).isEqualTo("photo.png");
        assertThat(item.getSubtype()).isEqualTo("image/png");
        assertThat(item.getDeletedAt()).isNotNull();
        verify(storage, never()).deleteFile("vault-id", "file-id");
    }

    @Test
    void restoringFileRemovesTrashRecordAndKeepsBlob() {
        TrashItem item = TrashItem.builder()
                .id("trash-id").userId("user-id").vaultId("vault-id")
                .kind("FILE").originalId("file-id").build();
        when(trashRepo.findById("trash-id")).thenReturn(Optional.of(item));
        when(storage.loadFile("vault-id", "file-id")).thenReturn(Optional.of(new byte[] { 1 }));

        trashService.restore("user-id", "trash-id");

        verify(trashRepo).delete(item);
        verify(storage, never()).deleteFile("vault-id", "file-id");
    }

    @Test
    void purgingFileDeletesBlobBeforeTrashRecord() {
        TrashItem item = TrashItem.builder()
                .id("trash-id").userId("user-id").vaultId("vault-id")
                .kind("FILE").originalId("file-id").build();
        when(trashRepo.findById("trash-id")).thenReturn(Optional.of(item));
        InOrder order = inOrder(storage, trashRepo);

        trashService.purge("user-id", "trash-id");

        order.verify(storage).deleteFile("vault-id", "file-id");
        order.verify(trashRepo).delete(item);
    }

    @Test
    void emptyDeletesEveryTrashedFileBlob() {
        TrashItem item = TrashItem.builder()
                .id("trash-id").userId("user-id").vaultId("vault-id")
                .kind("FILE").originalId("file-id").build();
        when(trashRepo.findByUserIdOrderByDeletedAtDesc("user-id")).thenReturn(List.of(item));

        trashService.empty("user-id");

        verify(storage).deleteFile("vault-id", "file-id");
        verify(trashRepo).delete(item);
    }
}