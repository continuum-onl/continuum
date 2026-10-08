import TaskItem from "@tiptap/extension-task-item";

/**
 * TaskItem with a custom node view that toggles the checkbox through a real
 * ProseMirror transaction. Tiptap's built-in checkbox plugin only dispatches
 * when the editor is editable; in read-only mode it merely decides whether the
 * browser may flip the checkbox visually, so the change is never persisted.
 *
 * This node view listens to the checkbox `change` event, resolves the live
 * node position via `getPos()` and dispatches `setNodeMarkup` directly on the
 * view — which works regardless of `editor.isEditable`, updates the document
 * (strikethrough + data-checked) and triggers the editor's onUpdate/auto-save.
 */
export const ClickableTaskItem = TaskItem.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const listItem = document.createElement("li");
      const label = document.createElement("label");
      label.contentEditable = "false";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!node.attrs.checked;
      const span = document.createElement("span");
      label.append(checkbox, span);

      const content = document.createElement("div");
      listItem.setAttribute("data-checked", String(!!node.attrs.checked));
      listItem.append(label, content);

      const onChange = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current || current.type.name !== "taskItem") return;
        const checked = !current.attrs.checked;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...current.attrs,
            checked,
          })
        );
      };
      checkbox.addEventListener("change", onChange);

      return {
        dom: listItem,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "taskItem") return false;
          checkbox.checked = !!updatedNode.attrs.checked;
          listItem.setAttribute("data-checked", String(!!updatedNode.attrs.checked));
          return true;
        },
        destroy: () => {
          checkbox.removeEventListener("change", onChange);
        },
      };
    };
  },
});
