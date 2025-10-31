import type { Root } from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

export interface FormatResult {
  success: boolean;
  formatted?: string;
  error?: string;
}

/**
 * Automatically fixes heading increment issues.
 * Ensures headings increment by only one level at a time.
 */
function fixHeadingIncrements() {
  return (tree: Root) => {
    let previousLevel = 0;

    visit(tree, "heading", (node) => {
      const currentLevel = node.depth;

      // If this is the first heading, it can be any level
      if (previousLevel === 0) {
        previousLevel = currentLevel;
        return;
      }

      // Calculate the maximum allowed level (previous + 1)
      const maxAllowedLevel = Math.min(previousLevel + 1, 6);

      // If heading jumps too many levels, adjust it
      if (currentLevel > maxAllowedLevel) {
        node.depth = maxAllowedLevel as 1 | 2 | 3 | 4 | 5 | 6;
        previousLevel = maxAllowedLevel;
      } else {
        previousLevel = currentLevel;
      }
    });
  };
}

/**
 * Formats markdown content using remark and automatically fixes structure issues.
 *
 * @param markdown - The markdown content to format
 * @returns Promise<FormatResult> - The formatting result
 */
export async function formatMarkdown(markdown: string): Promise<FormatResult> {
  try {
    // Process markdown: fix heading increments and format with remark-stringify
    // remarkGfm supports GitHub Flavored Markdown (strikethrough, tables, task lists, etc.)
    const result = await remark()
      .use(remarkGfm)
      .use(fixHeadingIncrements)
      .process(markdown);

    // Convert to markdown string with remark-stringify
    let formatted = String(result);

    // Ensure exactly one trailing newline (remove excessive blank lines at EOF)
    formatted = `${formatted.replace(/\n{3,}$/, "\n\n").trimEnd()}\n`;

    return {
      success: true,
      formatted,
    };
  } catch (error) {
    return {
      success: false,
      error: `Formatting failed: ${error}`,
    };
  }
}
