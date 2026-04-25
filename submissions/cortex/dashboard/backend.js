// Mock backend for Atlas. No em dashes anywhere.

const Backend = (() => {
  const employee = {
    first_name: "Marcus",
    full_name: "MARCUS CHEN",
    role_team: "ENGINEERING, PLATFORM",
    timezone_label: "EDT",
    workspace: "ACME CORP",
  };

  const nextMeeting = {
    starts_in_minutes: 192,
    title: "v2 API design review",
    time: "13:00",
    attendees: ["RK", "JM", "LV", "MC"],
    brief_summary:
      "Three decisions carried from the Apr 22 review. Token format for legacy clients, rate limit tiers per plan, deprecation timeline. Ravi wants to close token format today.",
    decisions_open: 3,
    tags: [
      ["APR 22 REVIEW", "2D"],
      ["API AUTH RFC", "2H"],
      ["#ENG-API", "32M"],
    ],
  };

  const assignments = [
    { ticket_id: "ACME-412", title: "Review v2 API auth spec, final sign off", due_label: "today", is_overdue: false },
    { ticket_id: "ENG-2201", title: "Ship rate limit middleware to staging", due_label: "apr 26", is_overdue: false },
    { ticket_id: "ACME-408", title: "Pair with Theo on webhook retry logic", due_label: "overdue", is_overdue: true },
    { ticket_id: "ACME-415", title: "Write migration RFC for legacy billing tables", due_label: "apr 29", is_overdue: false },
    { ticket_id: "ENG-2198", title: "Close out incident postmortem action items", due_label: "today", is_overdue: false },
  ];

  const teamSignals = [
    { kind: "risk", title: "Enterprise pilot goal slipped to 33%", summary: "Two pilots paused after Northwind. Sara flagged it in #sales leads.", when: "12m ago" },
    { kind: "departure", title: "Stripe adapter ownership unassigned", summary: "Henrik leaves Friday. Six related tickets, four unanswered Slack threads.", when: "1d ago" },
    { kind: "decision", title: "Token format locked, HS256 with rotating keypair", summary: "Carried from the Apr 22 review. Pricing coupling still open.", when: "1d ago" },
  ];

  const seedSources = [
    { name: "Slack", icon_letter: "S", icon_color: "#4A154B", status: "connected", item_count: 2183, item_label: "msgs", indexed_since_days: 12, excludes: "DMs, private channels" },
    { name: "Notion", icon_letter: "N", icon_color: "#000000", status: "connected", item_count: 1406, item_label: "docs", indexed_since_days: 12, excludes: "Personal pages" },
    { name: "Jira", icon_letter: "J", icon_color: "#0052CC", status: "connected", item_count: 891, item_label: "tickets", indexed_since_days: 12, excludes: "Archived projects" },
    { name: "Zoom", icon_letter: "Z", icon_color: "#2D8CFF", status: "connected", item_count: 312, item_label: "transcripts", indexed_since_days: 10, excludes: "1:1 personal" },
    { name: "GitHub", icon_letter: "G", icon_color: "#171515", status: "connected", item_count: 4128, item_label: "events", indexed_since_days: 12, excludes: "Private forks" },
    { name: "Google Drive", icon_letter: "D", icon_color: "#34A853", status: "connected", item_count: 823, item_label: "files", indexed_since_days: 9, excludes: "Trash, shared external" },
    { name: "Confluence", icon_letter: "C", icon_color: "#0052CC", status: "indexing", item_count: null, item_label: null, indexed_since_days: null, excludes: ".", progress: 0.38 },
    { name: "Linear", icon_letter: "L", icon_color: "#5E6AD2", status: "not_connected", item_count: null, item_label: null, indexed_since_days: null, excludes: "." },
    { name: "HubSpot", icon_letter: "H", icon_color: "#FF7A59", status: "not_connected", item_count: null, item_label: null, indexed_since_days: null, excludes: "." },
    { name: "Figma", icon_letter: "F", icon_color: "#F24E1E", status: "not_connected", item_count: null, item_label: null, indexed_since_days: null, excludes: "." },
  ];

  const ablation = [
    { mode: "Cosine",            faithfulness: 0.71, answer_relevancy: 0.74, context_precision: 0.68, context_recall: 0.70, avg_latency_ms: 312, tokens_per_sec: 168.4 },
    { mode: "Hybrid",            faithfulness: 0.79, answer_relevancy: 0.81, context_precision: 0.77, context_recall: 0.78, avg_latency_ms: 348, tokens_per_sec: 156.2 },
    { mode: "Hybrid + Reranker", faithfulness: 0.89, answer_relevancy: 0.91, context_precision: 0.86, context_recall: 0.85, avg_latency_ms: 412, tokens_per_sec: 142.7 },
  ];

  // Cache history: 47 queries, climbing 0.12 -> 0.74 with noise
  const cacheHistory = (() => {
    const out = [];
    for (let i = 1; i <= 47; i++) {
      const base = i <= 8 ? 0.12 + (0.62 * (i - 1) / 7) : 0.74;
      const noise = (Math.sin(i * 1.3) * 0.04) + (Math.cos(i * 0.7) * 0.02);
      out.push([i, Math.max(0.05, Math.min(0.85, base + noise))]);
    }
    return out;
  })();

  // Chunks for citations on Today
  const seedChunks = {
    Cosine: [
      { doc_title: "v2 API Design RFC.pdf", doc_type: "pdf", snippet: "Token format remains an open question. The Apr 15 draft proposed JWT with HS256. Backwards compatibility for v1 clients still requires a migration window of at least 90 days.", score: 0.84 },
      { doc_title: "Apr 22 API Review, transcript.txt", doc_type: "page", snippet: "Ravi: 'I want token format closed by next session. We are spending cycles on every adjacent decision because of it.' Group agrees to bring a final proposal.", score: 0.78 },
      { doc_title: "Stripe Integration Architecture.pdf", doc_type: "pdf", snippet: "Webhook retry logic uses exponential backoff with a maximum of 6 attempts. Henrik notes the Stripe adapter shares its retry queue with the legacy billing service.", score: 0.71 },
    ],
    Hybrid: [
      { doc_title: "v2 API Design RFC.pdf", doc_type: "pdf", snippet: "Token format remains an open question. The Apr 15 draft proposed JWT with HS256. Backwards compatibility for v1 clients still requires a migration window of at least 90 days.", score: 0.89 },
      { doc_title: "Apr 22 API Review, transcript.txt", doc_type: "page", snippet: "Ravi: 'I want token format closed by next session. We are spending cycles on every adjacent decision because of it.' Group agrees to bring a final proposal.", score: 0.84 },
      { doc_title: "API Auth RFC, draft 3.md", doc_type: "page", snippet: "Three decisions remain open after the Apr 22 review. Token format, rate limit tiers per plan, deprecation timeline. Owner is Marcus, target close is the next review session.", score: 0.78 },
    ],
    "Hybrid + Reranker": [
      { doc_title: "Apr 22 API Review, transcript.txt", doc_type: "page", snippet: "Ravi: 'I want token format closed by next session. We are spending cycles on every adjacent decision because of it.' Group agrees to bring a final proposal.", score: 0.94 },
      { doc_title: "API Auth RFC, draft 3.md", doc_type: "page", snippet: "Three decisions remain open after the Apr 22 review. Token format, rate limit tiers per plan, deprecation timeline. Owner is Marcus, target close is the next review session.", score: 0.90 },
      { doc_title: "v2 API Design RFC.pdf", doc_type: "pdf", snippet: "Token format remains an open question. The Apr 15 draft proposed JWT with HS256. Backwards compatibility for v1 clients still requires a migration window of at least 90 days.", score: 0.84 },
    ],
  };

  const seedAnswer = {
    Cosine: "The Apr 22 review left three decisions open for v2: token format for legacy clients, rate limit tiers per plan, and the deprecation timeline.[1] Ravi specifically asked to close token format in this next session.[2] The Stripe webhook retry path is loosely coupled to this conversation and may surface again.[3]",
    Hybrid: "The Apr 22 review left three decisions open: token format, rate limit tiers, and the deprecation timeline.[1][2] Token format is the priority Ravi wants closed today, with the current proposal being JWT HS256 plus a 90 day v1 migration window.[1] You own the RFC and the close target is this session.[3]",
    "Hybrid + Reranker": "Ravi opened the Apr 22 review by asking that token format be the first thing closed next session.[1] You own the RFC, with three decisions still open: token format, rate limit tiers per plan, and the deprecation timeline.[2] Current proposal is JWT HS256 with a 90 day backwards compatibility window for v1 clients.[3]",
  };

  // Archive: 24 entries, 8 weeks
  const askers = ["MC", "RK", "JM", "LV", "TS", "SH", "BV", "AN"];
  const queries = [
    { q: "What did we decide about token format in the Apr 22 review?", x: "Three decisions remain open. Token format is the priority. JWT with HS256 was proposed.", c: "Apr 22 API Review, transcript.txt", s: 0.92, m: "Hybrid + Reranker", team: "Engineering" },
    { q: "Who owns the Stripe adapter now that Henrik is leaving?", x: "Ownership is currently unassigned. Six tickets and four Slack threads still open under Henrik.", c: "Stripe Integration Architecture.pdf", s: 0.88, m: "Hybrid + Reranker", team: "Engineering" },
    { q: "What is our deployment freeze policy for the holidays?", x: "Freeze runs from Dec 18 through Jan 3. Critical hotfixes require VP approval and a postmortem.", c: "Deployment Policy v3.pdf", s: 0.87, m: "Hybrid", team: "Engineering" },
    { q: "How do I expense a conference?", x: "Submit through Brex within 30 days. Manager approval is required for items over $500.", c: "Acme Engineering Handbook.pdf", s: 0.81, m: "Hybrid", team: "Operations" },
    { q: "What is the on call rotation next week?", x: "Marcus primary Mon to Wed, Theo primary Thu to Sun. Ravi is secondary the full week.", c: "On Call Runbook v3.md", s: 0.83, m: "Hybrid", team: "Engineering" },
    { q: "Why did the Northwind pilot pause?", x: "Northwind requested SSO before signing. Discovery flagged this on Apr 8 but was not escalated.", c: "Sales Playbook 2026.pdf", s: 0.79, m: "Hybrid + Reranker", team: "Sales" },
    { q: "What changed in the Q3 pricing model?", x: "Tiered pricing replaced flat fee. Enterprise minimum raised to $50k, with a 90 day migration grace.", c: "Q3 Pricing Strategy.docx", s: 0.86, m: "Hybrid + Reranker", team: "Sales" },
    { q: "What is the SLA for the public API?", x: "99.9% uptime monthly. Credits scale by tier, with enterprise capped at 25% of monthly fee.", c: "v2 API Design RFC.pdf", s: 0.90, m: "Hybrid + Reranker", team: "Engineering" },
    { q: "What are the rate limit tiers being proposed for v2?", x: "Three tiers under discussion. Free 60 rpm, Pro 600 rpm, Enterprise negotiated, defaults to 6000 rpm.", c: "API Auth RFC, draft 3.md", s: 0.85, m: "Hybrid", team: "Engineering" },
    { q: "Who handles the Stripe webhook retry logic now?", x: "Theo is taking primary. Marcus pairs on Friday. The retry queue still shares with legacy billing.", c: "Webhook Retry Logic, diagram.png", s: 0.78, m: "Hybrid", team: "Engineering" },
    { q: "What is the parental leave policy?", x: "16 weeks fully paid for primary caregivers. 8 weeks for secondary. Stacks with PTO at intake.", c: "Acme Engineering Handbook.pdf", s: 0.91, m: "Hybrid + Reranker", team: "Operations" },
    { q: "Which customers asked for SSO in Q1?", x: "Northwind, Globex, Initech, and three smaller accounts. Globex closed without it.", c: "Sales Playbook 2026.pdf", s: 0.74, m: "Hybrid", team: "Sales" },
    { q: "What was the root cause of the Apr 21 payments outage?", x: "A misconfigured retry on the Stripe adapter caused a thundering herd. Mitigation took 47 minutes.", c: "Incident Postmortem, Apr 21 Payments Outage.pdf", s: 0.93, m: "Hybrid + Reranker", team: "Engineering" },
    { q: "How are RFCs reviewed and approved?", x: "Author proposes, two senior reviewers required, plus VP for cross team scope. Quorum is 5 days.", c: "Acme Engineering Handbook.pdf", s: 0.82, m: "Hybrid", team: "Engineering" },
    { q: "Where is the latest org chart?", x: "Notion, /people/orgchart. Last updated Apr 18 by HR. Engineering subtree slightly stale.", c: "Acme Engineering Handbook.pdf", s: 0.71, m: "Cosine", team: "Operations" },
    { q: "What did Ravi say about the deprecation timeline?", x: "Ravi prefers 6 months for v1 sunset. Sales wants 12. Compromise pending the next review.", c: "Apr 22 API Review, transcript.txt", s: 0.86, m: "Hybrid + Reranker", team: "Engineering" },
    { q: "Are we still using HS256 for tokens?", x: "Current proposal is HS256 with rotating keypair. RS256 evaluated and rejected on cost grounds.", c: "API Auth RFC, draft 3.md", s: 0.84, m: "Hybrid", team: "Engineering" },
    { q: "What is the security review process for new dependencies?", x: "Snyk auto scan plus manual review for any package with under 1000 weekly downloads.", c: "Acme Engineering Handbook.pdf", s: 0.77, m: "Hybrid", team: "Engineering" },
    { q: "How do I onboard a new pilot customer?", x: "Discovery, contract, kickoff within 2 weeks. CSM owns the first 90 days. Ping Sara for templates.", c: "Sales Playbook 2026.pdf", s: 0.80, m: "Hybrid", team: "Sales" },
    { q: "What changed in the engineering handbook last week?", x: "Section 4.2 on dependency review was rewritten. PTO request flow moved from email to Notion form.", c: "Acme Engineering Handbook.pdf", s: 0.69, m: "Cosine", team: "Operations" },
    { q: "Who is the SRE on call right now?", x: "Theo is primary. Marcus is secondary. Rotation hands off Monday at 9 AM ET.", c: "On Call Runbook v3.md", s: 0.88, m: "Hybrid + Reranker", team: "Engineering" },
    { q: "How is the enterprise pilot goal tracking?", x: "33% of plan as of this week. Two pilots paused. Sara flagged risk in #sales leads.", c: "Sales Playbook 2026.pdf", s: 0.81, m: "Hybrid", team: "Sales" },
    { q: "What is the budget for the Q3 marketing event?", x: "Approved $180k. Booth, travel, swag. Final venue locked Jun 1.", c: "Q3 Pricing Strategy.docx", s: 0.66, m: "Cosine", team: "Operations" },
    { q: "What metrics define a successful pilot?", x: "Three: weekly active seats >70%, NPS >40, and a signed expansion intent within 60 days.", c: "Sales Playbook 2026.pdf", s: 0.83, m: "Hybrid + Reranker", team: "Sales" },
  ];
  // distribute across 8 weeks
  const archive = queries.map((qq, i) => {
    const week = Math.floor(i / 3); // 8 weeks, 3 per week
    const dayInWeek = i % 3;
    // Apr is week 0..7. Build dates going back from week 7 = current
    const months = ["MAR", "MAR", "MAR", "MAR", "APR", "APR", "APR", "APR"];
    const baseDays = [3, 10, 17, 24, 31, 7, 14, 21];
    const day = baseDays[week] + dayInWeek;
    const dispMonth = day > 31 && week < 4 ? "APR" : months[week];
    const dispDay = day > 31 ? day - 31 : day;
    const hours = ["09:14", "11:38", "14:22", "16:07"][i % 4];
    return {
      timestamp_d: `${dispMonth} ${String(dispDay).padStart(2, "0")}`,
      timestamp_t: hours,
      week_label: `WEEK OF ${months[week]} ${String(baseDays[week]).padStart(2, "0")}`,
      asker: askers[i % askers.length],
      query: qq.q,
      excerpt: qq.x,
      citation: qq.c,
      score: qq.s,
      mode: qq.m,
      team: qq.team,
    };
  });

  // streaming generator
  function* tokenize(text) {
    const tokens = text.split(/(\s+)/);
    for (const t of tokens) yield t;
  }

  return {
    employee, nextMeeting, assignments, teamSignals,
    seedSources, ablation, cacheHistory, seedChunks, seedAnswer, archive,
    tokenize,
    inferenceStats: { cache_hit_rate: 0.74, tokens_per_sec: 156, p95_latency_ms: 412 },
  };
})();
window.Backend = Backend;
