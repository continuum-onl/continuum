package onl.continuum.continuum.application.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import onl.continuum.continuum.domain.note.Note;
import onl.continuum.continuum.domain.user.User;
import onl.continuum.continuum.domain.user.UserRepository;
import onl.continuum.continuum.infra.email.EmailService;
import onl.continuum.continuum.infra.persistence.NoteRepository;
import onl.continuum.continuum.infra.vault.VaultStorageService;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class MemoriesServiceTest {

    private NoteRepository noteRepo;
    private UserRepository userRepo;
    private VaultStorageService storage;
    private EmailService email;
    private MemoriesService service;

    @BeforeEach
    void setUp() {
        noteRepo = mock(NoteRepository.class);
        userRepo = mock(UserRepository.class);
        storage = mock(VaultStorageService.class);
        email = mock(EmailService.class);
        service = new MemoriesService(noteRepo, userRepo, storage, email);
    }

    @Test
    void feedMilestoneIncludesThreeDaysOnEitherSideOfEachMilestone() {
        int[] marks = {30, 90, 180, 365, 730, 1095};
        String[] milestones = {"30d", "90d", "180d", "365d", "2y", "3y"};

        for (int i = 0; i < marks.length; i++) {
            for (int offset = -MemoriesService.FEED_WINDOW_DAYS;
                 offset <= MemoriesService.FEED_WINDOW_DAYS; offset++) {
                assertThat(MemoriesService.feedMilestone(marks[i] + offset))
                        .as("%s days from creation", marks[i] + offset)
                        .isEqualTo(milestones[i]);
            }
        }

        assertThat(MemoriesService.feedMilestone(26)).isNull();
        assertThat(MemoriesService.feedMilestone(34)).isNull();
        assertThat(MemoriesService.feedMilestone(45)).isNull();
    }

    @Test
    void extractExcerptSkipsEmptyAndShortTiptapHeadingsAndLimitsLongParagraphs() {
        String prose = "A meaningful paragraph with enough detail to serve as a useful note preview. "
                .repeat(8);
        String content = """
                {"type":"doc","content":[
                  {"type":"heading","content":[{"type":"text","text":""}]},
                  {"type":"heading","content":[{"type":"text","text":"Short title"}]},
                  {"type":"paragraph","content":[{"type":"text","text":"%s"}]}
                ]}
                """.formatted(prose);

        String excerpt = MemoriesService.extractExcerpt(content);

        assertThat(excerpt).contains("meaningful paragraph").doesNotContain("Short title");
        assertThat(excerpt.length()).isLessThanOrEqualTo(221);
    }

    @Test
    void extractExcerptFindsSubstantialPlainTextOrMarkdownParagraph() {
        String prose = "A substantial markdown paragraph that is long enough to make a useful excerpt "
                + "instead of using a heading or a short line.";
        String markdown = "# Note title\n\nShort line\n\n" + prose;

        assertThat(MemoriesService.extractExcerpt(markdown)).isEqualTo(prose);
        assertThat(MemoriesService.extractExcerpt(prose)).isEqualTo(prose);
    }

    @Test
    void extractImageSupportsTiptapMarkdownAndHtml() {
        String imageUrl = "https://example.com/img.png";

        assertThat(MemoriesService.extractImage("""
                {"type":"doc","content":[{"type":"image","attrs":{"src":"https://example.com/img.png"}}]}
                """)).isEqualTo(imageUrl);
        assertThat(MemoriesService.extractImage("![foto](https://example.com/img.png)"))
                .isEqualTo(imageUrl);
        assertThat(MemoriesService.extractImage("<img src=\"https://example.com/img.png\" />"))
                .isEqualTo(imageUrl);
    }

    @Test
    void extractImageRejectsRelativeAndUnsafeSchemes() {
        assertThat(MemoriesService.extractImage("""
                {"type":"image","attrs":{"src":"/images/photo.png"}}
                """)).isNull();
        assertThat(MemoriesService.extractImage("![foto](/images/photo.png)")).isNull();
        assertThat(MemoriesService.extractImage("<img src=\"file:///tmp/photo.png\" />")).isNull();
        assertThat(MemoriesService.extractImage("""
                {"type":"image","attrs":{"src":"javascript:alert(1)"}}
                """)).isNull();
    }

    @Test
    void sendsAtMostOneMilestoneEmailToAUserPerDailyRun() {
        User user = user();
        Note fewerConnections = note("note-3-links", 3, richContent());
        Note mostConnected = note("note-4-links", 4, richContent());
        when(email.isEnabled()).thenReturn(true);
        when(userRepo.findAll()).thenReturn(List.of(user));
        when(noteRepo.findByUserId(user.getId())).thenReturn(List.of(fewerConnections, mostConnected));

        service.sendMilestoneEmails();

        verify(email, times(1)).sendMemory(eq(user.getEmail()), eq(user.getUsername()), eq(user.getLanguage()), any());
        verify(email).sendMemory(eq(user.getEmail()), eq(user.getUsername()), eq(user.getLanguage()),
                argThat(memory -> memory.noteId().equals("note-4-links")));
    }

    @Test
    void milestoneEmailRequiresThreeConnectionsAndASubstantialExcerpt() {
        User user = user();
        Note tooFewConnections = note("note-2-links", 2, richContent());
        Note shortExcerpt = note("note-short-excerpt", 3, "A short note preview.");
        when(email.isEnabled()).thenReturn(true);
        when(userRepo.findAll()).thenReturn(List.of(user));
        when(noteRepo.findByUserId(user.getId())).thenReturn(List.of(tooFewConnections, shortExcerpt));

        service.sendMilestoneEmails();

        verify(email, never()).sendMemory(any(), any(), any(), any());
    }

    private static User user() {
        User user = new User();
        user.setId("user-1");
        user.setEmail("user@example.com");
        user.setUsername("reader");
        user.setLanguage("en");
        return user;
    }

    private static Note note(String id, int connectionCount, String content) {
        Note note = new Note();
        note.setId(id);
        note.setTitle("Memory " + id);
        note.setUserId("user-1");
        note.setEntityIds(IntStream.range(0, connectionCount).mapToObj(i -> "entity-" + i).toList());
        note.setContent(content);
        note.setCreatedAt(LocalDate.now(ZoneOffset.UTC).minusDays(180).atStartOfDay(ZoneOffset.UTC).toInstant());
        return note;
    }

    private static String richContent() {
        return "A substantial and memorable note with enough context for a thoughtful daily rediscovery. "
                .repeat(2);
    }
}
