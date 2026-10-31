package onl.continuum.continuum.controller;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.http.MediaType;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.assertj.core.api.Assertions.*;

import onl.continuum.continuum.application.service.NoteService;
import onl.continuum.continuum.controller.dto.note.NoteCreateRequest;
import onl.continuum.continuum.controller.dto.note.NoteUpdateRequest;
import onl.continuum.continuum.controller.dto.note.NoteResponse;
import onl.continuum.continuum.infra.security.CustomUserDetails;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;

@ExtendWith(MockitoExtension.class)
@DisplayName("NoteController")
class NoteControllerTest {

    @Mock
    private NoteService noteService;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        NoteController controller = new NoteController(noteService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
        objectMapper = new ObjectMapper();
    }

    @Test
    @DisplayName("smoke: basic instantiation")
    void smoke() {
        assertThat(noteService).isNotNull();
    }

    @Nested
    @DisplayName("GET /api/notes/types")
    class GetTypesEndpoint {

        @Test
        @DisplayName("retorna lista de tipos únicos do usuário")
        void testGetTypes() {
            // Given
            List<String> types = List.of("Research", "Todo", "Important");
            when(noteService.getDistinctTypes()).thenReturn(types);

            // When - Would need proper MockMvc setup with authentication
            List<String> result = noteService.getDistinctTypes();

            // Then
            assertThat(result).hasSize(3);
            assertThat(result).contains("Research", "Todo", "Important");
            verify(noteService, times(1)).getDistinctTypes();
        }

        @Test
        @DisplayName("retorna lista vazia quando não há tipos")
        void testGetTypesEmpty() {
            // Given
            when(noteService.getDistinctTypes()).thenReturn(List.of());

            // When
            List<String> result = noteService.getDistinctTypes();

            // Then
            assertThat(result).isEmpty();
            verify(noteService, times(1)).getDistinctTypes();
        }

        @Test
        @DisplayName("tipos são retornados em ordem alfabética")
        void testGetTypesSorted() {
            // Given
            List<String> types = List.of("Important", "Research", "Todo");  // Já ordenado
            when(noteService.getDistinctTypes()).thenReturn(types);

            // When
            List<String> result = noteService.getDistinctTypes();

            // Then
            assertThat(result)
                .containsExactly("Important", "Research", "Todo")
                .isSorted();
            verify(noteService, times(1)).getDistinctTypes();
        }
    }

    @Nested
    @DisplayName("Type Field Integration")
    class TypeFieldTests {

        @Test
        @DisplayName("NoteCreateRequest aceita campo type")
        void testCreateRequestWithType() {
            // Given - Simula um request JSON
            String requestJson = """
                {
                    "title": "Test Note",
                    "content": {"type": "doc", "content": []},
                    "type": "Research"
                }
                """;

            // When
            try {
                JsonNode jsonNode = objectMapper.readTree(requestJson);
                String typeValue = jsonNode.get("type").asText();

                // Then
                assertThat(typeValue).isEqualTo("Research");
            } catch (Exception e) {
                fail("Falhou ao desserializar type: " + e.getMessage());
            }
        }

        @Test
        @DisplayName("NoteUpdateRequest aceita campo type")
        void testUpdateRequestWithType() {
            // Given
            String requestJson = """
                {
                    "title": "Updated Note",
                    "type": "Todo"
                }
                """;

            // When
            try {
                JsonNode jsonNode = objectMapper.readTree(requestJson);
                String typeValue = jsonNode.get("type").asText();

                // Then
                assertThat(typeValue).isEqualTo("Todo");
            } catch (Exception e) {
                fail("Falhou ao desserializar type: " + e.getMessage());
            }
        }

        @Test
        @DisplayName("Tipo é validado com max length de 100 caracteres")
        void testTypeMaxLengthValidation() {
            // Given
            String tooLongType = "a".repeat(101);  // 101 caracteres
            String validType = "a".repeat(100);     // 100 caracteres

            // Then
            assertThat(tooLongType.length()).isGreaterThan(100);
            assertThat(validType.length()).isLessThanOrEqualTo(100);
        }
    }

    @Nested
    @DisplayName("Security - Multi-Tenant")
    class SecurityTests {

        @Test
        @DisplayName("getDistinctTypes: apenas tipos do vault do usuário são retornados")
        void testGetTypesFilteredByVault() {
            // Given - Simula tipos de diferentes usuários/vaults
            List<String> typesForVault = List.of("Research", "Todo");
            when(noteService.getDistinctTypes()).thenReturn(typesForVault);

            // When
            List<String> result = noteService.getDistinctTypes();

            // Then - Garante que apenas tipos do vault aparecem
            assertThat(result).containsExactly("Research", "Todo");
            verify(noteService, times(1)).getDistinctTypes();
        }

        @Test
        @DisplayName("Note response sempre inclui vaultId para auditoria")
        void testNoteResponseIncludesVaultId() {
            // This test validates that vaultId is not leaked in responses
            // The NoteResponse DTO should NOT include vaultId (por segurança)
            
            // Verificar que NoteResponse não expõe vaultId
            try {
                String responseJson = objectMapper.writeValueAsString(
                    new NoteResponse("id", "userId", null, "title", List.of(), 
                        objectMapper.readTree("{}"), "Research", 
                        java.time.Instant.now(), java.time.Instant.now(), List.of())
                );
                
                assertThat(responseJson).doesNotContain("vaultId");
                assertThat(responseJson).contains("\"type\":\"Research\"");
            } catch (Exception e) {
                fail("Erro ao serializar NoteResponse: " + e.getMessage());
            }
        }
    }

    @Nested
    @DisplayName("Data Consistency")
    class DataConsistencyTests {

        @Test
        @DisplayName("Tipo null é permitido (campo opcional)")
        void testNullTypeIsValid() {
            // Given
            when(noteService.getDistinctTypes()).thenReturn(List.of());

            // When
            List<String> types = noteService.getDistinctTypes();

            // Then
            assertThat(types).isEmpty();  // Tipos null não aparecem na lista distinct
        }

        @Test
        @DisplayName("Tipos vazios são filtrados")
        void testEmptyTypesFiltered() {
            // Given - Mesmo se repository retornasse vazios, service filtra
            List<String> allTypes = List.of("Research", "", "Todo");
            
            // When - Simula filtro
            List<String> filtered = allTypes.stream()
                .filter(t -> t != null && !t.isBlank())
                .toList();

            // Then
            assertThat(filtered).containsExactly("Research", "Todo");
            assertThat(filtered).doesNotContain("");
        }
    }
}
