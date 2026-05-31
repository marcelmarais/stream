import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin, TextSelection } from "@tiptap/pm/state";
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

const MARKDOWN_STRIKE_DELIMITER = "~~";

function hideMarkdownStrikeDelimiter(
  from: number,
  to: number,
  decorations: Decoration[],
) {
  if (from >= to) {
    return;
  }

  decorations.push(
    Decoration.inline(from, to, {
      class: "typing-polish-strike-syntax",
    }),
  );
}

function decorateMarkdownPrefixStrike(
  node: ProseMirrorNode,
  pos: number,
  decorations: Decoration[],
) {
  const text = node.textContent;

  if (!node.isTextblock || !text.startsWith(MARKDOWN_STRIKE_DELIMITER)) {
    return;
  }

  const delimiterLength = MARKDOWN_STRIKE_DELIMITER.length;
  const blockStart = pos + 1;
  const blockEnd = pos + node.nodeSize - 1;
  const openingEnd = blockStart + delimiterLength;

  hideMarkdownStrikeDelimiter(blockStart, openingEnd, decorations);

  let contentEnd = blockEnd;

  const hasClosingDelimiter =
    text.endsWith(MARKDOWN_STRIKE_DELIMITER) &&
    text.length > delimiterLength * 2;

  if (hasClosingDelimiter) {
    const closingStart = blockEnd - delimiterLength;

    hideMarkdownStrikeDelimiter(closingStart, blockEnd, decorations);
    contentEnd = closingStart;
  }

  if (openingEnd < contentEnd) {
    decorations.push(
      Decoration.inline(openingEnd, contentEnd, {
        class: "typing-polish-strike-content",
      }),
    );
  }
}

function createDecorations(state: EditorState) {
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    decorateMarkdownPrefixStrike(node, pos, decorations);
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
