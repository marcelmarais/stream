import { invoke } from "@tauri-apps/api/core";

export type AgentKind = "claude" | "codex";

export type AgentStatus = "working" | "waiting";

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
