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
import { type ComponentProps, type ReactNode, useEffect } from "react";
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

const ROW = "flex min-h-11 items-center gap-3 border-border border-b py-2.5";
const LABEL = "font-sans text-[14px] text-foreground";
const HINT = "font-sans text-[12.5px] text-muted-foreground leading-normal";
const VALUE = "shrink-0 text-meta text-muted-foreground";

function SettingsSection({
  title,
  action,
  description,
  children,
}: {
  title: string;
  action?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="mt-11 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-[21px] text-heading leading-[1.25] tracking-[-0.01em]">
          {title}
        </h2>
        {action}
      </div>
      {description && (
        <p className="max-w-[58ch] font-sans text-muted-foreground text-prose">
          {description}
        </p>
      )}
      {children && <div className="mt-2 flex flex-col">{children}</div>}
    </section>
  );
}

function SectionAction({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "shrink-0 text-meta text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Toggle({
  className,
  ...props
}: Omit<ComponentProps<typeof Switch.Root>, "className"> & {
  className?: string;
}) {
  return (
    <Switch.Root
      className={cn(
        "flex h-[18px] w-8 shrink-0 items-center rounded-[5px] bg-rail p-0.5 transition-colors duration-150 data-checked:bg-primary",
        className,
      )}
      {...props}
    >
      <Switch.Thumb className="size-3.5 rounded-[3px] bg-muted-foreground transition-transform duration-150 data-checked:translate-x-3.5 data-checked:bg-primary-foreground" />
    </Switch.Root>
  );
}

