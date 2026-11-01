import {
  codeFolding,
  foldable,
  foldEffect,
  foldedRanges,
  forceParsing,
  syntaxTree,
  syntaxTreeAvailable,
  unfoldEffect,
} from "@codemirror/language";
import {
  EditorState,
  type Extension,
  type Line,
  type Range,
  type StateEffect,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

const SVG_NS = "http://www.w3.org/2000/svg";

const HEADING_NODE = /^ATXHeading[1-6]$/;

// Phosphor's regular CaretDown, matching the rest of the app
const CARET_PATH =
  "M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z";

/** The text guards against the file having changed outside the app. */
export interface CollapsedHeading {
  line: number;
  text: string;
}

/**
 * What a heading line collapses, or null when it has nothing under it. Only
 * top-level headings have sections, so `> # quoted` doesn't count.
 */
function headingSection(state: EditorState, line: Line) {
  const block = syntaxTree(state).topNode.childAfter(line.from);

  return block && block.from <= line.to && HEADING_NODE.test(block.name)
    ? foldable(state, line.from, line.to)
    : null;
}

function foldOnLine(state: EditorState, line: Line) {
  let fold = null as { from: number; to: number } | null;

  foldedRanges(state).between(line.to, line.to, (from, to) => {
    if (from === line.to) {
      fold = { from, to };
      return false;
    }
  });

  return fold;
}

function toggleSection(view: EditorView, line: Line) {
  const { state } = view;
  const fold = foldOnLine(state, line);

  if (fold) {
    view.dispatch({ effects: unfoldEffect.of(fold) });
    return;
  }

  const section = headingSection(state, line);

  if (!section) {
    return;
  }

  const { main } = state.selection;

  view.dispatch({
    effects: foldEffect.of(section),
    // A caret left inside would keep typing into the hidden text
    selection:
      main.to > section.from && main.from <= section.to
        ? { anchor: section.from }
        : undefined,
  });
}

export function toggleHeadingFold(view: EditorView) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);

  if (!foldOnLine(state, line) && !headingSection(state, line)) {
    return false;
  }

  toggleSection(view, line);
  return true;
}

/** `skipFoldEnd` would send the caret straight back to the heading. */
export function moveRightPastFold(view: EditorView) {
  const { state } = view;
  const { main } = state.selection;
  const fold = foldOnLine(state, state.doc.lineAt(main.head));

  if (!main.empty || fold?.from !== main.head || fold.to === state.doc.length) {
    return false;
  }

  view.dispatch({
    selection: { anchor: fold.to + 1 },
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

class FoldToggleWidget extends WidgetType {
  constructor(readonly collapsed: boolean) {
    super();
  }

  eq(other: FoldToggleWidget) {
    return other.collapsed === this.collapsed;
  }

  private applyState(toggle: HTMLElement) {
    toggle.classList.toggle("cm-note-fold-collapsed", this.collapsed);
    toggle.setAttribute("aria-expanded", String(!this.collapsed));
  }

  toDOM(view: EditorView) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.tabIndex = -1;
    toggle.className = "cm-note-fold";
    toggle.setAttribute("aria-label", "Toggle section");
    this.applyState(toggle);

    const icon = document.createElementNS(SVG_NS, "svg");
    icon.setAttribute("viewBox", "0 0 256 256");
    icon.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", CARET_PATH);
    icon.append(path);
    toggle.append(icon);

    toggle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      toggleSection(view, view.state.doc.lineAt(view.posAtDOM(toggle)));
    });

    return toggle;
  }

  // Keeps the element so the caret animates between states
  updateDOM(dom: HTMLElement) {
    this.applyState(dom);
    return true;
  }

  ignoreEvent() {
    return true;
  }
}

function buildToggles(view: EditorView) {
  const { state } = view;
  const toggles: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "Document") {
          return true;
        }

        if (HEADING_NODE.test(node.name)) {
          const line = state.doc.lineAt(node.from);
          const collapsed = foldOnLine(state, line) !== null;

          if (collapsed || headingSection(state, line)) {
            toggles.push(
              Decoration.widget({
                widget: new FoldToggleWidget(collapsed),
                side: -1,
              }).range(line.from),
            );
          }
        }

        return false;
      },
    });
  }

  return Decoration.set(toggles, true);
}

const foldToggles = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildToggles(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        foldedRanges(update.startState) !== foldedRanges(update.state) ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildToggles(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * A collapsed heading shares its visual line with the section, so End or a
 * click past the placeholder lands on the last hidden line. Keeps the caret on
 * the heading, where typing goes where it looks like it will.
 */
const skipFoldEnd = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || !tr.selection?.main.empty) {
    return tr;
  }

  const { head } = tr.selection.main;
  let heading = null as number | null;

  foldedRanges(tr.startState).between(head, head, (from, to) => {
    if (to === head && (heading === null || from < heading)) {
      heading = from;
    }
  });

  return heading === null
    ? tr
    : [tr, { selection: { anchor: heading }, sequential: true }];
});

/**
 * Reveals a section when an edit stops its fold from matching the heading:
 * Enter at the end of the heading, removing the `#`s, or joining the next line
 * onto the last hidden line.
 */
const dropStaleFolds = EditorView.updateListener.of((update) => {
  const { state } = update;

  if (!update.docChanged || !syntaxTreeAvailable(state)) {
    return;
  }

  const stale: StateEffect<{ from: number; to: number }>[] = [];

  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    const section = headingSection(state, state.doc.lineAt(from));

    if (
      section?.from !== from ||
      to > section.to ||
      state.doc.lineAt(to).to !== to
    ) {
      stale.push(unfoldEffect.of({ from, to }));
    }
  });

  if (stale.length > 0) {
    update.view.dispatch({ effects: stale });
  }
});

function foldPlaceholder(
  _view: EditorView,
  onclick: (event: Event) => void,
): HTMLElement {
  const placeholder = document.createElement("span");
  placeholder.className = "cm-note-fold-placeholder";
  placeholder.textContent = "…";
  placeholder.setAttribute("aria-label", "Collapsed section");
  placeholder.onclick = onclick;
  return placeholder;
}

export function collapsedHeadings(state: EditorState): CollapsedHeading[] {
  const headings: CollapsedHeading[] = [];

  foldedRanges(state).between(0, state.doc.length, (from) => {
    const line = state.doc.lineAt(from);
    headings.push({ line: line.number, text: line.text });
  });

  return headings;
}

/** Makes the view's folds match `headings`, skipping any that went stale. */
export function restoreCollapsedHeadings(
  view: EditorView,
  headings: CollapsedHeading[],
) {
  // A new state only parses the start of the note
  forceParsing(view, view.state.doc.length);

  const { state } = view;
  const effects: StateEffect<{ from: number; to: number }>[] = [];

  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });

  for (const { line: number, text } of headings) {
    if (number > state.doc.lines) {
      continue;
    }

    const line = state.doc.line(number);
    const section = line.text === text ? headingSection(state, line) : null;

    if (section) {
      effects.push(foldEffect.of(section));
    }
  }

  if (effects.length > 0) {
    view.dispatch({ effects });
  }
}

export function headingFolds(): Extension {
  return [
    codeFolding({ placeholderDOM: foldPlaceholder }),
    EditorView.atomicRanges.of((view) => foldedRanges(view.state)),
    foldToggles,
    skipFoldEnd,
    dropStaleFolds,
  ];
}
