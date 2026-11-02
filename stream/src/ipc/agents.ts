import { invoke } from "@tauri-apps/api/core";

export type AgentKind = "claude" | "codex";

export type AgentStatus = "working" | "waiting" | "finished";

export const AGENT_NAMES: Record<AgentKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/**
 * TypeScript interface matching the Rust struct
 */
export interface RunningAgent {
  id: string;
  kind: AgentKind;
  status: AgentStatus;
  title: string | null;
  repo_path: string;
  branch: string | null;
  since: number | null; // Unix timestamp in milliseconds
  activity: string | null; // What it's doing now, or what it's waiting for
  chat: ChatLink | null;
  finished_at?: number; // Set by the app, when an agent leaves the running list
}

export interface ChatLink {
  target: string;
  app: string;
}

/**
 * List the Claude Code and Codex sessions working in these repositories
 */
export async function listRunningAgents(
  repoPaths: string[],
): Promise<RunningAgent[]> {
  return invoke("list_running_agents", { repoPaths });
}

/**
 * Bring an agent's chat to the front
 */
export async function openAgentChat(target: string): Promise<void> {
  return invoke("open_agent_chat", { target });
}
