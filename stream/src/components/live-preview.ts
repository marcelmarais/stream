import {
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  type Extension,
  type Line,
  Prec,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { LinkChipWidget, linkHref, linkLabel } from "./link-chip";

const HEADING_NODE = /^ATXHeading([1-6])$/;
// Nodes whose URL child belongs to them rather than being a bare link
const LINK_NODES = new Set(["Link", "Autolink", "Image", "LinkReference"]);
const LIST_LINE_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+/;
const TASK_PREFIX = /^\[[ xX]\]\s*/;
const STRIKE_PREFIX =
  /^(\s*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?)(\\~\\~|~~)/;

const hiddenMark = Decoration.replace({});

class BulletWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: BulletWidget) {
    return other.label === this.label;
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-note-marker";
    marker.textContent = this.label;
    return marker;
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskWidget) {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView) {
    const marker = document.createElement("span");
    marker.className = "cm-note-marker";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "cm-note-checkbox";
    checkbox.checked = this.checked;
    checkbox.addEventListener("mousedown", (event) => {
      event.preventDefault();
      toggleTask(view, view.posAtDOM(marker));
    });
    marker.append(checkbox);

    return marker;
  }

  ignoreEvent() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-note-rule";
    return rule;
  }
}

function toggleTask(view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  const match = /\[([ xX])\]/.exec(line.text);

  if (!match) {
    return;
  }

  const from = line.from + match.index + 1;

  view.dispatch({
    changes: { from, to: from + 1, insert: match[1] === " " ? "x" : " " },
  });
}

function selectionTouches(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from,
  );
}

function selectionOnLineOf(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos);
  return selectionTouches(state, line.from, line.to);
}

function includeTrailingSpace(state: EditorState, pos: number) {
  return state.doc.sliceString(pos, pos + 1) === " " ? pos + 1 : pos;
}

/**
 * Collapses a `[label](url)`, `<url>` or bare URL into a chip, unless the
 * caret is on it or it can't be opened.
 */
function linkChip(state: EditorState, node: SyntaxNode, reveal: boolean) {
  const url = node.name === "URL" ? node : node.getChild("URL");
  const href = url && linkHref(state.sliceDoc(url.from, url.to));

  if (
    !href ||
    (reveal && selectionTouches(state, node.from, node.to)) ||
    // Plugins can't replace line breaks
    state.doc.lineAt(node.from).to < node.to
  ) {
    return null;
  }

  let label = linkLabel(href);

  if (node.name === "Link") {
    const [open, close] = node.getChildren("LinkMark");
    label = state.sliceDoc(open.to, close.from).trim() || label;
  }

  return Decoration.replace({
    widget: new LinkChipWidget(href, label),
  }).range(node.from, node.to);
}

