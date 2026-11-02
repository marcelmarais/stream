import { create } from "zustand";

const FINISHED_MS = 3000;

interface RunningSkill {
  id: number;
  label: string;
}

export interface AppUpdate {
  phase: "available" | "installing" | "restarting" | "failed";
  version: string;
}

/**
 * What the footer reports. It lives outside React because CodeMirror code
 * reports here too, and skills keep running while the editor unmounts.
 */
interface StatusState {
  failure: string | null; // Stays until it's replaced or dismissed
  finished: string | null;
  running: RunningSkill[];
  update: AppUpdate | null;

  showFailure: (text: string) => void;
  dismissFailure: () => void;
  startSkill: (label: string) => number;
  finishSkill: (id: number, text: string) => void;
  failSkill: (id: number, text: string) => void;
  setUpdate: (update: AppUpdate) => void;
}

let nextSkillId = 0;
let finishedTimer: ReturnType<typeof setTimeout> | undefined;

export const useStatusStore = create<StatusState>()((set) => {
  const withoutSkill = (running: RunningSkill[], id: number) =>
    running.filter((skill) => skill.id !== id);

  return {
    failure: null,
    finished: null,
    running: [],
    update: null,

    showFailure: (text) => set({ failure: text }),

    dismissFailure: () => set({ failure: null }),

    startSkill: (label) => {
      nextSkillId += 1;
      const id = nextSkillId;
      set(({ running }) => ({ running: [...running, { id, label }] }));
      return id;
    },

    finishSkill: (id, text) => {
      clearTimeout(finishedTimer);
      finishedTimer = setTimeout(() => set({ finished: null }), FINISHED_MS);
      set(({ running }) => ({
        finished: text,
        running: withoutSkill(running, id),
      }));
    },

    failSkill: (id, text) =>
      set(({ running }) => ({
        failure: text,
        running: withoutSkill(running, id),
      })),

    setUpdate: (update) => set({ update }),
  };
});
