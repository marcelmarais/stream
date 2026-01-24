import { load } from "@tauri-apps/plugin-store";
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";

// Constants for getting the selected folder from settings
const FOLDER_STORAGE_KEY = "stream-last-selected-folder";
const FOLDER_STORE_FILE = "settings.json";
const HABITS_FILENAME = "habits.json";

/**
 * Habit tracking period options
 */
export type HabitPeriod = "daily" | "weekly" | "monthly";

/**
 * Available icons for habits
 */
export type HabitIcon =
  | "Barbell"
  | "Bicycle"
  | "Heart"
  | "Lightning"
  | "Fire"
  | "Timer"
  | "BookOpen"
  | "Pencil"
  | "Target"
  | "Star"
  | "CheckSquare"
  | "Clock"
  | "Coffee"
  | "Drop"
  | "Moon"
  | "Sun"
  | "Tree"
  | "Brain"
  | "MusicNote"
  | "Camera";

/**
 * Default icon for habits when none is specified
 */
export const DEFAULT_HABIT_ICON: HabitIcon = "Target";

/**
 * List of all available habit icons
 */
export const HABIT_ICONS: HabitIcon[] = [
  "Target",
  "Barbell",
  "Bicycle",
  "Heart",
  "Lightning",
  "Fire",
  "Timer",
  "BookOpen",
  "Pencil",
  "Star",
  "CheckSquare",
  "Clock",
  "Coffee",
  "Drop",
  "Moon",
  "Sun",
  "Tree",
  "Brain",
  "MusicNote",
  "Camera",
];

/**
 * Represents a habit with its configuration and completion history
 */
export interface Habit {
  /** Unique identifier */
  id: string;
  /** Name of the habit */
  name: string;
  /** Target number of completions per period */
  targetCount: number;
  /** The tracking period */
  period: HabitPeriod;
  /** Icon for the habit (defaults to Target if not set) */
  icon?: HabitIcon;
  /** Creation timestamp in milliseconds */
  createdAt: number;
  /** Completion counts by date (YYYY-MM-DD -> count) */
  completions: Record<string, number>;
}

/**
 * Get the selected folder from settings store
 */
async function getSelectedFolder(): Promise<string | null> {
  try {
    const store = await load(FOLDER_STORE_FILE, {
      autoSave: true,
      defaults: {},
    });
    const savedFolder = await store.get<string>(FOLDER_STORAGE_KEY);
    return savedFolder || null;
  } catch (error) {
    console.warn("Failed to get selected folder:", error);
    return null;
  }
}

/**
 * Get the full path to the habits file in the markdown directory
 */
async function getHabitsFilePath(): Promise<string> {
  const folder = await getSelectedFolder();
  if (!folder) {
    throw new Error("No folder selected. Please select a folder first.");
  }
  return folder.endsWith("/")
    ? `${folder}${HABITS_FILENAME}`
    : `${folder}/${HABITS_FILENAME}`;
}

/**
 * Read habits from the JSON file in the markdown directory
 */
async function readHabitsFromFile(): Promise<Habit[]> {
  try {
    const filePath = await getHabitsFilePath();
    const fileExists = await exists(filePath);
    if (!fileExists) {
      return [];
    }
    const content = await readTextFile(filePath);
    const data = JSON.parse(content);
    return data.habits || [];
  } catch (error) {
    console.error("Error reading habits file:", error);
    return [];
  }
}

/**
 * Write habits to the JSON file in the markdown directory
 */
async function writeHabitsToFile(habits: Habit[]): Promise<void> {
  const filePath = await getHabitsFilePath();
  const content = JSON.stringify({ habits }, null, 2);
  await writeTextFile(filePath, content);
}

/**
 * Generate a unique ID for a new habit
 */
