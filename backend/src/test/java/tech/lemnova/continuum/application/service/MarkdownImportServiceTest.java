package onl.continuum.continuum.application.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class MarkdownImportServiceTest {

    private final MarkdownImportService importService = new MarkdownImportService();

    @Test
    void parse_shouldRejectDiaryWordsShownInImportScreenshots() {
        String prose = "Hoje encontrei Emilly. Fui conversar com Bruno. Foi um dia tranquilo. "
                + "Fiz minhas tarefas. Voltei para casa. Comprei comida. Hj organizei tudo. "
                + "Aprender algo novo. Criar uma rotina melhor. ";
        MarkdownImportService.ParsedFile parsed = importService.parse("diary.md", prose.repeat(4));
        assertThat(parsed.candidates()).doesNotContainKeys("hoje", "fui", "foi", "fiz", "voltei",
                "comprei", "hj", "aprender", "criar");
        assertThat(parsed.candidates()).containsKeys("emilly", "bruno");
    }

    @Test
    void parse_shouldNotTreatParagraphAndTaskStartsAsNameEvidence() {
        MarkdownImportService.ParsedFile parsed = importService.parse("note.md",
                "# Reflexões\n\nReflexões sobre a semana\n\nReflexões sobre o trabalho\n\n"
                        + "- [ ] Organizar a mesa\n- [ ] Organizar a casa\n- [ ] Organizar o quarto");
        assertThat(parsed.candidates()).doesNotContainKeys("reflexões", "organizar");
    }

    @Test
    void parse_shouldCountLowercaseUsesWhenEvaluatingCapitalization() {
        MarkdownImportService.ParsedFile parsed = importService.parse("note.md",
                ("Anotei detalhes sobre Rotina durante a conversa. ").repeat(3)
                        + ("A rotina mudou durante a semana. ").repeat(8));
        assertThat(parsed.candidates()).doesNotContainKey("rotina");
    }

    @Test
    void parse_shouldSuppressShortNameWithOnlyOneIndependentMention() {
        MarkdownImportService.ParsedFile parsed = importService.parse("note.md",
                "Falei com Marco Antônio durante o almoço. Conversei com Marco Antônio ontem. "
                        + "Depois encontrei Marco na rua.");
        assertThat(parsed.candidates()).containsKey("marco antônio");
        assertThat(parsed.candidates()).doesNotContainKey("marco");
    }

    @Test
    void parse_shouldNeverJoinNamesAcrossSeparateLines() {
        MarkdownImportService.ParsedFile parsed = importService.parse("note.md",
                ("Conversei com Bruno\nEmilly ligou depois.\n\n").repeat(4));
        assertThat(parsed.rawCandidates()).doesNotContainKey("bruno emilly");
    }

    @Test
    void scoreCorpus_shouldPreserveExplicitProseTermEvenAfterStatisticalMention() {
        List<MarkdownImportService.ParsedFile> scored = importService.scoreCorpus(List.of(
                importService.parseForCorpus("one.md", "Conversei sobre Aurora durante a reunião."),
                importService.parseForCorpus("two.md", "---\nprojects:\n  - Aurora\n---\nVeja [[Hoje]] e #criar.")));
        assertThat(scored.get(0).candidates().get("aurora").confidence()).isEqualTo("HIGH");
        assertThat(scored.get(0).candidates().get("aurora").suggestedType()).isEqualTo("PROJECT");
        assertThat(scored.get(1).candidates()).containsKeys("hoje", "criar");
    }

    @Test
    void parse_shouldKeepRealAcronymsAndBrandsInProse() {
        MarkdownImportService.ParsedFile parsed = importService.parse("note.md",
                ("Revisei BPS no relatório e estudei para Enem depois de visitar Audi. ").repeat(4));
        assertThat(parsed.candidates()).containsKeys("bps", "enem", "audi");
    }

    @Test
    void parse_shouldDetectRepeatedSingleWordEntities() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "I met Alice during a long meeting and later spoke with Alice about the upcoming trip. After lunch I called Alice again."
        );

        assertThat(parsed.candidates()).containsKey("alice");
        assertThat(parsed.candidates().get("alice").occurrences()).isEqualTo(3);
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
    void parse_shouldNotDiscardRepeatedNamesAtSentenceStarts() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "Alice ligou depois de uma longa conversa hoje. Eu falei com Alice depois de outra conversa ontem. Mais tarde procurei Alice novamente."
        );

        assertThat(parsed.candidates()).containsKey("alice");
    }

    @Test
    void parse_shouldRequireCapitalizedNameWords() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "We discussed Project atlas. We revisited Project atlas."
        );

        assertThat(parsed.candidates()).doesNotContainKey("project atlas");
    }

    @Test
    void parse_shouldKeepOneExplicitWikiLink() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "See [[Project Atlas]] for details."
        );

        assertThat(parsed.candidates()).containsKey("project atlas");
        assertThat(parsed.candidates().get("project atlas").occurrences()).isEqualTo(1);
        assertThat(parsed.candidates().get("project atlas").confidence()).isEqualTo("HIGH");
    }

    @Test
    void scoreCorpus_shouldFindCapitalizedNamesAcrossFilesAndInferTypeFromContext() {
        List<MarkdownImportService.ParsedFile> parsedFiles = List.of(
                importService.parse("one.md", "Hoje falei com Ana Souza e discutimos o planejamento."),
                importService.parse("two.md", "Ana Souza ligou depois que revisamos o planejamento.")
        );

        List<MarkdownImportService.ParsedFile> scored = importService.scoreCorpus(parsedFiles);

        assertThat(scored).allSatisfy(file -> assertThat(file.candidates()).containsKey("ana souza"));
        assertThat(scored.get(0).candidates().get("ana souza").suggestedType()).isEqualTo("PERSON");
        assertThat(scored.get(0).candidates()).doesNotContainKey("ana");
    }

    @Test
    void parse_shouldKeepSingleFrontmatterEntityMention() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "---\npeople:\n  - Ana\n---\nI met her once."
        );

        assertThat(parsed.candidates()).containsKey("ana");
        assertThat(parsed.candidates().get("ana").occurrences()).isEqualTo(1);
        assertThat(parsed.candidates().get("ana").suggestedType()).isEqualTo("PERSON");
    }

    @Test
    void scoreCorpus_shouldNotSuggestCommonPhrasesAsEntities() {
        List<MarkdownImportService.ParsedFile> parsedFiles = List.of(
                importService.parse("one.md",
                        "O relatório final foi entregue no prazo combinado. O relatório final foi revisado no prazo combinado."),
                importService.parse("two.md",
                        "O relatório final foi entregue no prazo combinado. O relatório final foi revisado no prazo combinado.")
        );

        List<MarkdownImportService.ParsedFile> scored = importService.scoreCorpus(parsedFiles);

        assertThat(scored).allSatisfy(file -> assertThat(file.candidates()).isEmpty());
    }

    @Test
    void scoreCorpus_shouldRejectFrequentPhraseEdgesWithoutStaticNoiseLists() {
        List<MarkdownImportService.ParsedFile> parsedFiles = List.of(
                importService.parse("one.md", "Falei com Ana e depois de almoçar anotei meus planos."),
                importService.parse("two.md", "Falei com Ana e depois de caminhar anotei novas ideias.")
        );

        List<MarkdownImportService.ParsedFile> scored = importService.scoreCorpus(parsedFiles);

        assertThat(scored).allSatisfy(file -> {
            assertThat(file.candidates()).doesNotContainKey("falei com");
            assertThat(file.candidates()).doesNotContainKey("falei com ana");
            assertThat(file.candidates()).doesNotContainKey("depois de");
        });
    }

    @Test
    void parse_shouldPreserveLocalImageReferencesAsImportAssets() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "notes/note.md",
                "Before ![Diagram](../assets/image.png) after."
        );

        assertThat(parsed.assetReferences()).containsExactly("../assets/image.png");
        assertThat(parsed.content().path("content").get(1).path("type").asText()).isEqualTo("importAsset");
        assertThat(parsed.content().path("content").get(1).path("attrs").path("src").asText())
                .isEqualTo("../assets/image.png");
    }

    @Test
    void scoreCorpus_shouldRejectRepeatedProseFragmentsAtOrigin() {
        List<MarkdownImportService.ParsedFile> files = List.of(
                importService.parseForCorpus("one.md", "Celebrei o aniversário do meu avô no Brasil pela primeira vez."),
                importService.parseForCorpus("two.md", "Celebrei o aniversário do meu avô no Brasil pela primeira vez."),
                importService.parseForCorpus("three.md", "Celebrei o aniversário do meu avô no Brasil pela primeira vez.")
        );
        for (MarkdownImportService.ParsedFile file : files) {
            assertThat(file.rawCandidates()).doesNotContainKeys("aniversário do", "do meu avô", "meu avô",
                    "brasil pela", "pela primeira", "pela primeira vez", "primeira vez");
        }
        assertThat(importService.scoreCorpus(files)).allSatisfy(file ->
                assertThat(file.candidates()).containsOnlyKeys("brasil"));
    }

    @Test
    void parse_shouldRejectCapitalizedBoundaryWordsInPortugueseAndEnglish() {
        MarkdownImportService.ParsedFile file = importService.parseForCorpus("note.md",
                "Meu Avô. Brasil Pela. The Team. Team Of. Minha Casa. Your Project.");
        assertThat(file.rawCandidates()).doesNotContainKeys("meu avô", "brasil pela", "the team", "team of",
                "minha casa", "your project", "meu", "the");
    }

    @Test
    void parse_shouldKeepInternalConnectorsAndSuppressBothSingleAndMultiWordFragments() {
        MarkdownImportService.ParsedFile file = importService.parse("note.md",
                "Visitei Banco do Brasil e conversei com Marco Antônio Silva sobre planos importantes. "
                        + "Retornei ao Banco do Brasil e procurei Marco Antônio Silva para discutir novas ideias. "
                        + "Trabalhei junto ao Banco do Brasil e consultei Marco Antônio Silva sobre outro assunto.");
        assertThat(file.candidates()).containsOnlyKeys("banco do brasil", "marco antônio silva");
    }

    @Test
    void parse_shouldKeepIndependentlyMentionedShortNames() {
        MarkdownImportService.ParsedFile file = importService.parse("note.md",
                "Conversei com Marco Antônio sobre os planos de viagem. Procurei Marco Antônio para revisar os detalhes. "
                        + "Encontrei Marco durante uma longa caminhada ontem. Mais tarde telefonei para Marco novamente. "
                        + "Hoje mandei uma mensagem para Marco depois do almoço.");
        assertThat(file.candidates()).containsKeys("marco", "marco antônio");
    }

    @Test
    void parse_shouldPreserveExplicitLowercaseAndBoundaryTerms() {
        MarkdownImportService.ParsedFile file = importService.parse("note.md",
                "---\ntopics:\n  - meu avô\n---\nVeja [[pela primeira vez]], [[Marco]] e [[Marco Antônio]]. #aniversário");
        assertThat(file.candidates()).containsKeys("meu avô", "pela primeira vez", "marco", "marco antônio", "aniversário");
        assertThat(file.candidates().get("pela primeira vez").confidence()).isEqualTo("HIGH");
    }

    @Test
    void parse_shouldNotClassifyGenericContractionsAsProjects() {
        MarkdownImportService.ParsedFile file = importService.parse("note.md",
                "Revisei as tarefas do Guilherme depois de uma reunião longa. Vi as anotações no Guilherme durante a revisão. "
                        + "Conversei com Guilherme sobre o planejamento da semana. "
                        + "Trabalhei na Aurora depois do almoço. Gostei da Aurora durante a apresentação. "
                        + "Anotei detalhes sobre Aurora para consultar amanhã.");
        assertThat(file.candidates().get("guilherme").suggestedType()).isEqualTo("PERSON");
        assertThat(file.candidates().get("aurora").suggestedType()).isEqualTo("TOPIC");
    }

    @Test
    void parse_shouldStillUseExplicitProjectContext() {
        MarkdownImportService.ParsedFile file = importService.parse("note.md",
                "Revisamos o projeto Atlas durante o planejamento. Depois discutimos o projeto Atlas em outra reunião. "
                        + "Hoje retomei o projeto Atlas para organizar as próximas tarefas.");
        assertThat(file.candidates().get("atlas").suggestedType()).isEqualTo("PROJECT");
    }

    @Test
    void parse_shouldCollectLocalLinksToSupportedFilesButIgnoreExternalAssets() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "[PDF](guide.pdf) ![Remote](https://example.com/image.png)"
        );

        assertThat(parsed.assetReferences()).containsExactly("guide.pdf");
    }

    @Test
    void parse_shouldSupportObsidianAssetEmbedsWithoutChangingCodeExamples() {
        MarkdownImportService.ParsedFile parsed = importService.parse(
                "note.md",
                "![[_assets/image.png|Diagram]]\n\n`![[example.png]]`\n\n```md\n![[code.png]]\n```"
        );

        assertThat(parsed.assetReferences()).containsExactly("_assets/image.png");
        assertThat(parsed.content().path("content").get(0).path("type").asText()).isEqualTo("importAsset");
        assertThat(parsed.content().path("content").get(0).path("attrs").path("alt").asText())
                .isEqualTo("Diagram");
    }
}
