import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

/**
 * Hook to follow whether the app window is focused. onChange runs on every
 * change, so callers can act on coming back without an effect of their own.
 */
export function useWindowFocus(onChange?: (isFocused: boolean) => void) {
  const [isFocused, setIsFocused] = useState(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let stopListening: (() => void) | undefined;
    let isCancelled = false;

    const startListening = async () => {
      const unlisten = await getCurrentWindow().onFocusChanged(
        ({ payload }) => {
          setIsFocused(payload);
          onChangeRef.current?.(payload);
        },
      );

      if (isCancelled) {
        unlisten();
      } else {
        stopListening = unlisten;
      }
    };

    try {
      void startListening().catch(() => {});
    } catch {
      // Browser previews do not expose the Tauri window API.
    }

    return () => {
      isCancelled = true;
      stopListening?.();
    };
  }, []);

  return isFocused;
}
