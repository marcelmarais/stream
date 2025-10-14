import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText } from "ai";
import { getApiKey } from "@/ipc/settings";
import type { GitCommit } from "../ipc/git-reader";

/**
 * Get yesterday's date in YYYY-MM-DD format
 */
export function getYesterdayDateString(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, "0");
  const day = String(yesterday.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get yesterday's markdown filename
 */
export function getYesterdayMarkdownFileName(): string {
  return `${getYesterdayDateString()}.md`;
}

/**
 * Stream AI summary of yesterday's activities (client-side)
 */
export async function streamYesterdaySummary(
  markdownContent: string,
  commits: GitCommit[],
  onToken: (delta: string) => void,
): Promise<void> {
  try {
    const apiKey = await getApiKey();

    if (!apiKey) {
      throw new Error(
        "Google Gemini API key not configured. Please add it in Settings.",
      );
    }

    const google = createGoogleGenerativeAI({
      apiKey,
    });

    const commitsSummary =
      commits.length > 0
        ? commits
            .map(
              (c) =>
                `- ${c.message} (by ${c.author_name} in ${c.repo_path.split("/").pop()})`,
            )
            .join("\n")
        : "No commits recorded.";

    const prompt = `You are a helpful assistant that extracts open todos, unfinished points, and action items from daily journal entries and git commits.

Here is yesterday's markdown journal entry:

${markdownContent || "No journal entry for yesterday."}

Here are yesterday's git commits:

${commitsSummary}

Extract all open todos, unfinished tasks, pending decisions, questions, and action items from yesterday. Use VERBATIM TEXT from the journal entry wherever possible.

Return ONLY a markdown list with the following structure:
- Use top-level bullets (-) for main categories or themes. Whenever possible these categories should be copied VERBATIM from the journal entry and not inferred.
- Use one level of nesting (  -) to show related sub-points
- If there are commit-related open items, include them under a relevant category eg. the repo name
- DO NOT copy all bullets across. Only the ones that are clearly todos or action items ie. avoid copying general remarks.
- DO NOT copy across completed tasks (look for lines that have [x], ~~ or semantic cues).

Example format:
- work
  - OAuth vs JWT approach
- Open questions about database design
  - Should we normalize the user_preferences table?
- Pending code reviews
  - PR #123 needs attention

Return ONLY the markdown list, no additional commentary or explanation.`;

    const result = await streamText({
      model: google("gemini-2.5-flash"),
      prompt,
    });

    for await (const delta of result.textStream) {
      onToken(delta);
    }
  } catch (error) {
    console.error("Error streaming summary:", error);
    throw error;
  }
}
