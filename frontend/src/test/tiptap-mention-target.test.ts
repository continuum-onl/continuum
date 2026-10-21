import { describe, expect, it } from "vitest";
import { getMentionClickTarget, resolveMentionTargetType } from "@/lib/tiptap-content";

describe("resolveMentionTargetType", () => {
  it("recognizes note mentions in current and legacy formats", () => {
    expect(resolveMentionTargetType("note")).toBe("note");
    expect(resolveMentionTargetType("NOTE")).toBe("note");
    expect(resolveMentionTargetType("entity", "NOTE")).toBe("note");
  });

  it("defaults entity mentions to entity navigation", () => {
    expect(resolveMentionTargetType("entity")).toBe("entity");
    expect(resolveMentionTargetType(null, undefined)).toBe("entity");
  });
});

describe("getMentionClickTarget", () => {
  it("resolves entity mentions by their data attributes without requiring styling classes", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<span data-id="entity-1" data-mention-type="entity"><span>@Entity</span></span>';

    expect(getMentionClickTarget(wrapper.querySelector("span span")!)).toEqual({
      id: "entity-1",
      type: "entity",
    });
  });

  it("resolves note mentions in the editor format", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<span data-id="note-1" data-mention-type="note" data-type="NOTE">#Note</span>';

    expect(getMentionClickTarget(wrapper.querySelector("span")!)).toEqual({
      id: "note-1",
      type: "note",
    });
  });

  it("returns null for regular text and mentions without an id", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<span>regular text</span><span data-mention-type="entity">@Missing</span>';

    expect(getMentionClickTarget(wrapper.querySelector("span")!)).toBeNull();
    expect(getMentionClickTarget(wrapper.querySelectorAll("span")[1])).toBeNull();
  });
});
