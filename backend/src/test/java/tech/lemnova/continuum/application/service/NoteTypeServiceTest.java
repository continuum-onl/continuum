package tech.lemnova.continuum.application.service;

import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.domain.note.NoteType;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.persistence.NoteTypeRepository;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NoteTypeServiceTest {
    @Mock
    private NoteTypeRepository noteTypeRepository;
    @Mock
    private NoteRepository noteRepository;

    private NoteTypeService service;

    @BeforeEach
    void setUp() {
        service = new NoteTypeService(noteTypeRepository, noteRepository);
        User user = User.builder()
                .id("user-1")
                .username("tester")
                .email("tester@example.com")
                .password("password")
                .role("USER")
                .active(true)
                .vaultId("vault-1")
                .build();
        CustomUserDetails principal = new CustomUserDetails(user);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities()));
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void createsTrimmedTypeForCurrentVault() {
        when(noteTypeRepository.findByUserIdAndVaultIdAndName("user-1", "vault-1", "Research"))
                .thenReturn(Optional.empty());
        when(noteTypeRepository.save(any(NoteType.class))).thenAnswer(invocation -> invocation.getArgument(0));

        assertThat(service.create("  Research  ")).isEqualTo("Research");
        verify(noteTypeRepository).save(any(NoteType.class));
    }

    @Test
    void deletingTypeClearsItsAssignmentsOnlyInCurrentVault() {
        Note note = new Note();
        note.setId("note-1");
        note.setUserId("user-1");
        note.setVaultId("vault-1");
        note.setType("Research");
        when(noteRepository.findByUserIdAndTypeAndVaultId("user-1", "Research", "vault-1"))
                .thenReturn(List.of(note));

        service.delete(" Research ");

        assertThat(note.getType()).isNull();
        assertThat(note.getUpdatedAt()).isAfterOrEqualTo(Instant.now().minusSeconds(5));
        verify(noteRepository).saveAll(List.of(note));
        verify(noteTypeRepository).deleteByUserIdAndVaultIdAndName("user-1", "vault-1", "Research");
    }
}
