import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject, generateText, streamText } from "ai";
import { toast } from "sonner";
import { z } from "zod";
import { getApiKey } from "@/ipc/settings";
import type { GitCommit } from "../ipc/git-reader";
import type { MarkdownFileMetadata } from "../ipc/markdown-reader";

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

    const result = streamText({
      model: google("gemini-2.5-flash"),
      prompt,
      onError: (error) => {
        toast.error(`Error calling Gemini API: ${error.error}`, {
          duration: 6000,
        });
      },
    });

    for await (const delta of result.textStream) {
      onToken(delta);
    }
  } catch (error) {
    toast.error(`Error calling Gemini API: ${error}`, {
      duration: 6000,
    });
  }
}

/**
 * Interface for daily file content with metadata
 */
interface DailyFileWithContent {
  metadata: MarkdownFileMetadata;
  content: string;
}

const formatDailyFile = (file: DailyFileWithContent) => {
  const hasLocation = file.metadata.city && file.metadata.country;
  const location = hasLocation
    ? `<location>${file.metadata.city}, ${file.metadata.country}</location>`
    : file.metadata.country
      ? `<location>${file.metadata.country}</location>`
      : "";
  return `<file>\n<name>${file.metadata.fileName}</name>\n<path>${file.metadata.filePath}</path>${location}\n<content>${file.content || "(empty)"}</content>\n</file>`;
};

/**
 * Classifies which daily markdown files contain content relevant to the structured file.
 * Returns an array of relevant daily files with their full content and metadata.
 *
 * @param structuredFileName - Name of the structured file
 * @param structuredDescription - Description of the structured file
 * @param structuredContent - Current content of the structured file
 * @param dailyFiles - Array of daily files with metadata and content
 * @returns Promise<DailyFileWithContent[]> - Array of relevant daily files
 */
export async function classifyRelevantDailyFiles(
  structuredFileName: string,
  structuredDescription: string,
  structuredContent: string,
  dailyFiles: DailyFileWithContent[],
): Promise<DailyFileWithContent[]> {
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

    const dailyFilesSummary = dailyFiles.map(formatDailyFile).join("\n");

    const prompt = `You are analyzing daily journal entries to determine which ones contain information relevant to updating a structured file.

Structured File: "${structuredFileName}"
Description: "${structuredDescription || "No description provided"}"
Current Content:
${structuredContent || "(empty)"}

Daily Files:
${dailyFilesSummary}

Task: Identify which daily files contain information that is relevant to this structured file. Consider:
- Does the daily file mention topics/entities related to the structured file?
- Would the information help update, expand, or improve the structured file?
- Is there new information not already captured in the current content?

Return the file paths of the relevant files.`;

    const result = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: z.object({
        relevantFilePaths: z
          .array(z.string())
          .describe("Array of file paths that contain relevant information"),
      }),
      prompt,
    });

    const validFilePaths = dailyFiles.map((f) => f.metadata.filePath);
    const filteredPaths = result.object.relevantFilePaths.filter(
      (path: string) => validFilePaths.includes(path),
    );

    // Return the actual file objects instead of just paths
    const relevantFiles = dailyFiles.filter((file) =>
      filteredPaths.includes(file.metadata.filePath),
    );

    return relevantFiles;
  } catch (error) {
    console.error("Error classifying relevant daily files:", error);
    throw new Error(`Failed to classify relevant files: ${error}`);
  }
}

/**
 * Intelligently merges relevant content from daily files into the structured file.
 * Handles deduplication, organization, updates, and appending new information.
 *
 * @param structuredFileName - Name of the structured file
 * @param structuredDescription - Description of the structured file
 * @param currentContent - Current content of the structured file
 * @param relevantDailyFiles - Array of relevant daily files with metadata and content
 * @returns Promise<string> - Updated structured file content
 */
export async function mergeRelevantContent(
  structuredFileName: string,
  structuredDescription: string,
  currentContent: string,
  relevantDailyFiles: DailyFileWithContent[],
): Promise<string> {
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

    const relevantFilesSummary = relevantDailyFiles
      .map(formatDailyFile)
      .join("\n");

    const prompt = `You are updating a structured file with new information from daily journal entries.

Structured File: "${structuredFileName}"
Description: "${structuredDescription || "No description provided"}"

Current Content:
${currentContent || "(empty file - start fresh)"}

Relevant Information from Daily Entries:
${relevantFilesSummary}

Task: Intelligently merge the relevant information into the structured file. Follow these guidelines:

1. **Deduplication**: Do not add information that is already present in the current content
2. **Organization**: Maintain or improve the structure and formatting of the file
3. **Updates**: If new information updates or supersedes existing information, replace the old with the new
4. **Appending**: Add new information that fits the file's purpose
5. **Relevance**: Only include information that clearly relates to the file's topic/purpose
6. **Format**: Maintain markdown formatting and preserve the style of the current content
7. **Completeness**: If the current file is empty, create a well-organized structure from scratch

Return ONLY the updated content of the structured file. Do not include any explanations, preambles, or meta-commentary.`;

    const result = await generateText({
      model: google("gemini-2.5-pro"),
      prompt,
    });

    return result.text.trim();
  } catch (error) {
    console.error("Error merging relevant content:", error);
    throw new Error(`Failed to merge content: ${error}`);
  }
}
