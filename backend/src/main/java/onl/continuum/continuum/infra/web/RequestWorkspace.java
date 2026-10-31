package onl.continuum.continuum.infra.web;

import java.util.List;

/**
 * Per-request active workspace, sent by the client in the X-Workspace-Id header.
 * Null means "all workspaces" (unified view).
 */
public final class RequestWorkspace {

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    /** Built-in default workspace: items without any workspace belong to it. */
    public static final String MAIN = "main";

    private RequestWorkspace() {}

    public static void set(String id) {
        if (id != null && !id.isBlank() && !"ALL".equalsIgnoreCase(id.trim())) CURRENT.set(id.trim());
    }

    public static void clear() { CURRENT.remove(); }

    public static String get() { return CURRENT.get(); }

    /** True when the item belongs to the active workspace, or no workspace is active. */
    public static boolean matches(List<String> workspaceIds) {
        String ws = CURRENT.get();
        if (ws == null) return true;
        if (MAIN.equals(ws) && (workspaceIds == null || workspaceIds.isEmpty())) return true;
        return workspaceIds != null && workspaceIds.contains(ws);
    }

    /** Workspace list for a newly created item. */
    public static List<String> forNewItem() {
        String ws = CURRENT.get();
        return ws == null || MAIN.equals(ws) ? new java.util.ArrayList<>() : new java.util.ArrayList<>(List.of(ws));
    }
}
