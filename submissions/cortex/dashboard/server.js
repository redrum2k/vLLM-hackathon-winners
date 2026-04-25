/**
 * Atlas backend server — pulls real data from Slack and Google Drive.
 * Run: node server.js
 * Requires: SLACK_BOT_TOKEN and GOOGLE_SERVICE_ACCOUNT_KEY in .env
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { WebClient } = require("@slack/web-api");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

// Serve the dashboard static files so atlas.html and the API share the same origin
app.use(express.static(path.join(__dirname)));

// ── Slack client ──────────────────────────────────────────────────────────────
const slack = process.env.SLACK_BOT_TOKEN
  ? new WebClient(process.env.SLACK_BOT_TOKEN)
  : null;

// ── Google Drive auth ─────────────────────────────────────────────────────────
let driveClient = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  driveClient = google.drive({ version: "v3", auth });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatAge(ts) {
  const age = Date.now() / 1000 - parseFloat(ts);
  if (age < 3600) return `${Math.round(age / 60)}m ago`;
  if (age < 86400) return `${Math.round(age / 3600)}h ago`;
  return `${Math.round(age / 86400)}d ago`;
}

function formatDate(ts) {
  return new Date(parseFloat(ts) * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  }).toUpperCase();
}

function formatTime(ts) {
  return new Date(parseFloat(ts) * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function detectKind(text) {
  if (/risk|blocker|down|error|fail|paused|warning/i.test(text)) return "risk";
  if (/leav|depart|offboard|resign/i.test(text)) return "departure";
  if (/decided|approved|locked|confirmed|closed|shipped/i.test(text)) return "decision";
  return "update";
}

// Cache channel name -> ID lookups
let channelCache = null;
async function getChannelId(name) {
  if (!slack) return null;
  if (!channelCache) {
    const result = await slack.conversations.list({
      types: "public_channel,private_channel",
      limit: 200,
    });
    channelCache = {};
    for (const ch of result.channels || []) channelCache[ch.name] = ch.id;
  }
  return channelCache[name] || null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/slack/signals
 * Returns recent notable messages as teamSignals.
 * Pulls from channels listed in SLACK_SIGNAL_CHANNELS (comma-separated).
 */
app.get("/api/slack/signals", async (req, res) => {
  if (!slack) return res.status(503).json({ error: "SLACK_BOT_TOKEN not set" });

  try {
    const channelNames = (process.env.SLACK_SIGNAL_CHANNELS || "general,engineering")
      .split(",").map(s => s.trim());

    const signals = [];
    for (const name of channelNames) {
      const id = await getChannelId(name);
      if (!id) continue;

      const result = await slack.conversations.history({ channel: id, limit: 10 });
      for (const msg of result.messages || []) {
        const systemMsg = msg.subtype && msg.subtype !== "bot_message";
        if (!msg.text || systemMsg) continue;
        const firstLine = msg.text.replace(/\*|_|`|~|<[^>]+>/g, "").split("\n")[0].trim();
        if (firstLine.length < 10) continue;

        signals.push({
          kind: detectKind(msg.text),
          title: firstLine.slice(0, 90),
          summary: msg.text.replace(/\*|_|`|~|<[^>]+>/g, "").slice(0, 220),
          when: formatAge(msg.ts),
          channel: name,
        });
      }
    }

    // Deduplicate and take top 6
    res.json(signals.slice(0, 6));
  } catch (e) {
    console.error("/api/slack/signals:", e.message, "needed:", e.data?.needed, "provided:", e.data?.provided);
    res.status(500).json({ error: e.message, needed: e.data?.needed, provided: e.data?.provided });
  }
});

/**
 * GET /api/slack/archive
 * Returns historical messages across channels formatted as archive entries.
 */
