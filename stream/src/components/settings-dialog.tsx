"use client";

import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderOpenIcon,
  GitBranchIcon,
  PlusIcon,
  SparkleIcon,
  TargetIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { CreateHabitDialog } from "@/components/create-habit-dialog";
import RepoConnector from "@/components/repo-connector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useConnectedRepos, useFetchRepos } from "@/hooks/use-git-queries";
import { useDeleteHabit, useHabits } from "@/hooks/use-habits";
import { useMarkdownMetadata } from "@/hooks/use-markdown-queries";
import {
  useApiKey,
  useRemoveApiKey,
  useSetApiKey,
} from "@/hooks/use-user-data";
import type { Habit } from "@/ipc/habit-reader";
import { useUserStore } from "@/stores/user-store";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function OverviewCard({
  fileCount,
  isLoading,
}: {
  fileCount: number;
  isLoading: boolean;
}) {
  const folderPath = useUserStore((state) => state.folderPath);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpenIcon className="size-5" />
          Overview
        </CardTitle>
        <CardDescription>Folder information and statistics</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm">Reading from:</div>
          <code className="block break-all rounded-md bg-muted px-0.5 py-1 font-mono text-xs">
            {folderPath}
          </code>
        </div>
        <div className="flex items-center gap-2 pt-2 text-muted-foreground">
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
              <span>Scanning for markdown files...</span>
            </div>
          ) : (
            <>
              <span className="font-semibold text-foreground text-xs">
                {fileCount}
              </span>
              <span className="text-muted-foreground text-xs">
                markdown files found
              </span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AISettingsCard() {
  const { data: apiKey, isLoading } = useApiKey();
  const setApiKeyMutation = useSetApiKey();
  const removeApiKeyMutation = useRemoveApiKey();

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const inputId = useId();

  useEffect(() => {
    setApiKeyInput(apiKey || "");
  }, [apiKey]);

  const hasChanges = apiKeyInput.trim() !== (apiKey || "");
  const isSaving =
    setApiKeyMutation.isPending || removeApiKeyMutation.isPending;
  const canSave = !isSaving && apiKeyInput.trim() !== "" && hasChanges;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparkleIcon className="size-5" />
          AI Features
        </CardTitle>
        <CardDescription>
          Configure Gemini for AI-powered features
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
            <span>Loading settings...</span>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor={inputId} className="font-medium text-sm">
                Google Gemini API Key
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={inputId}
                  type={showKey ? "text" : "password"}
                  placeholder="Enter your API key..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  disabled={isSaving}
                  className="!text-xs !h-8 !py-1 !px-2 !w-2/3 font-mono"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowKey(!showKey)}
                  disabled={isSaving}
                >
                  {showKey ? <EyeIcon /> : <EyeSlashIcon />}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Get your API key from{" "}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:text-primary/80"
                >
                  Google AI Studio
                </a>
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => setApiKeyMutation.mutateAsync(apiKeyInput)}
                disabled={!canSave}
                size="sm"
                className="text-xs"
              >
                {setApiKeyMutation.isPending ? (
                  <>
                    <CircleNotchIcon className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
              {apiKey && (
                <Button
                  onClick={() => removeApiKeyMutation.mutateAsync()}
                  disabled={isSaving}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                >
                  Remove
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HabitsCard() {
  const [createHabitOpen, setCreateHabitOpen] = useState(false);
  const [habitToDelete, setHabitToDelete] = useState<Habit | null>(null);

  const { data: habits = [], isLoading } = useHabits();
  const { mutate: deleteHabit, isPending: isDeleting } = useDeleteHabit();

  const handleConfirmDelete = () => {
    if (!habitToDelete) return;

    deleteHabit(habitToDelete.id, {
      onSuccess: () => {
        toast.success(`Deleted habit: ${habitToDelete.name}`);
        setHabitToDelete(null);
      },
      onError: (error) => {
        toast.error(`Failed to delete habit: ${error.message}`);
      },
    });
  };

  const getPeriodText = (habit: Habit) => {
    const count = habit.targetCount;
    switch (habit.period) {
      case "daily":
        return `${count}x per day`;
      case "weekly":
        return `${count}x per week`;
      case "monthly":
        return `${count}x per month`;
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TargetIcon className="size-5" />
            Habits
          </CardTitle>
          <CardDescription>
            Track your daily, weekly, or monthly habits
          </CardDescription>
          <CardAction>
            <Button
              onClick={() => setCreateHabitOpen(true)}
              variant="ghost"
              size="icon"
              className="size-8"
              title="Add new habit"
            >
              <PlusIcon className="size-4" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
              <span>Loading habits...</span>
            </div>
          ) : habits.length === 0 ? (
            <div className="py-4 text-center text-muted-foreground text-sm">
              No habits yet. Click the + button to add one.
            </div>
          ) : (
            <div className="space-y-2">
              {habits.map((habit) => (
                <div
                  key={habit.id}
                  className="flex items-center justify-between rounded-md border bg-card/50 p-3"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{habit.name}</span>
                      <Badge
                        variant="outline"
                        className="px-1.5 py-0 text-[10px]"
                      >
                        {habit.period}
                      </Badge>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {getPeriodText(habit)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setHabitToDelete(habit)}
                    title="Delete habit"
                  >
                    <TrashIcon className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateHabitDialog
        open={createHabitOpen}
        onOpenChange={setCreateHabitOpen}
      />

      <Dialog
        open={!!habitToDelete}
        onOpenChange={() => setHabitToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete habit?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-primary">
                {habitToDelete?.name}
              </span>
              ? All completion history will be lost. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setHabitToDelete(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const folderPath = useUserStore((state) => state.folderPath);
  const { data: allFilesMetadata = [], isLoading: isLoadingMetadata } =
    useMarkdownMetadata(folderPath || "");

  const { data: connectedRepos = [] } = useConnectedRepos(folderPath || "");
  const { mutateAsync: fetchReposMutation, isPending: isFetchingRepos } =
    useFetchRepos(folderPath || "");

  const { data: appVersion } = useQuery<string>({
    queryKey: ["appVersion"],
    queryFn: async () => {
      return await getVersion();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] w-full max-w-2xl overflow-y-scroll px-4 py-6 sm:px-6"
        onOpenAutoFocus={(e) => e.preventDefault()}
        aria-describedby="settings-dialog-description"
      >
        <DialogHeader className="pb-4">
          <DialogTitle className="text-2xl">Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <OverviewCard
            fileCount={allFilesMetadata.length}
            isLoading={isLoadingMetadata}
          />

          <Card className="pb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranchIcon className="size-5" />
                Connect Git Repositories
              </CardTitle>
              <CardDescription>
                Show your commits with your notes
              </CardDescription>
              {connectedRepos.length > 0 && (
                <CardAction>
                  <Button
                    onClick={async () => await fetchReposMutation()}
                    disabled={isFetchingRepos}
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    title="Git fetch all repositories"
                  >
                    {isFetchingRepos ? (
                      <CircleNotchIcon className="size-4 animate-spin" />
                    ) : (
                      <ArrowsClockwiseIcon className="size-4" />
                    )}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {folderPath && (
                <RepoConnector
                  key={folderPath}
                  markdownDirectory={folderPath}
                />
              )}
            </CardContent>
          </Card>

          <HabitsCard />

          <AISettingsCard />

          {appVersion && (
            <div className="flex justify-center pt-2 text-muted-foreground text-xs">
              stream {appVersion}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