function buildDecorations(view: EditorView) {
  const { state } = view;
  const reveal = view.hasFocus;
  const decorations: Range<Decoration>[] = [];
  const atomic: Range<Decoration>[] = [];

  const hide = (from: number, to: number) => {
    if (from < to) {
      decorations.push(hiddenMark.range(from, to));
    }
  };

  const decorateLines = (from: number, to: number, className: string) => {
    let pos = from;

    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      decorations.push(Decoration.line({ class: className }).range(line.from));
      pos = line.to + 1;
    }
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const heading = HEADING_NODE.exec(node.name);

        if (heading) {
          decorateLines(node.from, node.from, `cm-note-h${heading[1]}`);
          return;
        }

        const parent = node.node.parent;

        switch (node.name) {
          case "HeaderMark":
            if (
              parent &&
              HEADING_NODE.test(parent.name) &&
              !(reveal && selectionOnLineOf(state, node.from))
            ) {
              hide(node.from, includeTrailingSpace(state, node.to));
            }
            break;

          case "EmphasisMark":
          case "StrikethroughMark":
            if (
              parent &&
              !(reveal && selectionTouches(state, parent.from, parent.to))
            ) {
              hide(node.from, node.to);
            }
            break;

          case "InlineCode":
            decorations.push(
              Decoration.mark({ class: "cm-note-code" }).range(
                node.from,
                node.to,
              ),
            );
            break;

          case "CodeMark":
            if (
              parent?.name === "InlineCode" &&
              !(reveal && selectionTouches(state, parent.from, parent.to))
            ) {
              hide(node.from, node.to);
            }
            break;

          case "Link":
          case "Autolink": {
            const chip = linkChip(state, node.node, reveal);

            if (chip) {
              decorations.push(chip);
              return false;
            }

            if (
              node.name === "Link" &&
              (node.node.getChild("URL") || node.node.getChild("LinkLabel"))
            ) {
              decorations.push(
                Decoration.mark({ class: "cm-note-link" }).range(
                  node.from,
                  node.to,
                ),
              );
            }
            break;
          }

          case "LinkMark":
          case "URL":
          case "LinkTitle":
          case "LinkLabel":
            if (node.name === "URL" && parent && !LINK_NODES.has(parent.name)) {
              const chip = linkChip(state, node.node, reveal);

              if (chip) {
                decorations.push(chip);
              }
            } else if (
              parent?.name === "Link" &&
              (parent.getChild("URL") || parent.getChild("LinkLabel")) &&
              !(reveal && selectionTouches(state, parent.from, parent.to))
            ) {
              hide(node.from, node.to);
            }
            break;

          case "Escape":
            if (!(reveal && selectionTouches(state, node.from, node.to))) {
              hide(node.from, node.from + 1);
            }
            break;

          case "Blockquote":
            decorateLines(node.from, node.to, "cm-note-quote");
            break;

          case "QuoteMark":
            if (!(reveal && selectionOnLineOf(state, node.from))) {
              hide(node.from, includeTrailingSpace(state, node.to));
            }
            break;

          case "FencedCode":
          case "CodeBlock":
            decorateLines(node.from, node.to, "cm-note-codeblock");
            break;

          case "HorizontalRule":
            if (!(reveal && selectionOnLineOf(state, node.from))) {
              decorations.push(
                Decoration.replace({ widget: new RuleWidget() }).range(
                  node.from,
                  node.to,
                ),
              );
            }
            break;

          case "ListMark": {
            const line = state.doc.lineAt(node.from);
            const indent = line.text.slice(0, node.from - line.from);

            // Wait for the space after the marker, and skip quoted lists
            if (
              indent.trim() ||
              state.doc.sliceString(node.to, node.to + 1) !== " "
            ) {
              break;
            }

            let depth = 0;
            for (
              let ancestor = parent?.parent?.parent;
              ancestor;
              ancestor = ancestor.parent
            ) {
              if (
                ancestor.name === "BulletList" ||
                ancestor.name === "OrderedList"
              ) {
                depth += 1;
              }
            }

            const marker = state.doc.sliceString(node.from, node.to);
            const task = parent?.getChild("Task")?.getChild("TaskMarker");
            const widget = task
              ? new TaskWidget(
                  state.doc.sliceString(task.from + 1, task.to - 1) !== " ",
                )
              : new BulletWidget(/\d/.test(marker) ? marker : "•");
            const end = includeTrailingSpace(state, task?.to ?? node.to);

            decorations.push(
              Decoration.line({
                class: "cm-note-list-item",
                attributes: { style: `--note-list-depth: ${depth}` },
              }).range(line.from),
            );
            const replacement = Decoration.replace({ widget }).range(
              line.from,
              end,
            );
            decorations.push(replacement);
            atomic.push(replacement);
            break;
          }
        }
      },
    });

    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      decorateStrikePrefix(state, line, reveal, decorations);
      pos = line.to + 1;
    }
  }

  return {
    decorations: Decoration.set(decorations, true),
    atomic: Decoration.set(atomic, true),
  };
}