app.get("/api/slack/archive", async (req, res) => {
  if (!slack) return res.status(503).json({ error: "SLACK_BOT_TOKEN not set" });

  try {
    const channelNames = (process.env.SLACK_ARCHIVE_CHANNELS || "general,engineering,marketing,hr,finance,product,housing,random")
      .split(",").map(s => s.trim());

    const archive = [];
    for (const name of channelNames) {
      const id = await getChannelId(name);
      if (!id) continue;

      const result = await slack.conversations.history({ channel: id, limit: 25 });
      for (const msg of result.messages || []) {
        const systemMsg = msg.subtype && msg.subtype !== "bot_message";
        if (!msg.text || systemMsg) continue;
        const clean = msg.text.replace(/\*|_|`|~|<[^>]+>/g, "").trim();
        if (clean.length < 20) continue;

        const lines = clean.split("\n").filter(Boolean);
        const query = lines[0].slice(0, 100);
        const excerpt = clean.slice(0, 200);
        const ts = msg.ts;
        const d = new Date(parseFloat(ts) * 1000);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());

        archive.push({
          timestamp_d: formatDate(ts),
          timestamp_t: formatTime(ts),
          week_label: `WEEK OF ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`,
          asker: msg.username ? msg.username.slice(0, 2).toUpperCase() : name.slice(0, 2).toUpperCase(),
          query,
          excerpt,
          citation: `#${name}`,
          score: 0.65 + Math.min(0.3, clean.length / 1000),
          team: name.charAt(0).toUpperCase() + name.slice(1),
        });
      }
    }

    // Sort newest first
    archive.sort((a, b) => b.timestamp_d.localeCompare(a.timestamp_d));
    res.json(archive.slice(0, 40));
  } catch (e) {
    console.error("/api/slack/archive:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/slack/stats
 * Returns message counts per channel for the sources page.
 */
app.get("/api/slack/stats", async (req, res) => {
  if (!slack) return res.status(503).json({ error: "SLACK_BOT_TOKEN not set" });

  try {
    const result = await slack.conversations.list({
      types: "public_channel,private_channel",
      limit: 200,
    });

    let total = 0;
    for (const ch of result.channels || []) {
      if (ch.num_members) total += ch.num_members;
    }

    res.json({
      channel_count: result.channels?.length || 0,
      total_members: total,
    });
  } catch (e) {
    console.error("/api/slack/stats:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/drive/sources
 * Returns Google Drive file list for the sources page.
 */
app.get("/api/drive/sources", async (req, res) => {
  if (!driveClient) return res.status(503).json({ error: "GOOGLE_SERVICE_ACCOUNT_KEY not set" });

  try {
    const result = await driveClient.files.list({
      pageSize: 100,
      fields: "files(id,name,mimeType,modifiedTime,size,owners)",
      q: "trashed=false",
      orderBy: "modifiedTime desc",
    });

    const files = (result.data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      size: f.size ? parseInt(f.size) : null,
    }));

    res.json({
      file_count: files.length,
      files: files.slice(0, 20), // top 20 most recently modified
    });
  } catch (e) {
    console.error("/api/drive/sources:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/rag/query
 * Proxies to the Python RAG server (rag_server.py) running on port 8002.
 * Body: { question, mode, role }
 * Returns: { answer, contexts, mode, role }
 */
const RAG_SERVER = process.env.RAG_SERVER || "http://localhost:8002";

app.post("/api/rag/query", async (req, res) => {
  const { question, mode, role } = req.body;
  if (!question || !question.trim()) {
    return res.status(400).json({ error: "question is required" });
  }
  try {
    const upstream = await fetch(`${RAG_SERVER}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, mode: mode || "Hybrid + Reranker", role: role || "student" }),
    });
    if (!upstream.ok) {
      const err = await upstream.text();
      return res.status(upstream.status).json({ error: err });
    }
    const data = await upstream.json();
    res.json(data);
  } catch (e) {
    console.error("/api/rag/query:", e.message);
    res.status(503).json({ error: "RAG server not reachable. Run: py -3.11 -m uvicorn rag_server:app --port 8002" });
  }
});

/**
 * GET /api/health
 */
app.get("/api/health", (req, res) => {
  res.json({
    slack: !!slack,
    drive: !!driveClient,
    timestamp: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Atlas backend running on http://localhost:${PORT}`);
  console.log(`  Slack: ${slack ? "connected" : "NO TOKEN SET"}`);
  console.log(`  Drive: ${driveClient ? "connected" : "NO KEY SET"}`);
});
