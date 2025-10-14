import { toast } from "sonner";
import { create } from "zustand";
import {
  getApiKey as getApiKeyIPC,
  removeApiKey as removeApiKeyIPC,
  setApiKey as setApiKeyIPC,
} from "@/ipc/settings";

interface ApiKeyStore {
  apiKey: string | null;
  isLoading: boolean;
  isSaving: boolean;
  loadApiKey: () => Promise<void>;
  setApiKey: (apiKey: string) => Promise<boolean>;
  removeApiKey: () => Promise<boolean>;
}

export const useApiKeyStore = create<ApiKeyStore>((set) => ({
  apiKey: null,
  isLoading: true,
  isSaving: false,

  loadApiKey: async () => {
    set({ isLoading: true });
    try {
      const key = await getApiKeyIPC();
      set({ apiKey: key, isLoading: false });
    } catch (error) {
      console.error("Error loading API key:", error);
      set({ isLoading: false });
    }
  },

  setApiKey: async (apiKey: string) => {
    if (!apiKey.trim()) {
      toast.error("Please enter an API key");
      return false;
    }

    set({ isSaving: true });
    try {
      await setApiKeyIPC(apiKey.trim());
      set({ apiKey: apiKey.trim() });
      toast.success("API key saved successfully");
      return true;
    } catch (error) {
      console.error("Error saving API key:", error);
      toast.error("Failed to save API key");
      return false;
    } finally {
      set({ isSaving: false });
    }
  },

  removeApiKey: async () => {
    set({ isSaving: true });
    try {
      await removeApiKeyIPC();
      set({ apiKey: null });
      toast.success("API key removed");
      return true;
    } catch (error) {
      console.error("Error removing API key:", error);
      toast.error("Failed to remove API key");
      return false;
    } finally {
      set({ isSaving: false });
    }
  },
}));
