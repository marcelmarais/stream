import { Store } from "@tauri-apps/plugin-store";

/**
 * Habit tracking period options
 */
export type HabitPeriod = "daily" | "weekly" | "monthly";

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
  /** Creation timestamp in milliseconds */
  createdAt: number;
  /** Completion counts by date (YYYY-MM-DD -> count) */
  completions: Record<string, number>;
}

/**
 * Structure of the habits.json store
 */
interface HabitData {
  habits: Habit[];
}

// Store instance for habits
let store: Store | null = null;

/**
 * Initialize the habits store
 */
async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load("habits.json");
  }
  return store;
}

const HABITS_KEY = "habits";

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
 * Get all habits from the store
 */
export async function getAllHabits(): Promise<Habit[]> {
  try {
    const s = await getStore();
    const habits = await s.get<Habit[]>(HABITS_KEY);
    return habits || [];
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
): Promise<Habit> {
  try {
    const s = await getStore();
    const habits = (await s.get<Habit[]>(HABITS_KEY)) || [];

    const newHabit: Habit = {
      id: generateId(),
      name: name.trim(),
      targetCount,
      period,
      createdAt: Date.now(),
      completions: {},
    };

    habits.push(newHabit);
    await s.set(HABITS_KEY, habits);
    await s.save();

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
    const s = await getStore();
    const habits = (await s.get<Habit[]>(HABITS_KEY)) || [];

    const filteredHabits = habits.filter((h) => h.id !== id);

    if (filteredHabits.length === habits.length) {
      throw new Error("Habit not found");
    }

    await s.set(HABITS_KEY, filteredHabits);
    await s.save();
  } catch (error) {
    console.error("Error deleting habit:", error);
    throw new Error("Failed to delete habit");
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
    const s = await getStore();
    const habits = (await s.get<Habit[]>(HABITS_KEY)) || [];

    const habitIndex = habits.findIndex((h) => h.id === habitId);
    if (habitIndex === -1) {
      throw new Error("Habit not found");
    }

    const dateKey = formatDateKey(date);
    const habit = habits[habitIndex];
    habit.completions[dateKey] = (habit.completions[dateKey] || 0) + 1;

    await s.set(HABITS_KEY, habits);
    await s.save();

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
    const s = await getStore();
    const habits = (await s.get<Habit[]>(HABITS_KEY)) || [];

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

      await s.set(HABITS_KEY, habits);
      await s.save();
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
