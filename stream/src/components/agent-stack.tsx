"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import {
  AnimatePresence,
  motion,
  useAnimate,
  useReducedMotion,
} from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AGENT_NAMES,
  type AgentKind,
  type AgentStatus,
  openAgentChat,
  type RunningAgent,
} from "@/ipc/agents";
import { cn } from "@/lib/utils";
import { useStatusStore } from "@/stores/status-store";

const VISIBLE_AGENTS = 3;
const BADGE_WIDTH = 18;
const BADGE_OVERLAP = 4;
const OVERFLOW_COUNT_WIDTH = 20;
const FINISHED_OPACITY = 0.5;

// Long enough to move the pointer from a logo onto its tooltip
export const TOOLTIP_CLOSE_DELAY_MS = 150;

// Most urgent first, so a finished agent never hides one that needs you
const STATUS_ORDER: AgentStatus[] = ["waiting", "working", "finished"];

// A running logo stops after this many gestures and rests until the next turn
const GESTURES_PER_TURN = 5;
const GESTURES_WHILE_WAITING = 1;

// Gaps stretch after each gesture, so a logo slows down rather than cutting out
const FIRST_GESTURE_DELAY_MS: [number, number] = [500, 1600];
const GESTURE_GAP_MS: [number, number] = [4000, 7000];
const GESTURE_GAP_GROWTH = 1.5;

// Claude's rays and Codex's lobes both land back on the same silhouette
const TURN_STEP: Record<AgentKind, number> = { claude: 30, codex: 360 / 7 };

const AGENT_COLORS: Record<AgentKind, string> = {
  claude: "fill-agent-claude",
  codex: "fill-agent-codex",
};

// Survives remounts: the timeline unmounts days as they scroll away, and
// scrolling back shouldn't restart the motion
const gesturesPlayed = new Map<string, number>();

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function burstPath(): string {
  const reach = [10.8, 8.6, 10.2, 9, 11, 8.4, 10.6, 9.2, 10.6, 8.6, 10.2, 9.4];

  return reach
    .map((length, index) => {
      const angle = (index / reach.length) * Math.PI * 2 + 0.18;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const point = (along: number, across: number) =>
        `${(12 + cos * along - sin * across).toFixed(2)} ${(12 + sin * along + cos * across).toFixed(2)}`;
      return `M${point(0, 1.15)}L${point(length, 0.42)}L${point(length, -0.42)}L${point(0, -1.15)}Z`;
    })
    .join("");
}

function cloudPath(): string {
  const lobes = 7;
  const point = (index: number) => {
    const angle = -Math.PI / 2 + ((index + 0.5) / lobes) * Math.PI * 2;
    return `${(12 + Math.cos(angle) * 8.5).toFixed(2)} ${(12 + Math.sin(angle) * 8.5).toFixed(2)}`;
  };

  let path = `M${point(0)}`;
  for (let index = 1; index <= lobes; index += 1) {
    path += `A3.8 3.8 0 0 1 ${point(index)}`;
  }
  return `${path}Z`;
}

const LOGO_PATHS: Record<AgentKind, string> = {
  claude: burstPath(),
  codex: cloudPath(),
};

export function AgentLogo({
  kind,
  size,
  cutoutClassName = "stroke-well",
}: {
  kind: AgentKind;
  size: number;
  cutoutClassName?: string;
}) {
  return (
    <span
      data-agent-logo
      className="relative block origin-bottom"
      style={{ width: size, height: size }}
    >
      <span data-agent-turn className="absolute inset-0">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-full overflow-visible"
        >
          <path d={LOGO_PATHS[kind]} className={AGENT_COLORS[kind]} />
        </svg>
      </span>
      {kind === "codex" && (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("absolute inset-0 size-full", cutoutClassName)}
        >
          <path d="M8.2 8.6l3.1 3.4-3.1 3.4" />
          <path data-agent-cursor d="M13.2 15.6h3.6" />
        </svg>
      )}
    </span>
  );
}

