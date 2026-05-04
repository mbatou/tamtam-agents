import type { AgentName } from "@/types";

interface AgentMeta {
  emoji: string;
  name: string;
  bg: string;
  text: string;
  border: string;
}

const META: Record<AgentName, AgentMeta> = {
  social: {
    emoji: "🎨",
    name: "Awa",
    bg: "bg-dakar-orange/15",
    text: "text-dakar-orange",
    border: "border-dakar-orange/40",
  },
  growth: {
    emoji: "📈",
    name: "Kofi",
    bg: "bg-dakar-teal/15",
    text: "text-dakar-teal",
    border: "border-dakar-teal/40",
  },
  coo: {
    emoji: "🧠",
    name: "Rama",
    bg: "bg-dakar-purple/15",
    text: "text-dakar-purple",
    border: "border-dakar-purple/40",
  },
};

export function AgentBadge({
  agent,
  withName = true,
}: {
  agent: AgentName;
  withName?: boolean;
}): JSX.Element {
  const m = META[agent];
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium " +
        `${m.bg} ${m.text} ${m.border}`
      }
    >
      <span>{m.emoji}</span>
      {withName && <span>{m.name}</span>}
    </span>
  );
}

export function getAgentMeta(agent: AgentName): AgentMeta {
  return META[agent];
}
