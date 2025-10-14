import { useEffect } from "react";
import { useApiKeyStore } from "@/stores/api-key-store";

/**
 * Hook to access and manage the API key state
 * This wraps the Zustand store and ensures the API key is loaded on mount
 */
export function useApiKey() {
  const { apiKey, isLoading, isSaving, loadApiKey, setApiKey, removeApiKey } =
    useApiKeyStore();

  // Load API key on first mount
  useEffect(() => {
    if (isLoading && apiKey === null) {
      loadApiKey();
    }
  }, [isLoading, apiKey, loadApiKey]);

  return {
    apiKey,
    isLoading,
    isSaving,
    setApiKey,
    removeApiKey,
  };
}