function AgentMark({
  agent,
  moving,
  size,
}: {
  agent: RunningAgent;
  moving: boolean;
  size: number;
}) {
  const { kind, status } = agent;
  const turnKey = `${agent.id}:${status}:${agent.since}`;
  const prefersReducedMotion = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  const [isNew] = useState(() => !gesturesPlayed.has(turnKey));
  const turn = useRef(0);
  const isPlaying = useRef(false);

  // One small gesture: crouch, hop, land, settle. The turn is a loose spring
  // so it overshoots a little, and the sizes vary so no two look the same.
  const playGesture = useCallback(async () => {
    if (isPlaying.current || prefersReducedMotion) {
      return;
    }
    isPlaying.current = true;

    const height = randomBetween(2, 3.4);
    turn.current += TURN_STEP[kind] * (Math.random() < 0.25 ? 2 : 1);

    const moves = [
      animate(
        "[data-agent-turn]",
        { rotate: turn.current },
        { type: "spring", stiffness: 110, damping: 10, mass: 0.9, delay: 0.08 },
      ),
    ];

    if (Math.random() < 0.7) {
      moves.push(
        animate(
          "[data-agent-logo]",
          {
            y: [0, 0.5, -height, 0, -height * 0.22, 0],
            scaleX: [1, 1.07, 0.95, 1.06, 0.99, 1],
            scaleY: [1, 0.9, 1.07, 0.93, 1.02, 1],
          },
          {
            duration: 0.7,
            times: [0, 0.16, 0.42, 0.66, 0.84, 1],
            ease: ["easeOut", "easeOut", "easeIn", "easeOut", "easeIn"],
          },
        ),
      );
    }

    if (kind === "codex") {
      moves.push(
        animate(
          "[data-agent-cursor]",
          { opacity: [1, 0, 0, 1, 1, 0, 0, 1] },
          { duration: 0.9, ease: "linear" },
        ),
      );
    }

    await Promise.all(moves);
    isPlaying.current = false;
  }, [animate, kind, prefersReducedMotion]);

  useEffect(() => {
    if (!gesturesPlayed.has(turnKey)) {
      gesturesPlayed.set(turnKey, 0);
    }
  }, [turnKey]);

  useEffect(() => {
    if (!moving || prefersReducedMotion || status === "finished") {
      return;
    }

    const budget =
      status === "waiting" ? GESTURES_WHILE_WAITING : GESTURES_PER_TURN;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const played = gesturesPlayed.get(turnKey) ?? 0;
      if (played >= budget) {
        return;
      }

      // A hidden window keeps its gestures for when it's seen again
      if (!document.hidden) {
        gesturesPlayed.set(turnKey, played + 1);
        playGesture();
      }

      const stretch = GESTURE_GAP_GROWTH ** played;
      timer = setTimeout(tick, randomBetween(...GESTURE_GAP_MS) * stretch);
    };

    timer = setTimeout(tick, randomBetween(...FIRST_GESTURE_DELAY_MS));
    return () => clearTimeout(timer);
  }, [moving, playGesture, prefersReducedMotion, status, turnKey]);

  return (
    <motion.span
      ref={scope}
      onPointerEnter={playGesture}
      initial={isNew ? { opacity: 0, scale: 0.5, y: 3 } : false}
      animate={{
        opacity: status === "finished" ? FINISHED_OPACITY : 1,
        scale: 1,
        y: 0,
      }}
      exit={{ opacity: 0, scale: 0.7 }}
      transition={{ type: "spring", stiffness: 380, damping: 20 }}
      className="relative block"
    >
      <AgentLogo kind={kind} size={size} />
      {status === "waiting" && (
        <motion.span
          aria-hidden="true"
          initial={prefersReducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: [0, 1, 0.35, 1, 0.35, 1] }}
          transition={{ duration: 2.6, ease: "easeInOut" }}
          className="-top-px -right-0.5 absolute size-[5px] rounded-full bg-primary"
        />
      )}
    </motion.span>
  );
}

