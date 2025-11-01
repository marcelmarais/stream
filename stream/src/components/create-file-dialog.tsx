"use client";

import { useId, useState } from "react";
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

interface CreateFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateFile: (
    fileName: string,
    description: string,
    refreshInterval: string,
  ) => Promise<void>;
  isCreating?: boolean;
}

export function CreateFileDialog({
  open,
  onOpenChange,
  onCreateFile,
  isCreating = false,
}: CreateFileDialogProps) {
  const fileNameId = useId();
  const descriptionId = useId();
  const refreshIntervalId = useId();
  const [fileName, setFileName] = useState("");
  const [description, setDescription] = useState("");
  const [refreshInterval, setRefreshInterval] = useState("none");
  const [error, setError] = useState("");

  const validateFileName = (name: string): boolean => {
    if (!name.trim()) {
      setError("File name is required");
      return false;
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(name)) {
      setError("File name contains invalid characters");
      return false;
    }

    // Check for reserved names (cross-platform)
    const reserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
    const nameWithoutExt = name.replace(/\.md$/, "");
    if (reserved.test(nameWithoutExt)) {
      setError("File name is reserved");
      return false;
    }

    setError("");
    return true;
  };

  const handleCreate = async () => {
    if (!validateFileName(fileName)) {
      return;
    }

    try {
      await onCreateFile(fileName, description, refreshInterval);
      setFileName("");
      setDescription("");
      setRefreshInterval("none");
      setError("");
      onOpenChange(false);
      toast.success("File created successfully");
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to create file";
      setError(errorMessage);
      toast.error(errorMessage);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isCreating) {
      handleCreate();
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setFileName("");
      setDescription("");
      setRefreshInterval("none");
      setError("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New File</DialogTitle>
          <DialogDescription>
            Enter a name for your new markdown file. The .md extension will be
            added automatically if not provided.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor={fileNameId}>File Name</Label>
            <Input
              id={fileNameId}
              placeholder="my-notes"
              value={fileName}
              onChange={(e) => {
                setFileName(e.target.value);
                if (error) validateFileName(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              disabled={isCreating}
              autoFocus
              aria-invalid={!!error}
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={descriptionId}>Description (optional)</Label>
            <Input
              id={descriptionId}
              placeholder="Brief description of this file"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isCreating}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={refreshIntervalId}>Auto-refresh</Label>
            <Select
              value={refreshInterval}
              onValueChange={setRefreshInterval}
              disabled={isCreating}
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
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isCreating || !fileName.trim()}
          >
            {isCreating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
