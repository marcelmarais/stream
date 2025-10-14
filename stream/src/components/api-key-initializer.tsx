"use client";

import { useEffect } from "react";
import { useApiKeyStore } from "@/stores/api-key-store";

/**
 * Component to initialize the API key on app startup
 */
export function ApiKeyInitializer() {
  useEffect(() => {
    useApiKeyStore.getState().loadApiKey();
  }, []);

  return null;
}
