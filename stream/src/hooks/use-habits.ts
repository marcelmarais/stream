import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createHabit,
  decrementCompletion,
  deleteHabit,
  getAllHabits,
  type Habit,
  type HabitIcon,
  type HabitPeriod,
  incrementCompletion,
  updateHabit,
} from "@/ipc/habit-reader";

/**
 * Query keys for habit-related queries
 */
export const habitKeys = {
  all: ["habits"] as const,
  list: () => [...habitKeys.all, "list"] as const,
};

/**
 * Hook to fetch all habits
 */
export function useHabits() {
  return useQuery({
    queryKey: habitKeys.list(),
    queryFn: getAllHabits,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to create a new habit
 */
export function useCreateHabit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      name,
      targetCount,
      period,
      icon,
    }: {
      name: string;
      targetCount: number;
      period: HabitPeriod;
      icon?: HabitIcon;
    }) => createHabit(name, targetCount, period, icon),
    onSuccess: (newHabit) => {
      // Optimistically add the new habit to the cache
      queryClient.setQueryData<Habit[]>(habitKeys.list(), (old) => {
        if (!old) return [newHabit];
        return [...old, newHabit];
      });
    },
    onSettled: () => {
      // Invalidate to ensure we have the latest data
      queryClient.invalidateQueries({ queryKey: habitKeys.list() });
    },
  });
}

/**
 * Hook to delete a habit
 */
export function useDeleteHabit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (habitId: string) => deleteHabit(habitId),
    onMutate: async (habitId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: habitKeys.list() });

      // Snapshot the previous value
      const previousHabits = queryClient.getQueryData<Habit[]>(
        habitKeys.list(),
      );

      // Optimistically remove the habit
      queryClient.setQueryData<Habit[]>(habitKeys.list(), (old) => {
        if (!old) return [];
        return old.filter((h) => h.id !== habitId);
      });

      return { previousHabits };
    },
    onError: (_err, _habitId, context) => {
      // Roll back on error
      if (context?.previousHabits) {
        queryClient.setQueryData(habitKeys.list(), context.previousHabits);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: habitKeys.list() });
    },
  });
}

/**
 * Hook to update an existing habit
 */
export function useUpdateHabit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: {
        name?: string;
        targetCount?: number;
        period?: HabitPeriod;
        icon?: HabitIcon;
      };
    }) => updateHabit(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: habitKeys.list() });

      // Snapshot the previous value
      const previousHabits = queryClient.getQueryData<Habit[]>(
        habitKeys.list(),
      );

      // Optimistically update the habit
      queryClient.setQueryData<Habit[]>(habitKeys.list(), (old) => {
        if (!old) return [];
        return old.map((habit) => {
          if (habit.id !== id) return habit;
          return {
            ...habit,
            ...(updates.name !== undefined && { name: updates.name.trim() }),
            ...(updates.targetCount !== undefined && {
              targetCount: updates.targetCount,
            }),
            ...(updates.period !== undefined && { period: updates.period }),
            ...(updates.icon !== undefined && { icon: updates.icon }),
          };
        });
      });

      return { previousHabits };
    },
    onError: (_err, _vars, context) => {
      // Roll back on error
      if (context?.previousHabits) {
        queryClient.setQueryData(habitKeys.list(), context.previousHabits);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: habitKeys.list() });
    },
  });
}

/**
 * Hook to increment/decrement habit completions
 */
export function useUpdateCompletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      habitId,
      date,
      action,
    }: {
      habitId: string;
      date: Date;
      action: "increment" | "decrement";
    }) => {
      if (action === "increment") {
        return incrementCompletion(habitId, date);
      }
      return decrementCompletion(habitId, date);
    },
    onMutate: async ({ habitId, date, action }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: habitKeys.list() });

      // Snapshot the previous value
      const previousHabits = queryClient.getQueryData<Habit[]>(
        habitKeys.list(),
      );

      // Optimistically update the completion count
      queryClient.setQueryData<Habit[]>(habitKeys.list(), (old) => {
        if (!old) return [];

        return old.map((habit) => {
          if (habit.id !== habitId) return habit;

          const dateKey = formatDateKeyLocal(date);
          const currentCount = habit.completions[dateKey] || 0;
          const newCount =
            action === "increment"
              ? currentCount + 1
              : Math.max(0, currentCount - 1);

          const newCompletions = { ...habit.completions };
          if (newCount === 0) {
            delete newCompletions[dateKey];
          } else {
            newCompletions[dateKey] = newCount;
          }

          return {
            ...habit,
            completions: newCompletions,
          };
        });
      });

      return { previousHabits };
    },
    onError: (_err, _vars, context) => {
      // Roll back on error
      if (context?.previousHabits) {
        queryClient.setQueryData(habitKeys.list(), context.previousHabits);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: habitKeys.list() });
    },
  });
}

/**
 * Local helper to format date key (duplicated to avoid circular imports)
 */
function formatDateKeyLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
