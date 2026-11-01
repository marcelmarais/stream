"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  useAddRepo,
  useConnectedRepos,
  useDiscoveredRepos,
  useRemoveRepo,
} from "@/hooks/use-git-queries";
import type { DiscoveredRepo } from "@/ipc/git-reader";
import { cn } from "@/lib/utils";

interface RepoConnectorProps {
  markdownDirectory: string;
}

function filterRepos(value: string, search: string) {
  return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
}

function RepoRow({
  repo,
  isConnected,
  onToggle,
}: {
  repo: DiscoveredRepo;
  isConnected: boolean;
  onToggle: () => void;
}) {
  return (
    <CommandItem
      value={repo.display_path}
      onSelect={onToggle}
      className="gap-2.5 px-2.5 py-1.5 [&>svg]:hidden"
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center rounded-[2px] border",
          isConnected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input",
        )}
      >
        {isConnected && <CheckIcon className="size-2.5" weight="bold" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12.5px] text-foreground">
          {repo.name}
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground">
          {repo.display_path}
        </span>
      </span>
      {repo.last_modified && (
        <span className="shrink-0 text-muted-foreground">
          {formatDistanceToNowStrict(repo.last_modified, { addSuffix: true })}
        </span>
      )}
    </CommandItem>
  );
}

export function RepoConnector({ markdownDirectory }: RepoConnectorProps) {
  const { data: connectedRepos = [] } = useConnectedRepos(markdownDirectory);
  const { data: repos = [], isLoading } = useDiscoveredRepos(markdownDirectory);
  const addRepo = useAddRepo(markdownDirectory);
  const removeRepo = useRemoveRepo(markdownDirectory);

  const connected = repos.filter((repo) => connectedRepos.includes(repo.path));
  const suggestions = repos.filter(
    (repo) => !connectedRepos.includes(repo.path),
  );

  const toggleRepo = async (repoPath: string) => {
    try {
      if (connectedRepos.includes(repoPath)) {
        await removeRepo.mutateAsync(repoPath);
      } else {
        await addRepo.mutateAsync(repoPath);
      }
    } catch (error) {
      console.error("Error updating repositories:", error);
      toast.error("Failed to update repositories");
    }
  };

  const handleChooseFolder = async () => {
    const folderPath = await open({
      directory: true,
      multiple: false,
      title: "Select Code Repository",
    });

    if (typeof folderPath === "string") {
      await addRepo.mutateAsync(folderPath);
    }
  };

  const renderRow = (repo: DiscoveredRepo) => (
    <RepoRow
      key={repo.path}
      repo={repo}
      isConnected={connectedRepos.includes(repo.path)}
      onToggle={() => toggleRepo(repo.path)}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      <Command
        filter={filterRepos}
        className="rounded-sm border border-well-rule bg-well"
      >
        <CommandInput autoFocus placeholder="Filter repositories" />
        <CommandList className="max-h-[22rem]">
          {isLoading && (
            <div className="px-2.5 py-3 text-muted-foreground">
              Looking for repositories...
            </div>
          )}
          {!isLoading && <CommandEmpty>No repositories found</CommandEmpty>}
          {connected.length > 0 && (
            <CommandGroup heading="Connected">
              {connected.map(renderRow)}
            </CommandGroup>
          )}
          {suggestions.length > 0 && (
            <CommandGroup heading="On this Mac">
              {suggestions.map(renderRow)}
            </CommandGroup>
          )}
        </CommandList>
      </Command>

      <button
        type="button"
        className="self-start text-muted-foreground hover:text-foreground"
        onClick={handleChooseFolder}
      >
        Choose a folder
      </button>
    </div>
  );
}

export default RepoConnector;
