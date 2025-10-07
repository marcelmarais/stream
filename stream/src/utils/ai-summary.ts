import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { getApiKey } from "@/utils/settings-store";
import type { GitCommit } from "./git-reader";

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
 * Generate AI summary of yesterday's activities (client-side)
 */
export async function generateYesterdaySummary(
  markdownContent: string,
  commits: GitCommit[],
): Promise<string> {
  try {
    // Get API key from Tauri store
    const apiKey = await getApiKey();

    if (!apiKey) {
      throw new Error(
        "Google Gemini API key not configured. Please add it in Settings.",
      );
    }

    // Create Google AI instance with API key
    const google = createGoogleGenerativeAI({
      apiKey,
    });

    // Build the prompt
    const commitsSummary =
      commits.length > 0
        ? commits
            .map(
              (c) =>
                `- ${c.message} (by ${c.author_name} in ${c.repo_path.split("/").pop()})`,
            )
            .join("\n")
        : "No commits recorded.";

    const prompt = `You are a helpful assistant that summarizes daily journal entries and git commits.

Here is yesterday's markdown journal entry:

${markdownContent || "No journal entry for yesterday."}

Here are yesterday's git commits:

${commitsSummary}

Please provide a concise summary of yesterday's activities, combining insights from both the journal entry and the git commits. Focus on:
1. Key accomplishments and tasks completed
2. Important decisions or notes
3. Development work based on commits

Keep the summary brief and actionable (2-4 paragraphs).`;

    // Generate summary using Google Gemini
    const { text } = await generateText({
      model: google("gemini-2.5-flash-lite"),
      prompt,
    });

    return text;
  } catch (error) {
    console.error("Error generating summary:", error);
    throw error;
  }
}
