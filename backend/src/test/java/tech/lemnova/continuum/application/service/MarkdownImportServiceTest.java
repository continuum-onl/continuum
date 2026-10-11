package onl.continuum.continuum.application.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MarkdownImportServiceTest {

    private final MarkdownImportService importService = new MarkdownImportService();

    @Test
    void parse_shouldDetectRepeatedSingleWordEntities() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "I met Alice and later spoke with Alice."
        );

        assertThat(parsed.candidates()).containsKey("alice");
        assertThat(parsed.candidates().get("alice").occurrences()).isEqualTo(2);
    }

    @Test
    void parse_shouldIgnoreEntityMentionedOnlyOnce() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "I met Alice."
        );

        assertThat(parsed.candidates()).doesNotContainKey("alice");
    }

    @Test
    void parse_shouldDetectMultiWordEntitiesWithMixedCapitalization() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "We discussed Project atlas. We revisited Project atlas."
        );

        assertThat(parsed.candidates()).containsKey("project atlas");
    }

    @Test
    void parse_shouldNotCountOneWikiLinkAsMultipleMentions() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "See [[Project Atlas]] for details."
        );

        assertThat(parsed.candidates()).doesNotContainKey("project atlas");
    }
}
