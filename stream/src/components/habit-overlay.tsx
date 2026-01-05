"use client";

import {
  CheckCircleIcon,
  MinusIcon,
  PlusIcon,
  TargetIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { getHabitIconComponent } from "@/components/habit-icon-picker";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useHabits, useUpdateCompletion } from "@/hooks/use-habits";
import {
  getCompletionForDate,
  getCompletionsForPeriod,
  getPeriodLabel,
  type Habit,
} from "@/ipc/habit-reader";

interface HabitOverlayProps {
  date: Date;
  className?: string;
  onCreateHabit?: () => void;
  isFocused?: boolean;
}

interface HabitRowProps {
  habit: Habit;
  date: Date;
}

function HabitRow({ habit, date }: HabitRowProps) {
  const { mutate: updateCompletion, isPending } = useUpdateCompletion();

  const todayCount = getCompletionForDate(habit, date);
  const { completed, target } = getCompletionsForPeriod(habit, date);
  const isTargetMet = completed >= target;
  const periodLabel = getPeriodLabel(habit.period);

  const HabitIcon = getHabitIconComponent(habit.icon);

  const handleIncrement = () => {
    updateCompletion({ habitId: habit.id, date, action: "increment" });
  };

  const handleDecrement = () => {
    updateCompletion({ habitId: habit.id, date, action: "decrement" });
  };

  return (
    <div className="group flex items-center justify-between rounded-md border bg-card/50 p-3 transition-colors hover:bg-accent/50">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {isTargetMet ? (
            <CheckCircleIcon className="h-4 w-4 text-green-500" weight="fill" />
          ) : (
            <HabitIcon className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium text-sm">{habit.name}</span>
        </div>
        <div className="ml-6 text-muted-foreground text-xs">
          <span className={isTargetMet ? "text-green-500" : ""}>
            {completed}/{target}
          </span>{" "}
          {periodLabel}
          {todayCount > 0 && (
            <span className="ml-2 text-foreground">({todayCount} today)</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleDecrement}
          disabled={isPending || todayCount === 0}
        >
          <MinusIcon className="h-4 w-4" />
        </Button>
        <span className="w-6 text-center font-medium text-sm">
          {todayCount}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleIncrement}
          disabled={isPending}
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function HabitOverlay({
  date,
  className = "",
  onCreateHabit,
  isFocused = false,
}: HabitOverlayProps) {
  const { data: habits = [], isLoading } = useHabits();
  const [expanded, setExpanded] = useState<string | undefined>(undefined);

  // Calculate total completions for this day
  const totalCompletionsToday = habits.reduce((sum, habit) => {
    return sum + getCompletionForDate(habit, date);
  }, 0);

  // Only show when focused OR when there are completions for this day
  if (isLoading || (!isFocused && totalCompletionsToday === 0)) {
    return null;
  }

  const hasHabits = habits.length > 0;

  return (
    <div className={`space-y-3 ${className}`}>
      <Card className="bg-background/60 p-1">
        <Accordion
          type="single"
          collapsible
          value={expanded}
          onValueChange={(val) => setExpanded(val)}
        >
          <AccordionItem value="habits" className="border-0">
            <AccordionTrigger className="px-4 py-2 hover:no-underline [&[data-state=closed]>div>span:last-child]:text-muted-foreground [&[data-state=open]>div>span:last-child]:text-muted-foreground">
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2">
                  <TargetIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">Habits</span>
                  {hasHabits && totalCompletionsToday > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {totalCompletionsToday} completed
                    </Badge>
                  )}
                </div>
                <span className="text-muted-foreground text-xs">
                  {expanded === "habits" ? "Hide" : "Show"}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <CardContent className="pt-2">
                <div className="max-h-[300px] space-y-2 overflow-y-auto">
                  {habits.map((habit) => (
                    <HabitRow key={habit.id} habit={habit} date={date} />
                  ))}

                  {!hasHabits && (
                    <div className="py-4 text-center text-muted-foreground text-sm">
                      <p>No habits yet</p>
                      {onCreateHabit && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={onCreateHabit}
                        >
                          <PlusIcon className="mr-2 h-4 w-4" />
                          Add Habit
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
    </div>
  );
}

export default HabitOverlay;
