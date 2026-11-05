import { invoke } from "@tauri-apps/api/core";

/** Matches NotesSyncStatus in src-tauri/src/ipc/notes_sync.rs */
export interface NotesSyncStatus {
  repo_root: string | null; // Null when the notes folder isn't in a repo
  branch: string | null; // Null when detached
  upstream: string | null;
  changed: number; // Uncommitted changes under the notes folder
  ahead: number;
  behind: number;
  busy: boolean; // A rebase or merge is in progress
}

export interface NotesSyncResult {
  committed: boolean;
  pulled: boolean;
  pushed: boolean;
}

export function getNotesSyncStatus(
  folderPath: string,
): Promise<NotesSyncStatus> {
  return invoke("get_notes_sync_status", { folderPath });
}

/** Commits the notes, pulls with rebase, then pushes. */
export function syncNotes(folderPath: string): Promise<NotesSyncResult> {
  return invoke("sync_notes", { folderPath });
}
