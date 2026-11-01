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
}

/**
 * List the Claude Code and Codex sessions working in these repositories
 */
export async function listRunningAgents(
  repoPaths: string[],
): Promise<RunningAgent[]> {
  return invoke("list_running_agents", { repoPaths });
}
