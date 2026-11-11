import { invoke } from "@tauri-apps/api/core";
import type { AgentKind } from "@/ipc/agents";

export const SKILLS_DIR = "Skills";

/**
 * TypeScript interface matching the Rust struct
 */
export interface Skill {
  name: string;
  description: string | null;
  path: string;
}

/**
 * Which agent gets the skill, and where in the notes it was picked
 */
export interface SkillRun {
  agent: AgentKind;
  model: string | null;
  skillName: string;
  folderPath: string;
  skillPath: string;
  notePath: string;
  line: number;
  heading: string | null;
  text: string | null;
  githubAccount: string | null; // The agent's gh runs as this account
}

/**
 * List the skills in the notes folder, creating the Skills folder if needed
 */
export async function listSkills(folderPath: string): Promise<Skill[]> {
  return invoke("list_skills", { folderPath });
}

/**
 * Run a skill in a new thread in the background. Resolves when the thread
 * finishes, and rejects if it fails.
 */
export async function startSkillThread(run: SkillRun): Promise<void> {
  return invoke("start_skill_thread", { run });
}
