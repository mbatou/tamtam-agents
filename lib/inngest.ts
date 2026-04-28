/**
 * Inngest client.
 *
 * Inngest owns ALL async work in this system: cron triggers for the COO,
 * agent runs, post-approval side effects. There are no `setTimeout` or
 * background promises anywhere — if a job is async, it goes through here.
 */

import { EventSchemas, Inngest } from "inngest";
import type { AppInngestEvent } from "@/types";

type EventMap = {
  [E in AppInngestEvent as E["name"]]: { data: E["data"] };
};

export const inngest = new Inngest({
  id: "tamtam-agents",
  schemas: new EventSchemas().fromRecord<EventMap>(),
});

export type AppInngest = typeof inngest;
