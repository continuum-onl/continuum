package onl.continuum.continuum.controller;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import onl.continuum.continuum.application.service.MarkdownImportOrchestrator;
import onl.continuum.continuum.application.service.MarkdownImportOrchestrator.ParsedUpload;
import onl.continuum.continuum.controller.dto.imp.ImportCommitRequest;
import onl.continuum.continuum.controller.dto.imp.ImportCommitResponse;
import onl.continuum.continuum.controller.dto.imp.ImportPreviewResponse;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/import")
@Tag(name = "Import", description = "Bulk import of external content into Continuum")
public class ImportController {

    private static final int MAX_FILES = 200;
    private static final long MAX_BYTES_PER_FILE = 2 * 1024 * 1024L; // 2MB per file
    private static final long MAX_TOTAL_BYTES = 25 * 1024 * 1024L;   // 25MB total

    private final MarkdownImportOrchestrator orchestrator;

    public ImportController(MarkdownImportOrchestrator orchestrator) {
        this.orchestrator = orchestrator;
    }

    @PostMapping(value = "/markdown/preview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Preview a Markdown import", description = "Parses .md files, returns Tiptap content, detected entities, local asset references, and source timestamps without persisting.")
    public ResponseEntity<ImportPreviewResponse> preview(
            @RequestParam("files") MultipartFile[] files,
            @RequestParam(value = "paths", required = false) List<String> paths,
            @RequestParam(value = "lastModified", required = false) List<Long> lastModified
    ) throws Exception {
        if (files == null || files.length == 0) {
            return ResponseEntity.badRequest().build();
        }
        long total = 0;
        List<ParsedUpload> uploads = new ArrayList<>();
        for (int i = 0; i < files.length; i++) {
            MultipartFile f = files[i];
            if (uploads.size() >= MAX_FILES) break;
            if (f == null || f.isEmpty()) continue;
            String name = paths != null && i < paths.size() && paths.get(i) != null && !paths.get(i).isBlank()
                    ? paths.get(i)
                    : f.getOriginalFilename() == null ? "untitled.md" : f.getOriginalFilename();
            // Strip directory path to compare just the basename.
            int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
            String base = slash >= 0 ? name.substring(slash + 1) : name;
            // Only accept real `.md` files. Reject every other extension
            // (.markdown, .txt, .png, .jpg, .opus, .mp3, .pdf, .json, .html…),
            // hidden files/folders (`.DS_Store`, `.obsidian/…`) and obvious
            // binary content renamed as .md.
            if (!isAcceptedMarkdownFilename(name, base)) continue;
            if (f.getSize() > MAX_BYTES_PER_FILE) continue;
            byte[] bytes = f.getBytes();
            if (!isTextUtf8(bytes)) continue;
            total += f.getSize();
            if (total > MAX_TOTAL_BYTES) break;
            Long modifiedAt = lastModified != null && i < lastModified.size() ? lastModified.get(i) : null;
            uploads.add(new ParsedUpload(name, new String(bytes, StandardCharsets.UTF_8), modifiedAt));
        }
        return ResponseEntity.ok(orchestrator.preview(uploads));
    }

    private boolean isAcceptedMarkdownFilename(String originalName, String base) {
        if (base == null || base.isBlank() || base.startsWith(".")) return false;
        String normalized = originalName == null ? base : originalName.replace('\\', '/');
        for (String segment : normalized.split("/")) {
            if (segment.isBlank() || segment.startsWith(".")) return false;
        }
        String lower = base.toLowerCase();
        if (!lower.endsWith(".md")) return false;
        String withoutMd = lower.substring(0, lower.length() - 3);
        return !withoutMd.matches(".*\\.(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|mp3|wav|m4a|ogg|opus|flac|aac|mp4|mov|webm|avi|mkv|pdf|docx?|xlsx?|pptx?|csv|tsv|zip|rar|7z|tar|gz|exe|dmg|apk|html?|css|js|ts|tsx|jsx|json|xml|yaml|yml)$");
    }

    private boolean isTextUtf8(byte[] bytes) {
        if (bytes == null) return false;
        for (byte b : bytes) {
            if (b == 0) return false;
        }
        CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            decoder.decode(ByteBuffer.wrap(bytes));
            return true;
        } catch (CharacterCodingException ex) {
            return false;
        }
    }

    @PostMapping("/entities/relink")
    @Operation(summary = "Rebuild note↔entity connections", description = "Scans every note of the user and links entities mentioned in the text (fixes older imports).")
    public ResponseEntity<MarkdownImportOrchestrator.RelinkResponse> relink() {
        return ResponseEntity.ok(orchestrator.relinkEntities());
    }

    @PostMapping(value = "/markdown/commit", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Commit a Markdown import", description = "Persists notes, creates accepted entities, and links them based on user-approved decisions.")
    public ResponseEntity<ImportCommitResponse> commit(@RequestBody ImportCommitRequest req) {
        return ResponseEntity.ok(orchestrator.commit(req));
    }
}