function CopyableCommand({ command }: { command: string }) {
  const { copied, copy } = useCopied();
  const Icon = copied ? CheckIcon : CopyIcon;

  return (
    <div className="flex items-center justify-between gap-2 rounded-[5px] border border-well-rule bg-well px-3 py-2">
      <code className="truncate text-foreground text-xs">{command}</code>
      <button
        type="button"
        onClick={() => copy(command)}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
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
    <div className="flex flex-col gap-2 border-border border-b py-3">
      <div className="flex items-center gap-2.5">
        <WarningCircleIcon
          className={cn(
            "size-4 shrink-0",
            needsYou ? "text-destructive" : "text-muted-foreground",
          )}
          weight="fill"
          aria-hidden="true"
        />
        <span className={LABEL}>{title}</span>
      </div>
      <div className="flex flex-col gap-2 pl-[26px]">
        <p className={HINT}>{hint}</p>
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
    <SettingsSection
      title="GitHub"
      action={
        <SectionAction onClick={recheck} disabled={isChecking}>
          {isChecking ? "checking…" : "recheck"}
        </SectionAction>
      }
      description="Pull requests and checks come through the GitHub CLI on this Mac, using whichever account gh is signed in to."
    >
      {!status && (
        <div className={cn(ROW, "text-muted-foreground")}>
          <CircleNotchIcon
            className="size-4 shrink-0 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Checking...
        </div>
      )}
      {status?.state === "connected" && (
        <>
          <div className={ROW}>
            <GithubLogoIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className={cn(LABEL, "truncate")}>
              Connected as{" "}
              <span className="font-mono text-[13px]">{status.login}</span>
            </span>
            <span className={cn(VALUE, "ml-auto")}>
              {describeGitHubRepos(status.repo_count, connectedRepos.length)}
            </span>
          </div>
          {(status.unreadable_repos.length > 0 || status.needs_repo_scope) && (
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
                  <span className={cn(HINT, "break-words")}>{message}</span>
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
              className="flex items-center gap-1 self-start text-meta text-muted-foreground transition-colors hover:text-foreground"
            >
              Other ways to install
              <ArrowSquareOutIcon className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </GitHubProblemRow>
      )}
    </SettingsSection>
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
    <div className={cn(ROW, "items-start justify-between gap-6 py-3")}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={LABEL}>Sync with git</span>
        <span className={cn(HINT, "max-w-[52ch]")}>{description}</span>
      </div>
      {status.repo_root && (
        <Toggle
          checked={autoSync}
          onCheckedChange={setAutoSync}
          aria-label="Sync notes with git automatically"
          className="mt-0.5"
        />
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
    return running > 0 ? `${running} running` : "none running";
  };

  return (
    <SettingsSection
      title="Agents"
      action={
        <Toggle
          checked={agentsEnabled}
          onCheckedChange={setAgentsEnabled}
          aria-label="Show running agents"
        />
      }
      description="Show agents running in your repositories on today's note. Stream only reads session files on this Mac."
    >
      {agentsEnabled &&
        AGENT_KINDS.map((kind) => (
          <div key={kind} className={ROW}>
            <AgentLogo
              kind={kind}
              size={16}
              cutoutClassName="stroke-background"
            />
            <span className={LABEL}>{AGENT_NAMES[kind]}</span>
            <span className={cn(VALUE, "ml-auto")}>{getStatus(kind)}</span>
          </div>
        ))}
    </SettingsSection>
  );
}

function SkillsSection({ folderPath }: { folderPath: string }) {
  const skillAgent = useUserStore((state) => state.skillAgent);
  const skillModels = useUserStore((state) => state.skillModels);
  const setSkillAgent = useUserStore((state) => state.setSkillAgent);
  const setSkillModel = useUserStore((state) => state.setSkillModel);
  const { data: skills = [] } = useSkills(folderPath);

  return (
    <SettingsSection
      title="Skills"
      action={
        <SectionAction
          onClick={() => revealItemInDir(`${folderPath}/${SKILLS_DIR}`)}
        >
          show folder
        </SectionAction>
      }
      description={
        <>
          Type <kbd className="font-mono text-[12.5px] text-foreground">/</kbd>{" "}
          in a note to run a skill. It starts a new thread in the background,
          told which note and line it came from. Nobody is there to approve
          anything, so it edits your notes and runs commands without asking. Add
          skills to the{" "}
          <code className="font-mono text-[12.5px] text-foreground">
            {SKILLS_DIR}
          </code>{" "}
          folder as name.md or name/SKILL.md.
        </>
      }
    >
      <div className={cn(ROW, "justify-between")}>
        <span className={LABEL}>Agent</span>
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
      <div className={cn(ROW, "justify-between")}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={LABEL}>Model</span>
          <span className={HINT}>
            Empty uses {AGENT_NAMES[skillAgent]}'s default
          </span>
        </div>
        <Input
          aria-label={`Model for ${AGENT_NAMES[skillAgent]}`}
          className="h-7 w-40 rounded-[5px]"
          placeholder="default"
          spellCheck={false}
          value={skillModels[skillAgent]}
          onChange={(event) => setSkillModel(skillAgent, event.target.value)}
        />
      </div>
      {skills.map((skill) => (
        <div
          key={skill.path}
          className={cn(ROW, "flex-col items-start gap-0.5")}
        >
          <span className="truncate font-mono text-[12.5px] text-foreground">
            /{skill.name}
          </span>
          {skill.description && (
            <span className={cn(HINT, "w-full truncate")}>
              {skill.description}
            </span>
          )}
        </div>
      ))}
    </SettingsSection>
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

      <main className="mx-auto mt-9 w-full max-w-2xl flex-1 overflow-y-auto pt-9 pr-7 pb-16 pl-12 [mask-image:linear-gradient(to_bottom,#000_calc(100%-32px),transparent)]">
        <h1 className="text-(length:--day-title-size) font-serif text-heading leading-[1.15] tracking-[-0.018em]">
          Settings
        </h1>

        <SettingsSection title="Notes folder">
          <div className={cn(ROW, "justify-between gap-6 border-t")}>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={cn(LABEL, "truncate")}>{folderName}</span>
              <span className="truncate text-meta text-muted-foreground">
                {folderPath}
                {!isLoading && ` · ${files.length} notes`}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={handleChangeFolder}>
              Change folder
            </Button>
          </div>
          <NotesSyncRow folderPath={folderPath} />
        </SettingsSection>

        <SettingsSection
          title="Git repositories"
          action={
            connectedRepos.length > 0 && (
              <SectionAction
                onClick={async () => await fetchRepos()}
                disabled={isFetching}
              >
                {isFetching ? "fetching…" : "fetch all"}
              </SectionAction>
            )
          }
          description="Connect the repositories you work in. Each day lists what you committed, grouped by repo and branch."
        >
          <RepoConnector key={folderPath} markdownDirectory={folderPath} />
        </SettingsSection>

        <GitHubSection folderPath={folderPath} />

        <AgentsSection folderPath={folderPath} />

        <SkillsSection folderPath={folderPath} />

        {appVersion && (
          <p className="mt-12 text-faint text-meta">stream {appVersion}</p>
        )}
      </main>

      {/* This page covers the timeline's footer, so it needs its own */}
      <Footer folderPath={folderPath} />
    </div>
  );
}

export default SettingsPage;
