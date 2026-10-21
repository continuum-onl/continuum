import type { Entity } from "@/types";

type JsonRecord = Record<string, unknown>;

export interface TiptapNode extends JsonRecord {
  type?: string;
  text?: string;
  attrs?: JsonRecord;
  content?: TiptapNode[];
}

export type MentionTargetType = "note" | "entity";

export function resolveMentionTargetType(...types: Array<string | null | undefined>): MentionTargetType {
  return types.some((type) => type?.toLowerCase() === "note") ? "note" : "entity";
}

export function getMentionClickTarget(target: Element): { id: string; type: MentionTargetType } | null {
  const mention = target.closest<HTMLElement>(
    '[data-id][data-mention-type], [data-id][data-type="NOTE"], [data-id][data-type="ENTITY"], [data-id].continuum-entity-mention, [data-id].continuum-note-mention',
  );
  const id = mention?.getAttribute("data-id")?.trim();
  if (!mention || !id) return null;

  return {
    id,
    type: resolveMentionTargetType(
      mention.getAttribute("data-mention-type"),
      mention.getAttribute("data-type"),
      mention.classList.contains("continuum-note-mention") ? "note" : null,
    ),
  };
}

const MAX_PARSE_DEPTH = 6;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const createTextNode = (text: string): TiptapNode => ({ type: "text", text });

const createParagraph = (text = ""): TiptapNode =>
  text ? { type: "paragraph", content: [createTextNode(text)] } : { type: "paragraph" };

const createDocFromText = (text: string): TiptapNode => ({
  type: "doc",
  content: text ? text.split("\n").map((line) => createParagraph(line)) : [createParagraph()],
});

const ensureDoc = (value: TiptapNode): TiptapNode => {
  if (value.type === "doc" && Array.isArray(value.content)) {
    return value;
  }

  if (value.type) {
    return { type: "doc", content: [value] };
  }

  return createDocFromText("");
};

export function parseTiptapContent(content: unknown): TiptapNode {
  if (isRecord(content)) {
    return ensureDoc(content as TiptapNode);
  }

  if (typeof content !== "string") {
    return createDocFromText("");
  }

  let current: unknown = content;

  for (let depth = 0; depth < MAX_PARSE_DEPTH && typeof current === "string"; depth += 1) {
    try {
      current = JSON.parse(current);
    } catch {
      return createDocFromText(content);
    }
  }

  return isRecord(current) ? ensureDoc(current as TiptapNode) : createDocFromText(content);
}

export function extractMentionIds(content: unknown): string[] {
  const ids = new Set<string>();

  const walk = (node: unknown) => {
    if (!isRecord(node)) {
      return;
    }

    if (node.type === "mention" && isRecord(node.attrs) && typeof node.attrs.id === "string" && node.attrs.id) {
      const attrs = node.attrs as JsonRecord;
      if (attrs.type === "NOTE") {
        return;
      }
      ids.add(node.attrs.id);
    }

    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  };

  walk(parseTiptapContent(content));

  return [...ids];
}

export function extractMentionLabels(content: unknown): Map<string, string> {
  const labels = new Map<string, string>();

  const walk = (node: unknown) => {
    if (!isRecord(node)) return;

    if (node.type === "mention" && isRecord(node.attrs) && typeof node.attrs.id === "string" && node.attrs.id) {
      const attrs = node.attrs as JsonRecord;
      if (attrs.type !== "NOTE") {
        labels.set(node.attrs.id, typeof attrs.label === "string" ? attrs.label : node.attrs.id);
      }
    }

    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  };

  walk(parseTiptapContent(content));
  return labels;
}

const sanitizeNode = (node: TiptapNode, entitiesById: Map<string, Entity>, removedIds: Set<string>): TiptapNode => {
  if (node.type === "noteMention") {
    return node;
  }

  if (node.type === "mention") {
    const attrs = isRecord(node.attrs) ? node.attrs : {};
    if (attrs.type === "NOTE") {
      return node;
    }

    const mentionId = typeof attrs.id === "string" ? attrs.id : "";
    const fallbackLabel =
      typeof attrs.label === "string"
        ? attrs.label
        : typeof attrs.title === "string"
          ? attrs.title
          : "entidade";
    const entity = mentionId ? entitiesById.get(mentionId) : undefined;

    if (!entity) {
      if (mentionId) {
        removedIds.add(mentionId);
      }

      return createTextNode(fallbackLabel.startsWith("@") ? fallbackLabel : `@${fallbackLabel}`);
    }

    return {
      ...node,
      attrs: {
        ...attrs,
        id: entity.id,
        label: entity.title,
      },
    };
  }

  if (!Array.isArray(node.content)) {
    return node;
  }

  return {
    ...node,
    content: node.content
      .map((child) => (isRecord(child) ? sanitizeNode(child as TiptapNode, entitiesById, removedIds) : null))
      .filter((child): child is TiptapNode => child !== null),
  };
};

export function sanitizeTiptapMentions(content: unknown, entities: Entity[]) {
  const doc = parseTiptapContent(content);
  const removedIds = new Set<string>();
  const sanitizedDoc = sanitizeNode(doc, new Map(entities.map((entity) => [entity.id, entity])), removedIds);

  return {
    doc: sanitizedDoc,
    entityIds: extractMentionIds(sanitizedDoc),
    removedIds: [...removedIds],
    changed: JSON.stringify(doc) !== JSON.stringify(sanitizedDoc),
  };
}

export function countTiptapMentions(content: unknown) {
  const counts = { entityMentions: 0, noteMentions: 0 };

  const walk = (node: unknown) => {
    if (!isRecord(node)) return;

    if (node.type === "noteMention") {
      counts.noteMentions += 1;
    }

    if (node.type === "mention" && isRecord(node.attrs) && typeof node.attrs.id === "string" && node.attrs.id) {
      const attrs = node.attrs as JsonRecord;
      if (attrs.type === "NOTE") {
        counts.noteMentions += 1;
      } else {
        counts.entityMentions += 1;
      }
    }

    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
    }
  };

  walk(parseTiptapContent(content));
  return {
    entityMentions: counts.entityMentions,
    noteMentions: counts.noteMentions,
    total: counts.entityMentions + counts.noteMentions,
  };
}

export function tiptapContentToPlainText(content: unknown): string {
  const doc = parseTiptapContent(content);

  const walk = (node: TiptapNode): string => {
    if (node.type === "text") {
      return typeof node.text === "string" ? node.text : "";
    }

    if (node.type === "mention" || node.type === "noteMention") {
      const attrs = isRecord(node.attrs) ? node.attrs : {};
      const label =
        typeof attrs.label === "string"
          ? attrs.label
          : typeof attrs.id === "string"
            ? attrs.id
            : "entidade";

      if (node.type === "mention") {
        return label.startsWith("@") ? label : `@${label}`;
      }

      return label;
    }

    const contentText = Array.isArray(node.content)
      ? node.content.map((child) => (isRecord(child) ? walk(child as TiptapNode) : "")).join("")
      : "";

    if (node.type === "paragraph" || node.type === "heading" || node.type === "taskItem") {
      return `${contentText}\n`;
    }

    return contentText;
  };

  return walk(doc).replace(/\n{3,}/g, "\n\n").trim();
}