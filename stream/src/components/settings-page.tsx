"use client";

import { Switch } from "@base-ui/react/switch";
import {
  ArrowSquareOutIcon,
  CheckIcon,
  CircleNotchIcon,
  CopyIcon,
  GithubLogoIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AgentLogo } from "@/components/agent-stack";
import { Footer } from "@/components/footer";
import RepoConnector from "@/components/repo-connector";
import { Titlebar } from "@/components/titlebar-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCopied } from "@/hooks/use-copied";
import {
  useConnectedRepos,
  useFetchRepos,
  useGitHubStatus,
  useRunningAgents,
} from "@/hooks/use-git-queries";
import { useMarkdownMetadata } from "@/hooks/use-markdown-queries";
import { useNotesSyncStatus } from "@/hooks/use-notes-sync";
import { useSkills } from "@/hooks/use-skills";
import { useSetSelectedFolder } from "@/hooks/use-user-data";
import { AGENT_NAMES, type AgentKind } from "@/ipc/agents";
import type { GitHubStatus, UnreadableRepo } from "@/ipc/git-reader";
import { SKILLS_DIR } from "@/ipc/skills";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/stores/user-store";

const AGENT_KINDS: AgentKind[] = ["claude", "codex"];

const GH_INSTALL_URL = "https://cli.github.com";

interface GitHubProblem {
  title: string;
  hint: string;
  command?: string;
  detail?: string;
  needsYou: boolean; // Outages and rate limits pass without you doing anything
}

function getGitHubProblem(
  status: Exclude<GitHubStatus, { state: "connected" }>,
): GitHubProblem {
  switch (status.state) {
    case "gh_missing":
      return {
        title: "GitHub CLI not found",
        hint: "Stream reads GitHub through gh. Install it, then recheck.",
        command: "brew install gh",
        needsYou: true,
      };
    case "logged_out":
      return {
        title: "Not signed in",
        hint: "gh has no GitHub account on this Mac. Sign in, then recheck.",
        command: "gh auth login",
        needsYou: true,
      };
    case "token_rejected":
      return {
        title: "Sign-in expired",
        hint: "GitHub rejected the token gh is using. Sign in again, then recheck.",
        command: "gh auth login",
        detail: status.detail,
        needsYou: true,
      };
    case "rate_limited":
      return {
        title: "Rate limit reached",
        hint: "GitHub has paused this account's requests. They resume within the hour.",
        detail: status.detail,
        needsYou: false,
      };
    case "unreachable":
      return {
        title: "Can't reach GitHub",
        hint: "Check your connection. Stream keeps trying in the background.",
        detail: status.detail,
        needsYou: false,
      };
    case "failed":
      return {
        title: "gh ran into a problem",
        hint: "This command shows what gh thinks is wrong.",
        command: "gh auth status",
        detail: status.detail,
        needsYou: true,
      };
  }
}

function getUnreadableReposProblem(
  unreadableRepos: UnreadableRepo[],
  needsRepoScope: boolean,
): GitHubProblem {
  if (needsRepoScope) {
    return {
      title: "Missing the repo scope",
      hint: "gh needs it to read private repositories. Add it, then recheck.",
      command: "gh auth refresh -s repo",
      needsYou: true,
    };
  }

  if (unreadableRepos.length === 1) {
    return {
      title: "Can't read 1 repository",
      hint: "Check that it still exists and that this account can see it.",
      needsYou: true,
    };
  }

  return {
    title: `Can't read ${unreadableRepos.length} repositories`,
    hint: "Check that they still exist and that this account can see them.",
    needsYou: true,
  };
}

function describeGitHubRepos(repoCount: number, connectedCount: number) {
  if (connectedCount === 0) {
    return "No repositories connected";
  }

  if (repoCount === connectedCount) {
    return repoCount === 1 ? "1 repository" : `${repoCount} repositories`;
  }

  return `${repoCount} of ${connectedCount} repositories on GitHub`;
}

