"use client";

import { useEffect, useId, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";

interface EditFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateFile: (description: string, refreshInterval: string) => Promise<void>;
  currentFileName: string;
  currentDescription?: string;
  currentRefreshInterval?: string;
  isUpdating?: boolean;
}

export function EditFileDialog({
  open,
  onOpenChange,
  onUpdateFile,
  currentFileName,
  currentDescription = "",
  currentRefreshInterval = "none",
  isUpdating = false,
}: EditFileDialogProps) {
  const fileNameId = useId();
  const descriptionId = useId();
  const refreshIntervalId = useId();
  const [description, setDescription] = useState(currentDescription);
  const [refreshInterval, setRefreshInterval] = useState(
    currentRefreshInterval,
  );

  // Update description and refresh interval when dialog opens with new values
  useEffect(() => {
    if (open) {
      setDescription(currentDescription);
      setRefreshInterval(currentRefreshInterval);
    }
  }, [open, currentDescription, currentRefreshInterval]);

  const handleUpdate = async () => {
    try {
      await onUpdateFile(description, refreshInterval);
      onOpenChange(false);
      toast.success("File updated successfully");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to update file";
      toast.error(errorMessage);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isUpdating) {
      handleUpdate();
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setDescription(currentDescription);
      setRefreshInterval(currentRefreshInterval);
    }
    onOpenChange(newOpen);
  };

  // Get display name without extension
  const displayName = currentFileName.replace(/\.md$/, "");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit File</DialogTitle>
          <DialogDescription>
            Update the metadata for this file.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor={fileNameId}>File Name</Label>
            <Input
              id={fileNameId}
              value={displayName}
              disabled
              className="bg-muted"
            />
            <p className="text-muted-foreground text-xs">
              File name cannot be changed
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={descriptionId}>Description</Label>
            <Textarea
              id={descriptionId}
              placeholder="Brief description of this file"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isUpdating}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={refreshIntervalId}>Auto-refresh</Label>
            <Select
              value={refreshInterval}
              onValueChange={setRefreshInterval}
              disabled={isUpdating}
            >
              <SelectTrigger id={refreshIntervalId}>
                <SelectValue placeholder="Select refresh interval" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="minutely">Every Minute</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isUpdating}
          >
            Cancel
          </Button>
          <Button onClick={handleUpdate} disabled={isUpdating}>
            {isUpdating ? "Updating..." : "Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
