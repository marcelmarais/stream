"use client";

import { getVersion } from "@tauri-apps/api/app";
import {
  EyeIcon,
  EyeOffIcon,
  FolderOpen,
  GitBranch,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import RepoConnector from "@/components/repo-connector";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApiKeyStore } from "@/stores/api-key-store";
import { useMarkdownFilesStore } from "@/stores/markdown-files-store";

interface SettingsDialogProps {
  folderPath: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function OverviewCard({
  folderPath,
  fileCount,
  isLoading,
}: {
  folderPath: string;
  fileCount: number;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="size-5" />
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
  const { isLoading, isSaving, apiKey, setApiKey, removeApiKey } =
    useApiKeyStore();

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const inputId = useId();

  useEffect(() => {
    setApiKeyInput(apiKey || "");
  }, [apiKey]);

  const hasChanges = apiKeyInput.trim() !== (apiKey || "");
  const canSave = !isSaving && apiKeyInput.trim() !== "" && hasChanges;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5" />
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
              <div className="flex gap-2">
                <Input
                  id={inputId}
                  type={showKey ? "text" : "password"}
                  placeholder="Enter your API key..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  disabled={isSaving}
                  className="font-mono text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowKey(!showKey)}
                  disabled={isSaving}
                >
                  {showKey ? <EyeIcon /> : <EyeOffIcon />}
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
                onClick={() => setApiKey(apiKeyInput)}
                disabled={!canSave}
                size="sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save"
                )}
              </Button>
              {apiKey && (
                <Button
                  onClick={removeApiKey}
                  disabled={isSaving}
                  variant="outline"
                  size="sm"
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

export function SettingsDialog({
  folderPath,
  open,
  onOpenChange,
}: SettingsDialogProps) {
  // Get data from store
  const isLoadingMetadata = useMarkdownFilesStore(
    (state) => state.isLoadingMetadata,
  );
  const allFilesMetadata = useMarkdownFilesStore(
    (state) => state.allFilesMetadata,
  );

  const [fetchReposFn, setFetchReposFn] = useState<
    (() => Promise<void>) | null
  >(null);
  const [isFetching, setIsFetching] = useState(false);
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    const loadVersion = async () => {
      try {
        const version = await getVersion();
        setAppVersion(version);
      } catch (error) {
        console.error("Error loading app version:", error);
      }
    };
    loadVersion();
  }, []);

  const handleFetchRepos = async () => {
    if (fetchReposFn) {
      setIsFetching(true);
      await fetchReposFn();
      setIsFetching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] min-w-[70vw] overflow-y-scroll"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="pb-6">
          <DialogTitle className="text-2xl">Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <OverviewCard
            folderPath={folderPath}
            fileCount={allFilesMetadata.length}
            isLoading={isLoadingMetadata}
          />

          <Card className="pb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="size-5" />
                Connect Git Repositories
              </CardTitle>
              <CardDescription>
                Show your commits with your notes
              </CardDescription>
              {fetchReposFn && (
                <CardAction>
                  <Button
                    onClick={handleFetchRepos}
                    disabled={isFetching}
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    title="Git fetch all repositories"
                  >
                    {isFetching ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              <RepoConnector
                key={folderPath}
                markdownDirectory={folderPath}
                onFetchRepos={(fn) => setFetchReposFn(() => fn)}
              />
            </CardContent>
          </Card>
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