function CopyableCommand({ command }: { command: string }) {
  const { copied, copy } = useCopied();
  const Icon = copied ? CheckIcon : CopyIcon;

  return (
    <div className="flex items-center justify-between gap-2 rounded-sm border border-well-rule bg-well px-2.5 py-1.5">
      <code className="truncate text-foreground text-xs">{command}</code>
      <button
        type="button"
        onClick={() => copy(command)}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        title={copied ? "Copied" : "Copy command"}
        aria-label={`Copy ${command}`}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function GitHubProblemRow({
  problem,
  children,
}: {
  problem: GitHubProblem;
  children?: React.ReactNode;
}) {
  const { title, hint, command, detail, needsYou } = problem;

  return (
    <div className="flex flex-col gap-2 border-border border-b py-2">
      <div className="flex items-center gap-2.5">
        <WarningCircleIcon
          className={cn(
            "size-4 shrink-0",
            needsYou ? "text-destructive" : "text-muted-foreground",
          )}
          weight="fill"
          aria-hidden="true"
        />
        <span className="text-foreground">{title}</span>
      </div>
      <div className="flex flex-col gap-2 pl-[26px]">
        <p className="text-muted-foreground text-xs">{hint}</p>
        {command && <CopyableCommand command={command} />}
        {children}
        {detail && (
          <code className="block break-words text-muted-foreground text-xs">
            {detail}
          </code>
        )}
      </div>
    </div>
  );
}

function GitHubSection({ folderPath }: { folderPath: string }) {
  const { status, isChecking, recheck } = useGitHubStatus(folderPath);
  const { data: connectedRepos = [] } = useConnectedRepos(folderPath);

  return (
    <section className="mt-7 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-[22px] text-heading leading-[1.2]">
          GitHub
        </h2>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          onClick={recheck}
          disabled={isChecking}
        >
          {isChecking ? "Checking..." : "Recheck"}
        </button>
      </div>
      <p className="text-muted-foreground text-xs">
        Pull requests and checks come through the GitHub CLI on this Mac, using
        whichever account gh is signed in to.
      </p>
      <div className="flex flex-col">
        {!status && (
          <div className="flex items-center gap-2.5 border-border border-b py-2 text-muted-foreground">
            <CircleNotchIcon
              className="size-4 shrink-0 motion-safe:animate-spin"
              aria-hidden="true"
            />
            Checking...
          </div>
        )}
        {status?.state === "connected" && (
          <>
            <div className="flex items-center gap-2.5 border-border border-b py-2">
              <GithubLogoIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="truncate text-foreground">
                Connected as {status.login}
              </span>
              <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                {describeGitHubRepos(status.repo_count, connectedRepos.length)}
              </span>
            </div>
            {(status.unreadable_repos.length > 0 ||
              status.needs_repo_scope) && (
              <GitHubProblemRow
                problem={getUnreadableReposProblem(
                  status.unreadable_repos,
                  status.needs_repo_scope,
                )}
              >
                {status.unreadable_repos.map(({ name, message }) => (
                  <div key={name} className="flex flex-col gap-0.5">
                    <span className="truncate text-foreground text-xs">
                      {name}
                    </span>
                    <span className="break-words text-muted-foreground text-xs">
                      {message}
                    </span>
                  </div>
                ))}
              </GitHubProblemRow>
            )}
          </>
        )}
        {status && status.state !== "connected" && (
          <GitHubProblemRow problem={getGitHubProblem(status)}>
            {status.state === "gh_missing" && (
              <button
                type="button"
                onClick={() => openUrl(GH_INSTALL_URL)}
                className="flex items-center gap-1 self-start text-muted-foreground text-xs hover:text-foreground"
              >
                Other ways to install
                <ArrowSquareOutIcon className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </GitHubProblemRow>
        )}
      </div>
    </section>
  );
}

function NotesSyncRow({ folderPath }: { folderPath: string }) {
  const autoSync = useUserStore((state) => state.autoSync);
  const setAutoSync = useUserStore((state) => state.setAutoSync);
  const { data: status } = useNotesSyncStatus(folderPath);

  if (!status) {
    return null;
  }

  let description =
    "Commit notes and push them about a minute after you stop typing. Pulls with rebase first, and only ever commits files in this folder.";
  if (!status.repo_root) {
    description = "Not a git repository.";
  } else if (!status.upstream) {
    description = `${status.branch ?? "This branch"} has no upstream, so there's nowhere to push.`;
  }

  return (
    <div className="flex items-start justify-between gap-3 border-border border-t pt-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-foreground">Sync with git</span>
        <span className="text-muted-foreground text-xs">{description}</span>
      </div>
      {status.repo_root && (
        <Switch.Root
          checked={autoSync}
          onCheckedChange={setAutoSync}
          aria-label="Sync notes with git automatically"
          className="mt-0.5 flex h-4 w-[30px] shrink-0 items-center rounded-[2px] bg-rail px-0.5 data-checked:bg-primary"
        >
          <Switch.Thumb className="size-3 rounded-[1px] bg-muted-foreground transition-transform data-checked:translate-x-3.5 data-checked:bg-background" />
        </Switch.Root>
      )}
    </div>
  );
}

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
          {AGENT_KINDS.map((kind) => (
            <div
              key={kind}
              className="flex items-center gap-2.5 border-border border-b py-2"
            >
              <AgentLogo
                kind={kind}
                size={16}
                cutoutClassName="stroke-background"
              />
              <span className="text-foreground">{AGENT_NAMES[kind]}</span>
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

function SkillsSection({ folderPath }: { folderPath: string }) {
  const skillAgent = useUserStore((state) => state.skillAgent);
  const skillModels = useUserStore((state) => state.skillModels);
  const setSkillAgent = useUserStore((state) => state.setSkillAgent);
  const setSkillModel = useUserStore((state) => state.setSkillModel);
  const { data: skills = [] } = useSkills(folderPath);

  return (
    <section className="mt-7 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-[22px] text-heading leading-[1.2]">
          Skills
        </h2>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => revealItemInDir(`${folderPath}/${SKILLS_DIR}`)}
        >
          Show folder
        </button>
      </div>
      <p className="text-muted-foreground text-xs">
        Type / in a note to run a skill. It starts a new thread in the
        background, told which note and line it came from. Nobody is there to
        approve anything, so it edits your notes and runs commands without
        asking. Add skills to the {SKILLS_DIR} folder as name.md or
        name/SKILL.md.
      </p>
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-3 border-border border-b py-2">
          <span className="text-foreground">Agent</span>
          <Select
            value={skillAgent}
            onValueChange={(agent) => agent && setSkillAgent(agent)}
          >
            <SelectTrigger size="sm" aria-label="Agent for skills">
              <SelectValue>
                {(agent: AgentKind) => AGENT_NAMES[agent]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="end">
              {AGENT_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {AGENT_NAMES[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3 border-border border-b py-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-foreground">Model</span>
            <span className="text-muted-foreground text-xs">
              Empty uses {AGENT_NAMES[skillAgent]}'s default
            </span>
          </div>
          <Input
            aria-label={`Model for ${AGENT_NAMES[skillAgent]}`}
            className="h-7 w-40"
            placeholder="Default"
            spellCheck={false}
            value={skillModels[skillAgent]}
            onChange={(event) => setSkillModel(skillAgent, event.target.value)}
          />
        </div>
        {skills.map((skill) => (
          <div
            key={skill.path}
            className="flex flex-col gap-0.5 border-border border-b py-2"
          >
            <span className="truncate text-foreground">/{skill.name}</span>
            {skill.description && (
              <span className="truncate text-muted-foreground text-xs">
                {skill.description}
              </span>
            )}
          </div>
        ))}
      </div>
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
          <NotesSyncRow folderPath={folderPath} />
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

        <GitHubSection folderPath={folderPath} />

        <AgentsSection folderPath={folderPath} />

        <SkillsSection folderPath={folderPath} />

        {appVersion && (
          <p className="mt-7 text-muted-foreground text-xs">
            stream {appVersion}
          </p>
        )}
      </main>

      {/* This page covers the timeline's footer, so it needs its own */}
      <Footer folderPath={folderPath} />
    </div>
  );
}

export default SettingsPage;
