package onl.continuum.continuum.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class NoteMarkdownExporterTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void titleBecomesFilenameWithoutChangingCaseOrAccents() {
        assertEquals("2026-PATRIMONIO", NoteMarkdownExporter.filename("2026-PATRIMONIO", "id"));
        assertEquals("Meu patrimônio", NoteMarkdownExporter.filename("Meu patrimônio", "id"));
        assertEquals("A_B_C", NoteMarkdownExporter.filename("A/B\\C", "id"));
    }

    @Test
    void exportsOnlyFormattedContentFromTheProvidedNote() {
        String json = """
            {"type":"doc","content":[
              {"type":"paragraph","content":[{"type":"text","text":"Meu patrimônio durante o ano de 2026","marks":[{"type":"italic"}]}]},
              {"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"01/02/2026: 311.70R$"}]},
              {"type":"paragraph","content":[{"type":"mention","attrs":{"id":"6acbbf2db0b3214d91ec7b60","label":"Cash In"}},{"type":"text","text":": 100R$"}]},
              {"type":"horizontalRule"},
              {"type":"paragraph","content":[{"type":"mention","attrs":{"id":"6acbbf2db0b3214d91ec7b61","label":"Cash Out"}},{"type":"text","text":":"}]},
              {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"11/01/2026: 100R$ - Pai"}]}]}]},
              {"type":"horizontalRule"},{"type":"heading","attrs":{"level":2}}
            ]}
            """;
        assertEquals("""
            *Meu patrimônio durante o ano de 2026*

            # 01/02/2026: 311.70R$

            Cash In: 100R$

            ---

            Cash Out:

            - 11/01/2026: 100R$ - Pai

            ---
            """, NoteMarkdownExporter.content(json, mapper));
    }

    @Test
    void preservesExistingMarkdownUnchanged() {
        String markdown = "# Título\n\nMeu conteúdo **original**.\n";
        assertEquals(markdown, NoteMarkdownExporter.content(markdown, mapper));
    }

    @Test
    void convertsDoubleEncodedEditorContent() throws Exception {
        String json = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Conteúdo\"}]}]}";
        assertEquals("Conteúdo\n", NoteMarkdownExporter.content(mapper.writeValueAsString(json), mapper));
    }
}