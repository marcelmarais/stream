/**
 * Date utility functions for handling markdown file dates
 * All functions are pure with no side effects
 */

/**
 * Converts a Date object to a date key string in YYYY-MM-DD format
 * Uses local date components to avoid timezone issues
 *
 * @param date - The date to convert
 * @returns Date string in YYYY-MM-DD format
 *
 * @example
 * getDateKey(new Date('2023-08-13')) // returns "2023-08-13"
 */
export function getDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Extracts a date string from a markdown filename
 * Matches YYYY-MM-DD pattern at the start of the filename
 *
 * @param fileName - The filename to parse (e.g., "2023-08-13.md")
 * @returns Date string in YYYY-MM-DD format, or null if no date found
 *
 * @example
 * getDateFromFilename("2023-08-13.md") // returns "2023-08-13"
 * getDateFromFilename("notes.md") // returns null
 */
export function getDateFromFilename(fileName: string): string | null {
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * Formats a date key string (YYYY-MM-DD) into a human-readable display format
 * Output format: "weekday — month day, year" (all lowercase)
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Formatted date string
 *
 * @example
 * formatDisplayDate("2023-08-13") // returns "sunday — august 13, 2023"
 */
export function formatDisplayDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    })
    .replace(", ", " — ")
    .toLowerCase();
}
