"use client";

import { Switch } from "@base-ui/react/switch";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AgentLogo } from "@/components/agent-stack";
import RepoConnector from "@/components/repo-connector";
import { Titlebar } from "@/components/titlebar-header";
import { Button } from "@/components/ui/button";
import {
  useConnectedRepos,
  useFetchRepos,
  useRunningAgents,
} from "@/hooks/use-git-queries";
import { useMarkdownMetadata } from "@/hooks/use-markdown-queries";
import { useSetSelectedFolder } from "@/hooks/use-user-data";
import type { AgentKind } from "@/ipc/agents";
import { useUserStore } from "@/stores/user-store";

const AGENT_ROWS: { kind: AgentKind; name: string }[] = [
  { kind: "claude", name: "Claude Code" },
  { kind: "codex", name: "Codex" },
];

function AgentsSection({ folderPath }: { folderPath: string }) {
  const agentsEnabled = useUserStore((state) => state.agentsEnabled);
  const setAgentsEnabled = useUserStore((state) => state.setAgentsEnabled);
  const agents = useRunningAgents(folderPath);

  const getStatus = (kind: AgentKind) => {
    const running = agents.filter(
      (agent) => agent.kind === kind && agent.status !== "finished",
    ).length;
    return running > 0 ? `${running} running` : "None running";
  };

  return (
    <section className="mt-7 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-[22px] text-heading leading-[1.2]">
          Agents
        </h2>
        <Switch.Root
          checked={agentsEnabled}
          onCheckedChange={setAgentsEnabled}
          aria-label="Show running agents"
          className="flex h-4 w-[30px] shrink-0 items-center rounded-[2px] bg-rail px-0.5 data-checked:bg-primary"
        >
          <Switch.Thumb className="size-3 rounded-[1px] bg-muted-foreground transition-transform data-checked:translate-x-3.5 data-checked:bg-background" />
        </Switch.Root>
      </div>
      <p className="text-muted-foreground text-xs">
        Show agents running in your repositories on today's note. Stream only
        reads session files on this Mac.
      </p>
      {agentsEnabled && (
        <div className="flex flex-col">
          {AGENT_ROWS.map(({ kind, name }) => (
            <div
              key={kind}
              className="flex items-center gap-2.5 border-border border-b py-2"
            >
              <AgentLogo
                kind={kind}
                size={16}
                cutoutClassName="stroke-background"
              />
              <span className="text-foreground">{name}</span>
              <span className="ml-auto text-muted-foreground text-xs">
                {getStatus(kind)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function SettingsPage({ folderPath }: { folderPath: string }) {
  const router = useRouter();
  const setSettingsOpen = useUserStore((state) => state.setSettingsOpen);
  const setStoredFolderPath = useUserStore((state) => state.setFolderPath);

  const { data: files = [], isLoading } = useMarkdownMetadata(folderPath);
  const { data: connectedRepos = [] } = useConnectedRepos(folderPath);
  const { mutateAsync: fetchRepos, isPending: isFetching } =
    useFetchRepos(folderPath);
  const { mutateAsync: setSelectedFolder } = useSetSelectedFolder();

  const { data: appVersion } = useQuery<string>({
    queryKey: ["appVersion"],
    queryFn: getVersion,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSettingsOpen]);

  const handleChangeFolder = async () => {
    const selected = await open({ directory: true, multiple: false });

    if (typeof selected !== "string") {
      return;
    }

    await setSelectedFolder(selected);
    setStoredFolderPath(selected);
    setSettingsOpen(false);
    router.push(`/browse/timeline?path=${encodeURIComponent(selected)}`);
  };

  const folderName = folderPath.split("/").pop() || folderPath;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      <Titlebar
        isLoading={false}
        onBack={() => setSettingsOpen(false)}
        backLabel="Back to notes"
      />

      <main className="mx-auto mt-9 w-full max-w-2xl flex-1 overflow-y-auto pt-7 pr-7 pb-6 pl-12">
        <h1 className="font-serif text-[32px] text-heading leading-[1.1] tracking-[-0.01em]">
          Settings
        </h1>

        <section className="mt-7 flex flex-col gap-3">
          <h2 className="font-serif text-[22px] text-heading leading-[1.2]">
            Notes folder
          </h2>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-foreground">{folderName}</span>
              <span className="truncate text-muted-foreground text-xs">
                {folderPath}
                {!isLoading && ` · ${files.length} files`}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={handleChangeFolder}>
              Change folder
            </Button>
          </div>
        </section>

        <section className="mt-7 flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-serif text-[22px] text-heading leading-[1.2]">
              Git repositories
            </h2>
            {connectedRepos.length > 0 && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                onClick={async () => await fetchRepos()}
                disabled={isFetching}
              >
                {isFetching ? "Fetching..." : "Fetch all"}
              </button>
            )}
          </div>
          <RepoConnector key={folderPath} markdownDirectory={folderPath} />
        </section>

        <AgentsSection folderPath={folderPath} />

        {appVersion && (
          <p className="mt-7 text-muted-foreground text-xs">
            stream {appVersion}
          </p>
        )}
      </main>
    </div>
  );
}

export default SettingsPage;
