package onl.continuum.continuum.controller.dto.note;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record NoteTypeCreateRequest(
        @NotBlank @Size(max = 80) String name
) {}
