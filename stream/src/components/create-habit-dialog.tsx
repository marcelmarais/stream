"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateHabit } from "@/hooks/use-habits";
import type { HabitPeriod } from "@/ipc/habit-reader";

interface CreateHabitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateHabitDialog({
  open,
  onOpenChange,
}: CreateHabitDialogProps) {
  const [name, setName] = useState("");
  const [targetCount, setTargetCount] = useState(1);
  const [period, setPeriod] = useState<HabitPeriod>("weekly");

  const { mutate: createHabit, isPending } = useCreateHabit();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Please enter a habit name");
      return;
    }

    if (targetCount < 1) {
      toast.error("Target must be at least 1");
      return;
    }

    createHabit(
      { name: name.trim(), targetCount, period },
      {
        onSuccess: () => {
          toast.success(`Created habit: ${name.trim()}`);
          setName("");
          setTargetCount(1);
          setPeriod("weekly");
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(`Failed to create habit: ${error.message}`);
        },
      },
    );
  };

  const handleClose = () => {
    if (!isPending) {
      setName("");
      setTargetCount(1);
      setPeriod("weekly");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Habit</DialogTitle>
            <DialogDescription>
              Add a new habit to track. Set a target and how often you want to
              complete it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="habit-name">Habit Name</Label>
              <Input
                id="habit-name"
                placeholder="e.g., Exercise, Read, Meditate"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="target-count">Target</Label>
                <Input
                  id="target-count"
                  type="number"
                  min={1}
                  max={100}
                  value={targetCount}
                  onChange={(e) =>
                    setTargetCount(
                      Math.max(1, Number.parseInt(e.target.value) || 1),
                    )
                  }
                  disabled={isPending}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="period">Period</Label>
                <Select
                  value={period}
                  onValueChange={(value: HabitPeriod) => setPeriod(value)}
                  disabled={isPending}
                >
                  <SelectTrigger id="period">
                    <SelectValue placeholder="Select period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-muted-foreground text-sm">
              {period === "daily" &&
                `Complete ${targetCount} time${targetCount > 1 ? "s" : ""} per day`}
              {period === "weekly" &&
                `Complete ${targetCount} time${targetCount > 1 ? "s" : ""} per week`}
              {period === "monthly" &&
                `Complete ${targetCount} time${targetCount > 1 ? "s" : ""} per month`}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Creating..." : "Create Habit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CreateHabitDialog;
