"use client";

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { type ReactNode, useEffect, useId, useState } from "react";
import RepoConnector from "@/components/repo-connector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConnectedRepos, useFetchRepos } from "@/hooks/use-git-queries";
import { useMarkdownMetadata } from "@/hooks/use-markdown-queries";
import {
  useApiKey,
  useRemoveApiKey,
  useSetApiKey,
} from "@/hooks/use-user-data";
import { useUserStore } from "@/stores/user-store";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SettingsSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 border-t pt-3">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h3 className="font-semibold text-[13.5px] text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
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
    <SettingsSection title="AI">
      {isLoading ? (
        <div className="text-muted-foreground">Loading settings...</div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor={inputId} className="text-muted-foreground">
            Google Gemini API key
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id={inputId}
              type={showKey ? "text" : "password"}
              placeholder="Enter your API key"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              disabled={isSaving}
              className="h-7"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowKey(!showKey)}
              disabled={isSaving}
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? <EyeIcon /> : <EyeSlashIcon />}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Get a key from{" "}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              Google AI Studio
            </a>
          </p>
          <div className="flex gap-2">
            <Button
              onClick={() => setApiKeyMutation.mutateAsync(apiKeyInput)}
              disabled={!canSave}
              size="sm"
            >
              {setApiKeyMutation.isPending ? "Saving..." : "Save key"}
            </Button>
            {apiKey && (
              <Button
                onClick={() => removeApiKeyMutation.mutateAsync()}
                disabled={isSaving}
                variant="outline"
                size="sm"
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </SettingsSection>
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
        className="max-h-[80vh] overflow-y-auto sm:max-w-lg"
        initialFocus={false}
      >
        <DialogHeader>
          <DialogTitle className="font-serif text-[22px] text-heading leading-[1.2]">
            Settings
          </DialogTitle>
          <DialogDescription className="sr-only">
            Folder, Git and AI settings
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <SettingsSection title="Folder">
            <code className="break-all text-body text-xs">{folderPath}</code>
            <p className="text-muted-foreground text-xs">
              {isLoadingMetadata
                ? "Scanning for markdown files..."
                : `${allFilesMetadata.length} markdown files found`}
            </p>
          </SettingsSection>

          <SettingsSection
            title="Git repositories"
            action={
              connectedRepos.length > 0 && (
                <Button
                  onClick={async () => await fetchReposMutation()}
                  disabled={isFetchingRepos}
                  variant="ghost"
                  size="xs"
                  title="Git fetch all repositories"
                >
                  {isFetchingRepos ? "Fetching..." : "Fetch"}
                </Button>
              )
            }
          >
            {folderPath && (
              <RepoConnector key={folderPath} markdownDirectory={folderPath} />
            )}
          </SettingsSection>

          <AISettingsCard />

          {appVersion && (
            <div className="text-muted-foreground text-xs">
              stream {appVersion}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
