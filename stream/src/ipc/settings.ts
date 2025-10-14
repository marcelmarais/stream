import { Store } from "@tauri-apps/plugin-store";

// Store instance for settings
let store: Store | null = null;

/**
 * Initialize the settings store
 */
async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load("settings.json");
  }
  return store;
}

const GEMINI_API_KEY = "gemini_api_key";

/**
 * Get the stored Google Gemini API key
 */
export async function getApiKey(): Promise<string | null> {
  try {
    const s = await getStore();
    const key = await s.get<string>(GEMINI_API_KEY);
    return key || null;
  } catch (error) {
    console.error("Error getting API key:", error);
    return null;
  }
}

/**
 * Save the Google Gemini API key
 */
export async function setApiKey(apiKey: string): Promise<void> {
  try {
    const s = await getStore();
    await s.set(GEMINI_API_KEY, apiKey);
    await s.save();
  } catch (error) {
    console.error("Error saving API key:", error);
    throw new Error("Failed to save API key");
  }
}

/**
 * Remove the stored API key
 */
export async function removeApiKey(): Promise<void> {
  try {
    const s = await getStore();
    await s.delete(GEMINI_API_KEY);
    await s.save();
  } catch (error) {
    console.error("Error removing API key:", error);
    throw new Error("Failed to remove API key");
  }
}

/**
 * Check if an API key is configured
 */
export async function hasApiKey(): Promise<boolean> {
  const key = await getApiKey();
  return Boolean(key && key.trim().length > 0);
}
