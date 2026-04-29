/**
 * Inngest function: smoke-test the inter-agent reactions chain.
 *
 * Triggered by `tamtam/team.test-reactions` (typed by Georges as
 * "trigger reactions" in #tamtam-team). Fires mock versions of the
 * four reaction-trigger events so each handler in team-reactions.ts
 * runs end-to-end without needing a real post / lead / approval.
 *
 * Each event lands as a separate Inngest run, so you'll see four
 * lines in the Inngest dashboard (one per reaction) and four
 * corresponding messages in #tamtam-team within seconds.
 */

import { inngest } from "@/lib/inngest";
import { logAgentAction } from "@/lib/supabase";
import type { ApprovalPayloadLinkedinPost } from "@/types";

export const teamTestReactions = inngest.createFunction(
  {
    id: "team-test-reactions",
    name: "Smoke-test all team reactions with mock events",
  },
  { event: "tamtam/team.test-reactions" },
  async ({ step }) => {
    return step.run("fan-out-mock-events", async () => {
      const ts = Date.now();

      const mockPost: ApprovalPayloadLinkedinPost = {
        kind: "linkedin_post",
        post_id: `mock-post-${ts}`,
        caption:
          "Mock caption for reaction test. WhatsApp Status reaches " +
          "neighbourhoods Instagram doesn't. That's the whole pitch.",
        image_url: null,
        image_prompt: null,
      };

      await Promise.all([
        inngest.send({
          name: "tamtam/post.published",
          data: {
            post_id: mockPost.post_id,
            external_post_id: `mock-li-${ts}`,
            caption: mockPost.caption,
          },
        }),
        inngest.send({
          name: "tamtam/lead.researched",
          data: {
            lead_id: `mock-lead-${ts}`,
            company: "TestCo Senegal",
            notes:
              "Mock lead for reaction test. Consumer fintech, Dakar. " +
              "Active on Instagram with mid-tier influencers.",
          },
        }),
        inngest.send({
          name: "tamtam/approval.granted",
          data: {
            approval_id: `mock-approval-${ts}`,
            agent: "social",
            type: "linkedin_post",
            payload: mockPost,
          },
        }),
        inngest.send({
          name: "tamtam/approval.rejected",
          data: {
            approval_id: `mock-approval-rejected-${ts}`,
            agent: "growth",
            type: "outreach_email",
          },
        }),
      ]);

      await logAgentAction({
        agent: "coo",
        action: "team.test_reactions.fanned_out",
        metadata: { mock_ts: ts, count: 4 },
        status: "completed",
      });

      return { fanned_out: 4 };
    });
  },
);
