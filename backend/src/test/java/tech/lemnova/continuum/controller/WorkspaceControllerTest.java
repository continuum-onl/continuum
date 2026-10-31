package onl.continuum.continuum.controller;

import onl.continuum.continuum.application.exception.PlanLimitException;
import onl.continuum.continuum.domain.plan.PlanType;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.workspace.Workspace;
import onl.continuum.continuum.infra.persistence.EntityRepository;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.persistence.WorkspaceRepository;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class WorkspaceControllerTest {

    @Mock
    private WorkspaceRepository workspaceRepository;
    @Mock
    private NoteRepository noteRepository;
    @Mock
    private EntityRepository entityRepository;

    private WorkspaceController controller;

    @BeforeEach
    void setUp() {
        controller = new WorkspaceController(workspaceRepository, noteRepository, entityRepository);
    }

    @Test
    void freeUsersCanCreateOneCustomWorkspace() {
        CustomUserDetails user = userWithPlan(PlanType.FREE);
        when(workspaceRepository.findByUserIdOrderByCreatedAtAsc("user-1")).thenReturn(List.of());
        when(workspaceRepository.save(any(Workspace.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Workspace workspace = controller.create(user, new WorkspaceController.WorkspaceRequest("Personal", "#123456", null)).getBody();

        assertThat(workspace).isNotNull();
        assertThat(workspace.getName()).isEqualTo("Personal");
        verify(workspaceRepository).save(any(Workspace.class));
    }

    @Test
    void freeUsersCannotCreateMoreThanOneCustomWorkspace() {
        CustomUserDetails user = userWithPlan(PlanType.FREE);
        when(workspaceRepository.findByUserIdOrderByCreatedAtAsc("user-1"))
                .thenReturn(List.of(Workspace.builder().name("Personal").build()));

        assertThatThrownBy(() -> controller.create(
                user,
                new WorkspaceController.WorkspaceRequest("Work", "#123456", null)
        )).isInstanceOf(PlanLimitException.class);
        verify(workspaceRepository, never()).save(any());
    }

    @Test
    void visionUsersCanCreateUnlimitedWorkspaces() {
        CustomUserDetails user = userWithPlan(PlanType.VISION);
        when(workspaceRepository.findByUserIdOrderByCreatedAtAsc("user-1"))
                .thenReturn(List.of(Workspace.builder().name("Personal").build()));
        when(workspaceRepository.save(any(Workspace.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Workspace workspace = controller.create(user, new WorkspaceController.WorkspaceRequest("Work", "#123456", null)).getBody();

        assertThat(workspace).isNotNull();
        assertThat(workspace.getName()).isEqualTo("Work");
        verify(workspaceRepository).save(any(Workspace.class));
    }

    private CustomUserDetails userWithPlan(PlanType plan) {
        return new CustomUserDetails(User.builder()
                .id("user-1")
                .username("test-user")
                .email("test@example.com")
                .password("password")
                .role("USER")
                .active(true)
                .plan(plan)
                .build());
    }
}
