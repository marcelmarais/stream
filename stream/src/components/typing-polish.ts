import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface TextblockRange {
  start: number;
  end: number;
}

function getTextblockRange($pos: ResolvedPos): TextblockRange | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).isTextblock) {
      return {
        start: $pos.start(depth),
        end: $pos.end(depth),
      };
    }
  }

  return null;
}

function moveSelectionToTextblockSide(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  side: "start" | "end",
  extend: boolean,
) {
  const { selection } = state;

  if (!(selection instanceof TextSelection)) {
    return false;
  }

  const range = getTextblockRange(
    side === "start" ? selection.$from : selection.$to,
  );

  if (!range) {
    return false;
  }

  const target = side === "start" ? range.start : range.end;
  const anchor = extend ? selection.anchor : target;

  if (dispatch) {
    dispatch(
      state.tr
        .setSelection(TextSelection.create(state.doc, anchor, target))
        .scrollIntoView(),
    );
  }

  return true;
}

function createListMarker(label: string) {
  const marker = document.createElement("span");

  marker.className = "typing-polish-list-marker";
  marker.contentEditable = "false";
  marker.textContent = label;

  return marker;
}

function getListMarkerLabel(state: EditorState, paragraphPos: number) {
  const $pos = state.doc.resolve(paragraphPos);

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const wrapper = $pos.node(depth);

    if (wrapper.type.name === "bulletList") {
      return "•";
    }

    if (wrapper.type.name === "orderedList") {
      return `${(wrapper.attrs.start ?? 1) + $pos.index(depth)}.`;
    }
  }

  return null;
}

function decorateMarkdownPrefixStrike(
  node: ProseMirrorNode,
  pos: number,
  decorations: Decoration[],
) {
  if (!node.isTextblock || !node.textContent.startsWith("~~")) {
    return;
  }

  const start = pos + 3;
  const end = pos + node.nodeSize - 1;

  if (start < end) {
    decorations.push(
      Decoration.inline(start, end, {
        class: "typing-polish-prefix-strike",
      }),
    );
  }
}

function decorateListMarker(
  state: EditorState,
  node: ProseMirrorNode,
  pos: number,
  parent: ProseMirrorNode | null,
  index: number,
  decorations: Decoration[],
) {
  if (
    node.type.name !== "paragraph" ||
    parent?.type.name !== "listItem" ||
    index !== 0
  ) {
    return;
  }

  const label = getListMarkerLabel(state, pos);

  if (!label) {
    return;
  }

  decorations.push(
    Decoration.node(pos - 1, pos - 1 + parent.nodeSize, {
      class: "typing-polish-list-item",
    }),
    Decoration.widget(pos + 1, () => createListMarker(label), {
      key: `typing-polish-list-marker-${pos}-${label}`,
      side: 1,
    }),
  );
}

function createDecorations(state: EditorState) {
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos, parent, index) => {
    decorateMarkdownPrefixStrike(node, pos, decorations);
    decorateListMarker(state, node, pos, parent, index, decorations);
  });

  return DecorationSet.create(state.doc, decorations);
}

export const TypingPolish = Extension.create({
  name: "typingPolish",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      "Meta-ArrowLeft": () =>
        moveSelectionToTextblockSide(
          this.editor.state,
          this.editor.view.dispatch,
          "start",
          false,
        ),
      "Shift-Meta-ArrowLeft": () =>
        moveSelectionToTextblockSide(
          this.editor.state,
          this.editor.view.dispatch,
          "start",
          true,
        ),
      "Meta-ArrowRight": () =>
        moveSelectionToTextblockSide(
          this.editor.state,
          this.editor.view.dispatch,
          "end",
          false,
        ),
      "Shift-Meta-ArrowRight": () =>
        moveSelectionToTextblockSide(
          this.editor.state,
          this.editor.view.dispatch,
          "end",
          true,
        ),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: createDecorations,
          handleKeyDown: (view, event) => {
            if (
              !event.metaKey ||
              event.ctrlKey ||
              event.altKey ||
              (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
            ) {
              return false;
            }

            const handled = moveSelectionToTextblockSide(
              view.state,
              view.dispatch,
              event.key === "ArrowLeft" ? "start" : "end",
              event.shiftKey,
            );

            if (handled) {
              event.preventDefault();
            }

            return handled;
          },
        },
      }),
    ];
  },
});
