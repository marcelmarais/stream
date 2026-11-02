import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  pickedCompletion,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, tooltips } from "@codemirror/view";
import { HEADING_NODE } from "@/components/heading-fold";
import { AGENT_NAMES } from "@/ipc/agents";
import { readMarkdownFilesContentByPaths } from "@/ipc/markdown-reader";
import { listSkills, type Skill, startSkillThread } from "@/ipc/skills";
import { useStatusStore } from "@/stores/status-store";
import { useUserStore } from "@/stores/user-store";

const SKILL_QUERY = /\/[\p{L}\p{N}_-]*/u;
const WHOLE_SKILL_QUERY = /^\/[\p{L}\p{N}_-]*$/u;

const CODE_NODE = /^(FencedCode|CodeBlock|InlineCode)$/;

const NOTE_CHECK_MS = 1000;

interface SkillMenuOptions {
  filePath: string;
  folderPath: string;
  onSave: (value: string) => void | Promise<void>;
  onDiskChange: (value: string) => void;
}

/** A path or a date has text right before its slash, and code stays literal. */
function canStartSkill(state: EditorState, from: number) {
  const line = state.doc.lineAt(from);

  if (from > line.from && !/\s/.test(state.sliceDoc(from - 1, from))) {
    return false;
  }

  for (
    let node = syntaxTree(state).resolveInner(from, 1);
    node.parent;
    node = node.parent
  ) {
    if (CODE_NODE.test(node.name)) {
      return false;
    }
  }

  return true;
}

function headingAbove(state: EditorState, position: number) {
  const block = syntaxTree(state).topNode.cursor();
  let heading: string | null = null;

  if (!block.firstChild()) {
    return heading;
  }

  do {
    if (block.from > position) {
      break;
    }

    if (HEADING_NODE.test(block.name)) {
      heading = state
        .sliceDoc(block.from, block.to)
        .replace(/^#+\s*|\s+#+\s*$/g, "");
    }
  } while (block.nextSibling());

  return heading;
}

/**
 * Watches the note while an agent works on it. Otherwise the editor would keep
 * the old text, and the next save would overwrite the agent's edits. Stream's
 * own saves come through here too, and the editor ignores those. Returns a
 * function that stops watching after one last look.
 */
function followNote(
  filePath: string,
  saved: string,
  onDiskChange: (value: string) => void,
) {
  let known = saved;

  const check = async () => {
    const contents = await readMarkdownFilesContentByPaths([filePath]);
    const onDisk = contents.get(filePath);

    if (onDisk !== undefined && onDisk !== known) {
      known = onDisk;
      onDiskChange(onDisk);
    }
  };

  const timer = setInterval(check, NOTE_CHECK_MS);

  return async () => {
    clearInterval(timer);
    await check();
  };
}

/**
 * The note is saved first, so the agent reads what's on screen. The thread runs
 * out of sight, so the footer is the only sign that anything is happening.
 */
async function runSkill(
  view: EditorView,
  skill: Skill,
  position: number,
  { filePath, folderPath, onSave, onDiskChange }: SkillMenuOptions,
) {
  const { state } = view;
  const doc = state.doc.toString();
  const line = state.doc.lineAt(position);
  const { skillAgent, skillModels } = useUserStore.getState();
  const agentName = AGENT_NAMES[skillAgent];
  const { startSkill, finishSkill, failSkill } = useStatusStore.getState();
  const runId = startSkill(`Running /${skill.name} in ${agentName}`);

  try {
    await onSave(doc);
    const stopFollowing = followNote(filePath, doc, onDiskChange);

    try {
      await startSkillThread({
        agent: skillAgent,
        model: skillModels[skillAgent].trim() || null,
        skillName: skill.name,
        folderPath,
        skillPath: skill.path,
        notePath: filePath,
        line: line.number,
        heading: headingAbove(state, position),
        text: line.text.trim() || null,
      });
    } finally {
      await stopFollowing();
    }

    finishSkill(runId, `Finished /${skill.name}`);
  } catch (error) {
    console.error("Skill failed:", error);
    failSkill(runId, `/${skill.name} failed in ${agentName}`);
  }
}

function skillCompletion(
  skill: Skill,
  section: string,
  options: SkillMenuOptions,
): Completion {
  return {
    label: `/${skill.name}`,
    detail: skill.description ?? undefined,
    section,
    apply: (view, completion, from, to) => {
      view.dispatch({
        changes: { from, to },
        annotations: pickedCompletion.of(completion),
        userEvent: "input.complete",
      });
      void runSkill(view, skill, from, options);
    },
  };
}

/** Skills are read on each `/`, so new ones show up without a refresh. */
function skillSource(options: SkillMenuOptions) {
  return async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const query = context.matchBefore(SKILL_QUERY);

    if (!query || !canStartSkill(context.state, query.from)) {
      return null;
    }

    const skills = await listSkills(options.folderPath);

    if (skills.length === 0) {
      return null;
    }

    const agent = AGENT_NAMES[useUserStore.getState().skillAgent];

    return {
      from: query.from,
      validFor: WHOLE_SKILL_QUERY,
      options: skills.map((skill) =>
        skillCompletion(skill, `Start in ${agent}`, options),
      ),
    };
  };
}

const menuTheme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--popover)",
    border: "none",
    borderRadius: "var(--radius)",
    boxShadow:
      "0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent), 0 4px 12px rgb(0 0 0 / 0.12)",
    color: "var(--popover-foreground)",
    fontFamily: "var(--font-geist-sans), ui-sans-serif, sans-serif",
    fontSize: "12px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "inherit",
    maxHeight: "15rem",
    maxWidth: "min(22rem, 90vw)",
    minWidth: "16rem",
    padding: "4px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    borderRadius: "var(--radius)",
    lineHeight: "1.4",
    padding: "6px 8px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    border: "none",
    color: "var(--muted-foreground)",
    opacity: "1",
    padding: "4px 8px",
  },
  ".cm-completionMatchedText": { textDecoration: "none" },
  ".cm-completionDetail": {
    color: "var(--muted-foreground)",
    display: "block",
    fontStyle: "normal",
    marginLeft: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

export function skillMenu(options: SkillMenuOptions): Extension {
  return [
    autocompletion({
      override: [skillSource(options)],
      icons: false,
    }),
    // Notes scroll inside the timeline, which would cut the menu off
    tooltips({ parent: document.body }),
    menuTheme,
    Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
  ];
}
