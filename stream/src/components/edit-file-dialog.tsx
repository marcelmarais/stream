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

interface EditFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateFile: (description: string) => Promise<void>;
  currentFileName: string;
  currentDescription?: string;
  isUpdating?: boolean;
}

export function EditFileDialog({
  open,
  onOpenChange,
  onUpdateFile,
  currentFileName,
  currentDescription = "",
  isUpdating = false,
}: EditFileDialogProps) {
  const [description, setDescription] = useState(currentDescription);

  // Update description when dialog opens with new values
  useState(() => {
    if (open) {
      setDescription(currentDescription);
    }
  });

  const handleUpdate = async () => {
    try {
      await onUpdateFile(description);
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
            <Label htmlFor="fileName">File Name</Label>
            <Input
              id="fileName"
              value={displayName}
              disabled
              className="bg-muted"
            />
            <p className="text-muted-foreground text-xs">
              File name cannot be changed
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              placeholder="Brief description of this file"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isUpdating}
              autoFocus
            />
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
