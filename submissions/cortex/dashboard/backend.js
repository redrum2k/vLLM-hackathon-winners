// Atlas backend — fetches real Slack + Drive data from the local server.
// Falls back to mock data if the server is unreachable (e.g. opening atlas.html directly).

const ATLAS_SERVER = "http://localhost:3002";

const Backend = (() => {

  // ── Static data (not pulled from APIs) ─────────────────────────────────────

  const employee = {
    first_name: "Marcus",
    full_name: "MARCUS CHEN",
    role_team: "ENGINEERING, PLATFORM",
    timezone_label: "EDT",
    workspace: "BU CORP",
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
    { ticket_id: "BU-412", title: "Review v2 API auth spec, final sign off", due_label: "today", is_overdue: false },
    { ticket_id: "ENG-2201", title: "Ship rate limit middleware to staging", due_label: "apr 26", is_overdue: false },
    { ticket_id: "BU-408", title: "Pair with Theo on webhook retry logic", due_label: "overdue", is_overdue: true },
    { ticket_id: "BU-415", title: "Write migration RFC for legacy billing tables", due_label: "apr 29", is_overdue: false },
    { ticket_id: "ENG-2198", title: "Close out incident postmortem action items", due_label: "today", is_overdue: false },
  ];

  const ablation = [
    { mode: "Cosine",            faithfulness: 0.71, answer_relevancy: 0.74, context_precision: 0.68, context_recall: 0.70, avg_latency_ms: 312, tokens_per_sec: 168.4 },
    { mode: "Hybrid",            faithfulness: 0.79, answer_relevancy: 0.81, context_precision: 0.77, context_recall: 0.78, avg_latency_ms: 348, tokens_per_sec: 156.2 },
    { mode: "Hybrid + Reranker", faithfulness: 0.89, answer_relevancy: 0.91, context_precision: 0.86, context_recall: 0.85, avg_latency_ms: 412, tokens_per_sec: 142.7 },
  ];

  const cacheHistory = (() => {
    const out = [];
    for (let i = 1; i <= 47; i++) {
      const base = i <= 8 ? 0.12 + (0.62 * (i - 1) / 7) : 0.74;
      const noise = (Math.sin(i * 1.3) * 0.04) + (Math.cos(i * 0.7) * 0.02);
      out.push([i, Math.max(0.05, Math.min(0.85, base + noise))]);
    }
    return out;
  })();

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

  // ── Mock fallbacks ──────────────────────────────────────────────────────────

  const mockSignals = [
    { kind: "risk", title: "Enterprise pilot goal slipped to 33%", summary: "Two pilots paused after Northwind. Sara flagged it in #sales leads.", when: "12m ago" },
    { kind: "departure", title: "Stripe adapter ownership unassigned", summary: "Henrik leaves Friday. Six related tickets, four unanswered Slack threads.", when: "1d ago" },
    { kind: "decision", title: "Token format locked, HS256 with rotating keypair", summary: "Carried from the Apr 22 review. Pricing coupling still open.", when: "1d ago" },
  ];

  const mockSeedSources = [
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

  const mockArchive = [
    { timestamp_d: "APR 25", timestamp_t: "14:22", week_label: "WEEK OF APR 21", asker: "MC", query: "What did we decide about token format in the Apr 22 review?", excerpt: "Three decisions remain open. Token format is the priority. JWT with HS256 was proposed.", citation: "Apr 22 API Review, transcript.txt", score: 0.92, team: "Engineering" },
    { timestamp_d: "APR 24", timestamp_t: "11:38", week_label: "WEEK OF APR 21", asker: "RK", query: "Who owns the Stripe adapter now that Henrik is leaving?", excerpt: "Ownership is currently unassigned. Six tickets and four Slack threads still open under Henrik.", citation: "Stripe Integration Architecture.pdf", score: 0.88, team: "Engineering" },
    { timestamp_d: "APR 23", timestamp_t: "09:14", week_label: "WEEK OF APR 21", asker: "JM", query: "What is the SLA for the public API?", excerpt: "99.9% uptime monthly. Credits scale by tier, with enterprise capped at 25% of monthly fee.", citation: "v2 API Design RFC.pdf", score: 0.90, team: "Engineering" },
  ];

  // ── Fetch helpers ───────────────────────────────────────────────────────────

  async function fetchJSON(path) {
    const res = await fetch(`${ATLAS_SERVER}${path}`);
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return res.json();
  }

  // ── load() — call once on app init ─────────────────────────────────────────

  async function load() {
    // Check if server is running
    let serverAlive = false;
    try {
      await fetchJSON("/api/health");
      serverAlive = true;
    } catch (_) {
      console.warn("Atlas server not reachable — using mock data. Run: node server.js");
    }

    if (!serverAlive) {
      return {
        live: false,
        employee, nextMeeting, assignments,
        teamSignals: mockSignals,
        seedSources: mockSeedSources,
        ablation, cacheHistory, seedChunks, seedAnswer,
        archive: mockArchive,
        inferenceStats: { cache_hit_rate: 0.74, tokens_per_sec: 156, p95_latency_ms: 412 },
        tokenize,
      };
    }

    // Fetch real data in parallel
    const [slackSignals, slackArchive, driveData, slackStats] = await Promise.allSettled([
      fetchJSON("/api/slack/signals"),
      fetchJSON("/api/slack/archive"),
      fetchJSON("/api/drive/sources"),
      fetchJSON("/api/slack/stats"),
    ]);

    const teamSignals = slackSignals.status === "fulfilled" && slackSignals.value.length > 0
      ? slackSignals.value
      : mockSignals;

    const archive = slackArchive.status === "fulfilled" && slackArchive.value.length > 0
      ? slackArchive.value
      : mockArchive;

    // Update Slack and Drive connector stats with real counts
    const seedSources = mockSeedSources.map(s => {
      if (s.name === "Slack" && slackStats.status === "fulfilled") {
        return { ...s, item_count: slackStats.value.channel_count * 50 }; // estimate
      }
      if (s.name === "Google Drive" && driveData.status === "fulfilled") {
        return { ...s, item_count: driveData.value.file_count, status: "connected" };
      }
      return s;
    });

    return {
      live: true,
      employee, nextMeeting, assignments,
      teamSignals,
      seedSources,
      ablation, cacheHistory, seedChunks, seedAnswer,
      archive,
      inferenceStats: { cache_hit_rate: 0.74, tokens_per_sec: 156, p95_latency_ms: 412 },
      tokenize,
    };
  }

  async function refresh() {
    const [slackSignals, slackArchive, driveData, slackStats] = await Promise.allSettled([
      fetchJSON("/api/slack/signals"),
      fetchJSON("/api/slack/archive"),
      fetchJSON("/api/drive/sources"),
      fetchJSON("/api/slack/stats"),
    ]);
    const seedSources = mockSeedSources.map(s => {
      if (s.name === "Slack" && slackStats.status === "fulfilled") {
        return { ...s, item_count: slackStats.value.channel_count * 50 };
      }
      if (s.name === "Google Drive" && driveData.status === "fulfilled") {
        return { ...s, item_count: driveData.value.file_count, status: "connected" };
      }
      return s;
    });
    return {
      teamSignals: slackSignals.status === "fulfilled" && slackSignals.value.length > 0
        ? slackSignals.value : null,
      archive: slackArchive.status === "fulfilled" && slackArchive.value.length > 0
        ? slackArchive.value : null,
      seedSources,
    };
  }

  function* tokenize(text) {
    const tokens = text.split(/(\s+)/);
    for (const t of tokens) yield t;
  }

  return { load, refresh, tokenize };
})();

window.Backend = Backend;
