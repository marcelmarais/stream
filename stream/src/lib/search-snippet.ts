export type MatchRange = [number, number];

// List markers, tasks, headings and quotes at the start of a line
const LINE_PREFIX =
  /^(?:\s*>\s?)*\s*(?:#{1,6}\s+)?(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?/;
// `[label](url)` keeps its label
const LINK = /\[([^\]\n]+)\]\(([^)\n]*)\)/g;
// Strong, strikethrough and code marks. Single `*` and `_` are left alone,
// because they turn up inside words and paths.
const INLINE_MARK = /\*\*|__|~~|`/g;

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  const sorted = ranges
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: MatchRange[] = [];

  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  return merged;
}

/**
 * Strips markdown syntax from a search snippet so it reads like the note does,
 * and moves the match ranges to the same words in the cleaned text.
 */
export function cleanSnippet(
  text: string,
  ranges: MatchRange[],
): { text: string; ranges: MatchRange[] } {
  const removed: MatchRange[] = [];

  const prefix = LINE_PREFIX.exec(text)?.[0] ?? "";
  removed.push([0, prefix.length]);

  for (const link of text.matchAll(LINK)) {
    const start = link.index;
    const labelEnd = start + 1 + link[1].length;
    removed.push([start, start + 1], [labelEnd, start + link[0].length]);
  }

  for (const mark of text.matchAll(INLINE_MARK)) {
    removed.push([mark.index, mark.index + mark[0].length]);
  }

  const cuts = mergeRanges(removed);

  if (cuts.length === 0) {
    return { text, ranges };
  }

  // Where an index in the original lands once the cuts are gone
  const move = (index: number) => {
    let shift = 0;
    for (const [start, end] of cuts) {
      if (index <= start) break;
      shift += Math.min(index, end) - start;
    }
    return index - shift;
  };

  let cleaned = "";
  let from = 0;
  for (const [start, end] of cuts) {
    cleaned += text.slice(from, start);
    from = end;
  }
  cleaned += text.slice(from);

  const moved = ranges
    .map(([start, end]): MatchRange => [move(start), move(end)])
    .filter(([start, end]) => end > start);

  return { text: cleaned, ranges: moved };
}