// Obsidian-style crossed-out lines: `~~text` strikes through without a closer
function decorateStrikePrefix(
  state: EditorState,
  line: { from: number; to: number; text: string },
  reveal: boolean,
  decorations: Range<Decoration>[],
) {
  const match = STRIKE_PREFIX.exec(line.text);

  if (!match) {
    return;
  }

  const openingStart = line.from + match[1].length;
  const openingEnd = openingStart + match[2].length;
  const node = syntaxTree(state).resolveInner(openingEnd, -1);

  if (
    node.name === "Strikethrough" ||
    node.name === "StrikethroughMark" ||
    node.name === "CodeText" ||
    node.name === "FencedCode"
  ) {
    return;
  }

  const closing = line.text.endsWith(match[2])
    ? line.to - match[2].length
    : line.to;

  if (openingEnd >= closing) {
    return;
  }

  if (!(reveal && selectionOnLineOf(state, line.from))) {
    decorations.push(hiddenMark.range(openingStart, openingEnd));
    if (closing < line.to) {
      decorations.push(hiddenMark.range(closing, line.to));
    }
  }

  decorations.push(
    Decoration.mark({ class: "cm-note-strike" }).range(openingEnd, closing),
  );
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
      ({ decorations: this.decorations, atomic: this.atomic } =
        buildDecorations(view));
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        ({ decorations: this.decorations, atomic: this.atomic } =
          buildDecorations(update.view));
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.atomic ?? Decoration.none,
      ),
  },
);

interface ListItemLine {
  indent: number;
  contentOffset: number;
  textStart: number;
}

function listItemAt(state: EditorState, line: Line): ListItemLine | null {
  const prefix = LIST_LINE_PREFIX.exec(line.text);

  if (!prefix) {
    return null;
  }

  const indent = prefix[0].length - prefix[0].trimStart().length;

  if (
    syntaxTree(state).resolveInner(line.from + indent, 1).name !== "ListMark"
  ) {
    return null;
  }

  const marker = prefix[0].trim();
  const task = TASK_PREFIX.exec(line.text.slice(prefix[0].length));

  return {
    indent,
    contentOffset: indent + marker.length + 1,
    textStart: line.from + prefix[0].length + (task?.[0].length ?? 0),
  };
}

function leadingSpaces(text: string) {
  return text.length - text.trimStart().length;
}

/**
 * Items above `line`, nearest first, skipping nested items and stopping at the
 * end of the list.
 */
function* itemsAbove(state: EditorState, line: Line) {
  for (let number = line.number - 1; number >= 1; number -= 1) {
    const above = state.doc.line(number);
    const item = listItemAt(state, above);

    if (item) {
      yield item;
    } else if (above.text.trim() && !leadingSpaces(above.text)) {
      return;
    }
  }
}

function indentTarget(state: EditorState, line: Line, item: ListItemLine) {
  for (const above of itemsAbove(state, line)) {
    if (above.indent < item.indent) {
      return null;
    }

    if (above.indent === item.indent) {
      return above.contentOffset;
    }
  }

  return null;
}

function outdentTarget(state: EditorState, line: Line, item: ListItemLine) {
  for (const above of itemsAbove(state, line)) {
    if (above.indent < item.indent) {
      return above.indent;
    }
  }

  return item.indent > 0 ? 0 : null;
}

/**
 * Moves the selected items, and everything nested under them, to `target`.
 */
function moveListItems(view: EditorView, target: number) {
  const { state } = view;
  const { main } = state.selection;
  const first = state.doc.lineAt(main.from);
  const item = listItemAt(state, first);

  if (!item) {
    return;
  }

  let last = state.doc.lineAt(main.to);

  while (last.number < state.doc.lines) {
    const next = state.doc.line(last.number + 1);

    if (!next.text.trim() || leadingSpaces(next.text) <= item.indent) {
      break;
    }

    last = next;
  }

  const delta = target - item.indent;
  const changes = [];

  for (let number = first.number; number <= last.number; number += 1) {
    const line = state.doc.line(number);
    const width = leadingSpaces(line.text);

    changes.push({
      from: line.from,
      to: line.from + width,
      insert: " ".repeat(Math.max(0, width + delta)),
    });
  }

  view.dispatch({ changes, userEvent: "input.indent" });
}

function indentListItem(view: EditorView) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.from);
  const item = listItemAt(state, line);

  if (!item) {
    return false;
  }

  const target = indentTarget(state, line, item);

  if (target !== null) {
    moveListItems(view, target);
  }

  return true;
}

function outdentListItem(view: EditorView) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.from);
  const item = listItemAt(state, line);

  if (!item) {
    return false;
  }

  const target = outdentTarget(state, line, item);

  if (target !== null) {
    moveListItems(view, target);
  }

  return true;
}

