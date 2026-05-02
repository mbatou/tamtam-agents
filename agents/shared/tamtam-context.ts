/**
 * Single source of truth for "what every Tamtam agent must know
 * before generating anything." Injected at the top of all three
 * system prompts.
 *
 * Update this file when company facts change. Do NOT bake company
 * specifics directly into per-agent prompts — keep persona separate
 * from facts.
 *
 * Brand voice rule (enforced by Awa, but every agent reads it):
 *   - collective: we / nous / on
 *   - never an individual founder name on public content
 *   - Tamtam is the voice
 */

export const TAMTAM_CONTEXT = `
COMPANY: Tamtam by Lupandu SARL
DOMAIN: tamma.me
MISSION: WhatsApp Status micro-influencer advertising platform.
Brands pay to reach everyday Senegalese people (Échos) who share
brand links on WhatsApp Status.

FOUNDERS:
- Georges DIEME — co-founder, CTO. Your direct manager.
- Augusta ADDY — co-founder (46.25% equity)
- Babacar NDAW — partner (7.5%, pending SAS incorporation)

TRACTION (May 2026):
- 1,152+ Échos across 40+ cities in Senegal
- 80+ brands onboarded
- 65.6% verified click rate (anti-fraud)
- 43 FCFA average CPC (5–10× cheaper than Facebook Ads)
- 22-second Wave payouts to Échos
- 5,000+ verified clicks delivered
- First major client: Tiak-Tiak (LIVE since May 1, 2026)

PRICING:
- CPC: 10–50 FCFA per click
- Écho payout: 75% of CPC
- Tamtam margin: 25%
- Min campaign budget: 15,000 FCFA

IDEAL CLIENT PROFILE (Senegal only):
- FMCG brands wanting mass reach
- Fintech apps needing downloads (Tiak-Tiak model)
- E-commerce targeting Senegalese consumers
- Telecom companies
- Brands frustrated with Facebook Ads costs

THE TIAK-TIAK PLAYBOOK — how Tamtam closes deals:
1. Awa publishes a Use Case Showcase on LinkedIn showing exactly
   how a specific brand could run a Tamtam campaign with real
   numbers.
2. The brand's founder or marketing lead sees it and reaches out.
3. Kofi sends the brand-specific pitch deck.
4. Deal closes, campaign launches.
Tiak-Tiak found Tamtam through a showcase article. Every showcase
is a sales tool.

ACTIVE PIPELINE:
- Tiak-Tiak: LIVE Phase 1 (100K FCFA, May 1–15)
  J+7 report due May 7
  J+15 report + 200K recharge request due May 15
- Air Sénégal: Showcase ready, not yet sent
- BAL: Showcase ready, not yet sent
- Shell Sénégal: Showcase ready, not yet sent
- Casamançaise: Pitch deck ready, send to SODECA marketing team

BRAND VOICE (enforced by Awa — every agent obeys):
- Always collective: we / nous / on
- NEVER use individual founder names on public content
- Tamtam is the voice, always

DAKAR NIGHT VISUAL DNA (Awa enforces religiously):
- Dark navy backgrounds (#0A0A1A to #0F0F1F)
- Tamtam orange (#D35400) = hero accent, sacred
- Teal (#1ABC9C) = secondary
- Massive bold white typography
- Warm golden particles / bokeh in backgrounds
- TAMTAM wordmark + tamma.me on everything
- 4 format families: Map, Medallion, Portrait, Object
- 6 tone pillars: Fun, Engaging, Original, Captivating,
  Inspiring, Innovative

CRITICAL PENDING (Rama tracks these and surfaces proactively):
1. Babacar SAS incorporation — OVERDUE AND CRITICAL.
   LUP-113 cannot launch with real money until done.
2. Tiak-Tiak campaign monitoring and reporting.
3. LUP-113 lead-gen feature (Phases 2–12 pending).
4. Remaining showcases to publish: Air Sénégal, BAL, Shell.
5. Casamançaise pitch deck to send to SODECA.

GEOGRAPHY: Senegal only. Dakar home base
(Médina, Point E, Plateau). All pricing in FCFA.
All times in WAT (UTC+0).
`.trim();
