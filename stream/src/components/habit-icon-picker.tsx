"use client";

import {
  BarbellIcon,
  BicycleIcon,
  BookOpenIcon,
  BrainIcon,
  CameraIcon,
  CheckSquareIcon,
  ClockIcon,
  CoffeeIcon,
  DropIcon,
  FireIcon,
  HeartIcon,
  type IconProps,
  LightningIcon,
  MoonIcon,
  MusicNoteIcon,
  PencilIcon,
  StarIcon,
  SunIcon,
  TargetIcon,
  TimerIcon,
  TreeIcon,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DEFAULT_HABIT_ICON,
  HABIT_ICONS,
  type HabitIcon,
} from "@/ipc/habit-reader";

/**
 * Map icon names to their Phosphor components
 */
const iconComponents: Record<HabitIcon, ComponentType<IconProps>> = {
  Barbell: BarbellIcon,
  Bicycle: BicycleIcon,
  Heart: HeartIcon,
  Lightning: LightningIcon,
  Fire: FireIcon,
  Timer: TimerIcon,
  BookOpen: BookOpenIcon,
  Pencil: PencilIcon,
  Target: TargetIcon,
  Star: StarIcon,
  CheckSquare: CheckSquareIcon,
  Clock: ClockIcon,
  Coffee: CoffeeIcon,
  Drop: DropIcon,
  Moon: MoonIcon,
  Sun: SunIcon,
  Tree: TreeIcon,
  Brain: BrainIcon,
  MusicNote: MusicNoteIcon,
  Camera: CameraIcon,
};

interface HabitIconPickerProps {
  value?: HabitIcon;
  onChange: (icon: HabitIcon) => void;
  disabled?: boolean;
}

/**
 * Get the icon component for a habit icon name
 */
export function getHabitIconComponent(
  icon?: HabitIcon,
): ComponentType<IconProps> {
  return iconComponents[icon || DEFAULT_HABIT_ICON];
}

export function HabitIconPicker({
  value,
  onChange,
  disabled,
}: HabitIconPickerProps) {
  const selectedIcon = value || DEFAULT_HABIT_ICON;
  const SelectedIconComponent = iconComponents[selectedIcon];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10"
          disabled={disabled}
          type="button"
        >
          <SelectedIconComponent className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-5 gap-1">
          {HABIT_ICONS.map((iconName) => {
            const IconComponent = iconComponents[iconName];
            const isSelected = iconName === selectedIcon;

            return (
              <Button
                key={iconName}
                variant={isSelected ? "secondary" : "ghost"}
                size="icon"
                className="h-9 w-9"
                onClick={() => onChange(iconName)}
                type="button"
                title={iconName}
              >
                <IconComponent className="h-5 w-5" />
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default HabitIconPicker;