/**
 * Keeps the caret after a hidden list marker, so typing never lands in front
 * of it. Moving left from there still crosses to the previous line.
 */
const skipListMarker = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection?.main.empty) {
    return tr;
  }

  const { head } = tr.selection.main;
  const line = tr.startState.doc.lineAt(head);
  const textStart =
    head === line.from ? listItemAt(tr.startState, line)?.textStart : undefined;

  if (textStart === undefined) {
    return tr;
  }

  const isMovingLeft = tr.startState.selection.main.head === textStart;

  return [
    tr,
    {
      selection: {
        anchor: isMovingLeft && line.from > 0 ? line.from - 1 : textStart,
      },
      sequential: true,
    },
  ];
});

/**
 * Backspace at the start of an item's text: nested items step out a level,
 * top-level items lose their marker.
 */
function deleteListMarker(view: EditorView) {
  const { state } = view;
  const { main } = state.selection;

  if (!main.empty) {
    return false;
  }

  const line = state.doc.lineAt(main.head);
  const item = listItemAt(state, line);

  if (item?.textStart !== main.head) {
    return false;
  }

  if (item.indent > 0) {
    moveListItems(view, outdentTarget(state, line, item) ?? 0);
  } else {
    view.dispatch({
      changes: { from: line.from, to: main.head },
      userEvent: "delete.backward",
    });
  }

  return true;
}

/**
 * Enter on an item with no text: nested items step out a level, top-level
 * items become an empty line.
 */
function exitEmptyListItem(view: EditorView) {
  const { state } = view;
  const { main } = state.selection;

  if (!main.empty) {
    return false;
  }

  const line = state.doc.lineAt(main.head);
  const item = listItemAt(state, line);

  if (!item || state.sliceDoc(item.textStart, line.to).trim()) {
    return false;
  }

  if (item.indent > 0) {
    moveListItems(view, outdentTarget(state, line, item) ?? 0);
  } else {
    view.dispatch({
      changes: { from: line.from, to: line.to },
      userEvent: "delete.backward",
    });
  }

  return true;
}

interface InlineMark {
  text: string;
  node: string;
  markNode: string;
}

const STRONG: InlineMark = {
  text: "**",
  node: "StrongEmphasis",
  markNode: "EmphasisMark",
};
const EMPHASIS: InlineMark = {
  text: "*",
  node: "Emphasis",
  markNode: "EmphasisMark",
};
const STRIKETHROUGH: InlineMark = {
  text: "~~",
  node: "Strikethrough",
  markNode: "StrikethroughMark",
};
const INLINE_CODE: InlineMark = {
  text: "`",
  node: "InlineCode",
  markNode: "CodeMark",
};

function toggleInlineMark(mark: InlineMark) {
  return (view: EditorView) => {
    const { state } = view;

    view.dispatch(
      state.changeByRange((range) => {
        let node: SyntaxNode | null = syntaxTree(state).resolveInner(
          range.head,
        );

        while (node && node.name !== mark.node) {
          node = node.parent;
        }

        if (node && node.from <= range.from && node.to >= range.to) {
          const marks = node.getChildren(mark.markNode);
          const changes = state.changes(
            marks.map(({ from, to }) => ({ from, to })),
          );

          return { changes, range: range.map(changes) };
        }

        const target = range.empty
          ? (state.wordAt(range.head) ?? range)
          : range;
        const changes = state.changes([
          { from: target.from, insert: mark.text },
          { from: target.to, insert: mark.text },
        ]);

        return {
          changes,
          range: range.empty
            ? EditorSelection.cursor(range.head + mark.text.length)
            : EditorSelection.range(
                range.from + mark.text.length,
                range.to + mark.text.length,
              ),
        };
      }),
      { userEvent: "input.format", scrollIntoView: true },
    );

    return true;
  };
}

const noteHighlighting = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.url, color: "var(--muted-foreground)" },
  { tag: tags.processingInstruction, color: "var(--muted-foreground)" },
  { tag: tags.labelName, color: "var(--muted-foreground)" },
]);