function generateId(): string {
  return `habit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Format a date as YYYY-MM-DD
 */
export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get the start of the week (Monday) for a given date
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Adjust so Monday = 0, Sunday = 6
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the end of the week (Sunday) for a given date
 */
export function getWeekEnd(date: Date): Date {
  const weekStart = getWeekStart(date);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return weekEnd;
}

/**
 * Get the start of the month for a given date
 */
export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * Get the end of the month for a given date
 */
export function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * Get all dates in a range (inclusive)
 */
function getDatesInRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);

  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    dates.push(formatDateKey(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Get the date range for a habit's period
 */
export function getPeriodDateRange(
  date: Date,
  period: HabitPeriod,
): { start: Date; end: Date } {
  switch (period) {
    case "daily":
      return {
        start: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
        end: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
      };
    case "weekly":
      return {
        start: getWeekStart(date),
        end: getWeekEnd(date),
      };
    case "monthly":
      return {
        start: getMonthStart(date),
        end: getMonthEnd(date),
      };
  }
}

/**
 * Get the total completions for a habit within its period
 */
export function getCompletionsForPeriod(
  habit: Habit,
  date: Date,
): { completed: number; target: number; dates: string[] } {
  const { start, end } = getPeriodDateRange(date, habit.period);
  const dates = getDatesInRange(start, end);

  const completed = dates.reduce((sum, dateKey) => {
    return sum + (habit.completions[dateKey] || 0);
  }, 0);

  return {
    completed,
    target: habit.targetCount,
    dates,
  };
}

/**
 * Get all habits from the file
 */
export async function getAllHabits(): Promise<Habit[]> {
  try {
    return await readHabitsFromFile();
  } catch (error) {
    console.error("Error getting habits:", error);
    return [];
  }
}

/**
 * Create a new habit
 */
export async function createHabit(
  name: string,
  targetCount: number,
  period: HabitPeriod,
  icon?: HabitIcon,
): Promise<Habit> {
  try {
    const habits = await readHabitsFromFile();

    const newHabit: Habit = {
      id: generateId(),
      name: name.trim(),
      targetCount,
      period,
      icon,
      createdAt: Date.now(),
      completions: {},
    };

    habits.push(newHabit);
    await writeHabitsToFile(habits);

    return newHabit;
  } catch (error) {
    console.error("Error creating habit:", error);
    throw new Error("Failed to create habit");
  }
}

/**
 * Delete a habit by ID
 */
export async function deleteHabit(id: string): Promise<void> {
  try {
    const habits = await readHabitsFromFile();

    const filteredHabits = habits.filter((h) => h.id !== id);

    if (filteredHabits.length === habits.length) {
      throw new Error("Habit not found");
    }

    await writeHabitsToFile(filteredHabits);
  } catch (error) {
    console.error("Error deleting habit:", error);
    throw new Error("Failed to delete habit");
  }
}

/**
 * Update an existing habit
 */
export async function updateHabit(
  id: string,
  updates: {
    name?: string;
    targetCount?: number;
    period?: HabitPeriod;
    icon?: HabitIcon;
  },
): Promise<Habit> {
  try {
    const habits = await readHabitsFromFile();

    const habitIndex = habits.findIndex((h) => h.id === id);
    if (habitIndex === -1) {
      throw new Error("Habit not found");
    }

    const habit = habits[habitIndex];

    // Apply updates
    if (updates.name !== undefined) {
      habit.name = updates.name.trim();
    }
    if (updates.targetCount !== undefined) {
      habit.targetCount = updates.targetCount;
    }
    if (updates.period !== undefined) {
      habit.period = updates.period;
    }
    if (updates.icon !== undefined) {
      habit.icon = updates.icon;
    }

    await writeHabitsToFile(habits);

    return habit;
  } catch (error) {
    console.error("Error updating habit:", error);
    throw new Error("Failed to update habit");
  }
}

/**
 * Increment the completion count for a habit on a specific date
 */
export async function incrementCompletion(
  habitId: string,
  date: Date,
): Promise<Habit> {
  try {
    const habits = await readHabitsFromFile();

    const habitIndex = habits.findIndex((h) => h.id === habitId);
    if (habitIndex === -1) {
      throw new Error("Habit not found");
    }

    const dateKey = formatDateKey(date);
    const habit = habits[habitIndex];
    habit.completions[dateKey] = (habit.completions[dateKey] || 0) + 1;

    await writeHabitsToFile(habits);

    return habit;
  } catch (error) {
    console.error("Error incrementing completion:", error);
    throw new Error("Failed to increment completion");
  }
}

/**
 * Decrement the completion count for a habit on a specific date
 * Will not go below 0
 */
export async function decrementCompletion(
  habitId: string,
  date: Date,
): Promise<Habit> {
  try {
    const habits = await readHabitsFromFile();

    const habitIndex = habits.findIndex((h) => h.id === habitId);
    if (habitIndex === -1) {
      throw new Error("Habit not found");
    }

    const dateKey = formatDateKey(date);
    const habit = habits[habitIndex];
    const currentCount = habit.completions[dateKey] || 0;

    if (currentCount > 0) {
      habit.completions[dateKey] = currentCount - 1;

      // Clean up zero entries
      if (habit.completions[dateKey] === 0) {
        delete habit.completions[dateKey];
      }

      await writeHabitsToFile(habits);
    }

    return habit;
  } catch (error) {
    console.error("Error decrementing completion:", error);
    throw new Error("Failed to decrement completion");
  }
}

/**
 * Get the completion count for a habit on a specific date
 */
export function getCompletionForDate(habit: Habit, date: Date): number {
  const dateKey = formatDateKey(date);
  return habit.completions[dateKey] || 0;
}

/**
 * Get a human-readable label for a period
 */
export function getPeriodLabel(period: HabitPeriod): string {
  switch (period) {
    case "daily":
      return "today";
    case "weekly":
      return "this week";
    case "monthly":
      return "this month";
  }
}
