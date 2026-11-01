import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CollapsedHeading } from "@/components/heading-fold";

/**
 * Collapsed headings per note. They live outside the editor because scrolling
 * unmounts it and focus mode opens a second one on the same file.
 */
interface CollapsedHeadingsState {
  byFile: Record<string, CollapsedHeading[]>;

  setCollapsedHeadings: (
    filePath: string,
    headings: CollapsedHeading[],
  ) => void;
}

export const useCollapsedHeadingsStore = create<CollapsedHeadingsState>()(
  persist(
    (set) => ({
      byFile: {},

      setCollapsedHeadings: (filePath, headings) =>
        set(({ byFile }) => {
          const { [filePath]: _previous, ...others } = byFile;

          return {
            byFile:
              headings.length > 0
                ? { ...others, [filePath]: headings }
                : others,
          };
        }),
    }),
    { name: "collapsed-headings" },
  ),
);