const SERIF_FONT = 'var(--font-geist-serif), "Times New Roman", serif';
const MONO_FONT = "var(--font-geist-mono), ui-monospace, monospace";

// Geist Serif has one weight and thin hairlines, so it stops at heading 2
const headingStyles = Object.fromEntries(
  [1, 2, 3, 4, 5, 6].map((level) => [
    `.cm-note-h${level}`,
    {
      fontFamily: level <= 2 ? SERIF_FONT : MONO_FONT,
      fontSize: `var(--note-h${level}-size)`,
      lineHeight: `var(--note-h${level}-line-height)`,
      fontWeight: level <= 2 ? "400" : "600",
      fontSynthesis: "none",
      letterSpacing: level <= 2 ? "-0.01em" : "0",
      color: "var(--heading)",
      paddingTop: "0.5em",
    },
  ]),
);

const noteTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--body)",
    fontFamily: "var(--font-geist-sans), ui-sans-serif, sans-serif",
    fontSize: "var(--note-font-size)",
    minHeight: "inherit",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "var(--note-line-height)",
    overflow: "visible",
  },
  ".cm-content": {
    caretColor: "var(--foreground)",
    minHeight: "inherit",
    padding: "0",
  },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-note-marker": {
    color: "var(--muted-foreground)",
    left: "calc(var(--note-list-indent) * var(--note-list-depth))",
    position: "absolute",
  },
  ".cm-note-checkbox": {
    accentColor: "var(--primary)",
    height: "0.9em",
    margin: "0",
    verticalAlign: "-0.1em",
    width: "0.9em",
  },
  ".cm-note-list-item": {
    minHeight: "calc(var(--note-line-height) * 1em)",
    paddingLeft: "calc(var(--note-list-indent) * (var(--note-list-depth) + 1))",
    position: "relative",
  },
  ".cm-note-quote": {
    borderLeft: "0.2em solid var(--border)",
    paddingLeft: "0.8em",
  },
  ".cm-note-code, .cm-note-codeblock": {
    backgroundColor: "var(--muted)",
    fontFamily: MONO_FONT,
    fontSize: "var(--note-code-size)",
  },
  ".cm-note-code": { borderRadius: "0.2em", padding: "0.1em 0.25em" },
  ".cm-note-codeblock": { padding: "0 0.75em" },
  ".cm-note-rule": {
    borderTop: "1px solid var(--border)",
    display: "inline-block",
    verticalAlign: "middle",
    width: "100%",
  },
  ".cm-note-link": { textDecoration: "underline" },
  ".cm-note-link-chip": {
    cursor: "pointer",
    display: "inline-block",
    maxWidth: "min(100%, 22em)",
    overflow: "hidden",
    textDecoration: "underline",
    textOverflow: "ellipsis",
    verticalAlign: "bottom",
    whiteSpace: "nowrap",
  },
  ".cm-note-link-chip:hover": { color: "var(--heading)" },
  ".cm-note-link-icon": {
    borderRadius: "2px",
    color: "var(--muted-foreground)",
    display: "inline-block",
    fill: "currentColor",
    height: "1em",
    marginRight: "0.35em",
    verticalAlign: "-0.15em",
    width: "1em",
  },
  ".cm-note-strike": { textDecoration: "line-through" },
  ...headingStyles,
});

export function livePreview(): Extension {
  return [
    indentUnit.of("    "),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({
      autocapitalize: "sentences",
      autocorrect: "on",
      spellcheck: "true",
    }),
    noteTheme,
    syntaxHighlighting(noteHighlighting),
    livePreviewPlugin,
    skipListMarker,
    Prec.highest(
      keymap.of([
        { key: "Backspace", run: deleteListMarker },
        { key: "Enter", run: exitEmptyListItem },
        { key: "Tab", run: indentListItem },
        { key: "Shift-Tab", run: outdentListItem },
        { key: "Mod-b", run: toggleInlineMark(STRONG) },
        { key: "Mod-i", run: toggleInlineMark(EMPHASIS) },
        { key: "Mod-Shift-s", run: toggleInlineMark(STRIKETHROUGH) },
        { key: "Mod-e", run: toggleInlineMark(INLINE_CODE) },
      ]),
    ),
  ];
}
