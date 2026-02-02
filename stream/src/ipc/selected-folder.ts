import { load } from "@tauri-apps/plugin-store";

export const SELECTED_FOLDER_STORAGE_KEY = "stream-last-selected-folder";
const STORE_FILE = "settings.json";

export async function getSelectedFolder(): Promise<string | null> {
  try {
    const store = await load(STORE_FILE, {
      autoSave: true,
      defaults: {},
    });
    const savedFolder = await store.get<string>(SELECTED_FOLDER_STORAGE_KEY);
    return savedFolder || null;
  } catch (error) {
    console.warn("Failed to get selected folder:", error);
    return null;
  }
}

export async function setSelectedFolder(folderPath: string): Promise<void> {
  const store = await load(STORE_FILE, {
    autoSave: true,
    defaults: {},
  });
  await store.set(SELECTED_FOLDER_STORAGE_KEY, folderPath);
}

export async function clearSelectedFolder(): Promise<void> {
  const store = await load(STORE_FILE, {
    autoSave: true,
    defaults: {},
  });
  await store.delete(SELECTED_FOLDER_STORAGE_KEY);
}