function formatElapsed(since: number): string {
  const minutes = Math.floor((Date.now() - since) / 60000);

  if (minutes < 1) {
    return "<1m";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function getWaitingLabel(activity: string | null): string {
  return activity ? `Waiting for you: ${activity}` : "Waiting for you";
}

function AgentProgress({ agent }: { agent: RunningAgent }) {
  const { activity, since, status } = agent;

  if (status === "finished") {
    return <span className="text-muted-foreground">Finished</span>;
  }
  if (status === "waiting") {
    return <span className="text-primary">{getWaitingLabel(activity)}</span>;
  }

  return (
    <span className="flex items-baseline justify-between gap-4">
      <span className="min-w-0 truncate text-shimmer">
        {activity ?? "Working"}
      </span>
      {since && (
        <span className="shrink-0 text-faint">{formatElapsed(since)}</span>
      )}
    </span>
  );
}

function AgentBadge({
  agent,
  moving,
  size,
}: {
  agent: RunningAgent;
  moving: boolean;
  size: number;
}) {
  const { chat } = agent;

  const openChat = async () => {
    if (!chat) {
      return;
    }
    try {
      await openAgentChat(chat.target);
    } catch (error) {
      console.error("Failed to open agent chat:", error);
      useStatusStore.getState().showFailure(`Couldn't open ${chat.app}`);
    }
  };

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        aria-label={`${AGENT_NAMES[agent.kind]}: ${agent.title ?? "Untitled chat"}`}
        onClick={openChat}
        className={cn(
          "not-first:-ml-1 flex h-[22px] w-[18px] items-center justify-center",
          chat && "cursor-pointer",
        )}
      >
        <AgentMark agent={agent} moving={moving} size={size} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner
          side="bottom"
          align="start"
          sideOffset={4}
          className="isolate z-[70]"
        >
          <Tooltip.Popup
            onClick={openChat}
            className={cn(
              "flex w-[280px] flex-col gap-1 rounded-[5px] border border-well-rule bg-popover px-2.5 py-2 font-mono text-meta leading-[1.45] shadow-black/30 shadow-lg",
              chat && "cursor-pointer",
            )}
          >
            <span className="font-medium text-foreground">
              {agent.title ?? "Untitled chat"}
            </span>
            <AgentProgress agent={agent} />
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function getAgentStackWidth(agentCount: number): number {
  const badges = Math.min(agentCount, VISIBLE_AGENTS);
  const overflow = agentCount > VISIBLE_AGENTS ? OVERFLOW_COUNT_WIDTH : 0;
  return badges * (BADGE_WIDTH - BADGE_OVERLAP) + BADGE_OVERLAP + overflow;
}

/**
 * The agents working in a repo or branch. Only one stack should be `moving`
 * for an agent at a time, so opening a repo hands its motion down to the branch.
 */
export function AgentStack({
  agents,
  moving = true,
  size,
  className,
}: {
  agents: RunningAgent[];
  moving?: boolean;
  size: number;
  className?: string;
}) {
  const byUrgency = [...agents].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  );
  const hidden = agents.length - VISIBLE_AGENTS;

  return (
    <Tooltip.Provider delay={150} closeDelay={TOOLTIP_CLOSE_DELAY_MS}>
      <span className={cn("inline-flex items-center", className)}>
        <AnimatePresence>
          {byUrgency.slice(0, VISIBLE_AGENTS).map((agent) => (
            <AgentBadge
              key={agent.id}
              agent={agent}
              moving={moving}
              size={size}
            />
          ))}
        </AnimatePresence>
        {hidden > 0 && (
          <span className="ml-[3px] font-normal text-muted-foreground">
            +{hidden}
          </span>
        )}
      </span>
    </Tooltip.Provider>
  );
}
