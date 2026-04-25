// Atlas SPA — chrome, routing, all four pages
const { useState, useEffect, useRef, useMemo } = React;

// ---------- CHROME ----------
function Chrome({ page, setPage, B }) {
  const [time, setTime] = useState(formatTime());
  useEffect(() => {
    const i = setInterval(() => setTime(formatTime()), 30000);
    return () => clearInterval(i);
  }, []);
  function formatTime() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm} EDT`;
  }
  const e = B.employee;
  return (
    <>
      <div className="chrome-tl">
        <div className="name">{e.full_name}</div>
        <div className="role">{e.role_team}</div>
      </div>
      <div className="chrome-tc">
        <span className="sq"></span>
        <span className="nm">{e.workspace}</span>
      </div>
      <div className="chrome-tr">
        {time}&nbsp;&nbsp;<span className="live-dot"></span>LIVE
      </div>
      <div className="chips">
        {[
          ["Today", "today"],
          ["Sources", "sources"],
          ["Metrics", "metrics"],
          ["Archive", "archive"],
        ].map(([label, p]) => (
          <button
            key={p}
            className={`chip-nav ${page === p ? "active" : ""}`}
            onClick={() => setPage(p)}
            aria-label={`Go to ${p}`}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------- TODAY ----------
function TodayPage({ setPage, B }) {
  const [messages, setMessages] = useState([]); // {role, content, contexts?}
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState("Hybrid + Reranker");
  const [userRole, setUserRole] = useState("student");
  const [lightbox, setLightbox] = useState(null);
  const inputRef = useRef(null);
  // expose focus for cmd+k
  useEffect(() => { window.__focusAtlas = () => inputRef.current?.focus(); return () => { delete window.__focusAtlas; }; }, []);

  async function ask(text) {
    const q = text.trim();
    if (!q) return;
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setInput("");
    setThinking(true);

    try {
      const res = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, mode, role: userRole }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "RAG query failed");

      const answer = data.answer || "";
      const contexts = (data.contexts || []).map(c => ({
        doc_title: c.doc_title,
        doc_type: c.doc_type || "page",
        snippet: c.snippet,
        score: c.score,
      }));

      setThinking(false);
      let i = 0;
      const idx = Math.random();
      setMessages(prev => [...prev, { role: "atlas", content: "", contexts, _id: idx }]);
      const tick = () => {
        i++;
        setMessages(prev => prev.map(msg => msg._id === idx ? { ...msg, content: answer.slice(0, i * 4) } : msg));
        if (i * 4 < answer.length) setTimeout(tick, 30);
        else setMessages(prev => prev.map(msg => msg._id === idx ? { ...msg, content: answer } : msg));
      };
      tick();
    } catch (e) {
      setThinking(false);
      const errMsg = e.message?.includes("Cannot POST") || e.message?.includes("Failed to fetch") || e.message?.includes("not reachable")
        ? "RAG server is offline. Start it with:\n\ncd submissions/cortex\npy -3.11 -m uvicorn rag_server:app --port 8002\n\nAlso make sure the Node server is running:\n\ncd submissions/cortex/dashboard\nnode server.js"
        : `Error: ${e.message}`;
      setMessages(prev => [...prev, { role: "atlas", content: errMsg, contexts: null, _isError: true, _id: Math.random() }]);
      console.error("RAG query failed:", e.message);
    }
  }

  function changeMode(newMode) {
    if (newMode === mode) return;
    setMode(newMode);
  }

  const hasChat = messages.length > 0;
  const hasOverdue = B.assignments.some(a => a.is_overdue);
  const subhead = hasOverdue
    ? "BU-408 is overdue. Three threads from yesterday's API review still need closing. Your next meeting is the place to close them."
    : "Three threads still moving from yesterday's API review. Your next meeting is the place to close them.";

  const lastContexts = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--)
      if (messages[i].role === "atlas" && messages[i].contexts) return messages[i].contexts;
    return null;
  }, [messages]);

  return (
    <div className="page">
      <div className="hero-wrap">
        <h1 className="headline">Good morning, <span className="ital">{B.employee.first_name}</span>.</h1>
      </div>
      <p className="subhead">{subhead}</p>

      {/* TWO COL */}
      <div className="two-col">
        <div className="col">
          <div className="sec-head">
            <span className="sec-label">YOUR ASSIGNMENTS</span>
            <span className="sec-count">({B.assignments.length} OPEN)</span>
          </div>
          <div className="sec-rule"></div>
          {B.assignments.map((a, i) => (
            <div key={i} className={`assn ${a.is_overdue ? "over" : ""}`}>
              <span className="id">{a.ticket_id}</span>
              <span className="ttl">{a.title}</span>
              <span className="due">{a.due_label.toUpperCase()}</span>
            </div>
          ))}
        </div>
        <div className="col">
          <div className="sec-head">
            <span className="sec-label">WHAT CHANGED</span>
            <span className="sec-count">({B.teamSignals.length} NEW)</span>
          </div>
          <div className="sec-rule"></div>
          {B.teamSignals.map((s, i) => (
            <div key={i} className="signal">
              <span className={`kind ${s.kind}`}>{s.kind}</span>
              <div className="ttl">{s.title}</div>
              <div className="sm">{s.summary}</div>
              <div className="when">{s.when}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ASK */}
      <div className="ask-block">
        <div className="sec-head">
          <span className="sec-label">ASK ATLAS</span>
          <span className="sec-tag">grounded in everything BU.</span>
        </div>
        <div className="sec-rule"></div>

        {!hasChat && (
          <>
            <div className="try-label" style={{marginBottom:16}}>TRY ASKING</div>
            {[
              "How many credits does the MBA+MSDT dual degree require?",
              "Which neighborhoods do BU students live in off-campus?",
              "What is the Questrom MBA refund schedule?",
            ].map((s, i) => (
              <div key={i} className="try-row" onClick={() => ask(s)}>
                <span>{s}</span>
                <span className="ar">→</span>
              </div>
            ))}
          </>
        )}

        {hasChat && (
          <div className="chat-grid">
            <div className="thread">
              {messages.map((msg, i) =>
                msg.role === "user" ? (
                  <div key={i} className="msg-user">{msg.content}</div>
                ) : (
                  <AtlasMessage key={i} msg={msg} setLightbox={setLightbox} />
                )
              )}
              {thinking && <div className="thinking">thinking</div>}
            </div>
            <div className="rail-static">
              <Rail mode={mode} changeMode={changeMode} contexts={lastContexts} userRole={userRole} setUserRole={setUserRole} />
            </div>
          </div>
        )}
      </div>

      {/* Fixed input — always at bottom */}
      <div className="ask-wrap">
        <input
          ref={inputRef}
          className="ask-input"
          placeholder="Ask anything about BU CORP."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") ask(input); }}
        />
      </div>
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox-frame">{lightbox}</div>
        </div>
      )}
    </div>
  );
}

function AtlasMessage({ msg, setLightbox }) {
  if (msg._isError) {
    return (
      <div className="msg-atlas msg-error">
        <span className="err-label">ATLAS OFFLINE</span>
        <pre className="err-body">{msg.content}</pre>
      </div>
    );
  }
  // Render with citations [1][2][3] -> sup
  const parts = msg.content.split(/(\[\d\])/g);
  return (
    <div className="msg-atlas">
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d)\]$/);
        if (m && msg.contexts) {
          const idx = parseInt(m[1], 10) - 1;
          const c = msg.contexts[idx];
          if (!c) return p;
          return (
            <span key={i} className="cite">{m[1]}
              <span className="cite-card">
                <span className="doc">{c.doc_title}</span>
                <span className="snip">{c.snippet}</span>
                <span className="score">{c.score.toFixed(2)}</span>
              </span>
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

function Rail({ mode, changeMode, contexts, userRole, setUserRole }) {
  const modes = ["Cosine", "Hybrid", "Hybrid + Reranker"];
  const roles = ["faculty", "student", "guest"];
  return (
    <div className="rail">
      <div>
        <div className="sec-label">ROLE</div>
        <div className="sec-rule"></div>
        <div className="mode-toggle">
          {roles.map((r, i) => (
            <React.Fragment key={r}>
              <button className={`mode ${userRole === r ? "active" : ""}`} onClick={() => setUserRole(r)}>
                {r.toUpperCase()}
              </button>
              {i < roles.length - 1 && <span className="mode-sep">·</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div>
        <div className="sec-label">RETRIEVAL</div>
        <div className="sec-rule"></div>
        <div className="mode-toggle">
          {modes.map((m, i) => (
            <React.Fragment key={m}>
              <button className={`mode ${mode === m ? "active" : ""}`} onClick={() => changeMode(m)}>
                {m.toUpperCase()}
              </button>
              {i < modes.length - 1 && <span className="mode-sep">·</span>}
            </React.Fragment>
          ))}
        </div>
      </div>
      {contexts && contexts.length > 0 && (
        <div>
          <div className="sec-label">SOURCES</div>
          <div className="sec-rule"></div>
          {contexts.map((c, i) => (
            <div key={i} className="source">
              <span className="src-num">{i + 1}</span>
              <div>
                <div className="src-title">{c.doc_title}</div>
                <div className="src-snip">{c.snippet}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- SOURCES ----------
function SourcesPage({ B }) {
  const sources = B.seedSources;
  const connected = sources.filter(s => s.status === "connected").length;
  return (
    <div className="page">
      <div className="hero-wrap">
        <h1 className="headline">Where Atlas <span className="ital">looks</span>.</h1>
      </div>
      <p className="subhead">Plug in your stack. Atlas indexes everything (Slack, Notion, Drive, Jira, GitHub) and grounds every answer in real sources.</p>
      <div className="statline">{connected} OF {sources.length} CONNECTED, ~64% OF BU'S KNOWLEDGE GRAPH INDEXED</div>

      <div style={{marginTop:64,maxWidth:1080}}>
        <div className="sec-head">
          <span className="sec-label">CONNECTED SOURCES</span>
          <span className="sec-count">({sources.length} TOTAL)</span>
        </div>
        <div className="sec-rule"></div>
        {sources.map((s, i) => (
          <div key={i} className="connector">
            <div className="con-icon" style={{ background: s.icon_color }}>{s.icon_letter}</div>
            <div>
              <div className="con-name">{s.name}</div>
              <div className="con-ex">excludes: {s.excludes}</div>
            </div>
            <div className="con-metric">
              {s.item_count != null ? `${s.item_count.toLocaleString()} ${s.item_label}` : "."}
            </div>
            <div className="con-sync">
              {s.status === "connected" ? `since ${s.indexed_since_days} days`
                : s.status === "indexing" ? `indexing ${Math.round(s.progress * 100)}%`
                : "not connected"}
            </div>
            <div className="con-status">
              {s.status === "connected" && <span className="pill">CONNECTED</span>}
              {s.status === "indexing" && <span className="pill indexing">INDEXING</span>}
              {s.status === "not_connected" && <button className="pill connect">CONNECT</button>}
            </div>
            {s.status === "indexing" && <div className="con-progress" style={{ width: `${s.progress * 100}%` }}></div>}
          </div>
        ))}

        <div className="callout">
          <div className="callout-label">ATLAS NOTE</div>
          <div className="callout-body">Connecting Confluence will surface 47 architecture decisions and 12 RFCs that aren't currently retrievable.</div>
        </div>

        <div className="byo">
          <h2 className="headline sm">Bring your own <span className="ital">stack</span>.</h2>
          <p className="subhead" style={{maxWidth:580}}>This connector layer is open source. Drop in your team's tools, point Atlas at them, you have your own grounded knowledge assistant in an afternoon.</p>
          <div style={{marginTop:28}}>
            <button style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,textTransform:"uppercase",letterSpacing:"0.14em",color:"var(--accent)"}}>VIEW ON GITHUB →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- METRICS ----------
function MetricsPage({ B }) {
  const chartRef = useRef(null);
  useEffect(() => {
    if (!chartRef.current || !window.Plotly) return;
    const data = B.cacheHistory;
    Plotly.newPlot(chartRef.current, [{
      x: data.map(d => d[0]),
      y: data.map(d => d[1]),
      type: "scatter",
      mode: "lines",
      line: { color: "#0A0A0A", width: 1.5 },
      hoverinfo: "skip",
    }], {
      margin: { l: 40, r: 90, t: 10, b: 40 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      xaxis: { showgrid: false, linecolor: "#ECECEC", linewidth: 1, tickfont: { family: "JetBrains Mono", size: 11, color: "#A0A0A0" }, tickvals: [1,10,20,30,40,47] },
      yaxis: { showgrid: false, linecolor: "#ECECEC", linewidth: 1, tickformat: ".0%", range: [0,1], tickfont: { family: "JetBrains Mono", size: 11, color: "#A0A0A0" }, tickvals: [0,0.25,0.5,0.75,1] },
      shapes: [{ type:"line", x0:1, x1:47, y0:0.7, y1:0.7, line:{ color:"#FF4A1C", width:1, dash:"dash" } }],
      annotations: [
        { xref: "paper", yref: "y", x: 0.02, y: 0.7, text: "TARGET 70%", showarrow: false, xanchor: "left", yanchor: "bottom", font: { family: "JetBrains Mono", size: 10, color: "#FF4A1C" } },
        { x: 47, y: data[data.length-1][1], text: `● ${data[data.length-1][1].toFixed(2)}`, showarrow: false, xanchor: "left", xshift: 8, font: { family: "JetBrains Mono", size: 13, color: "#FF4A1C" } },
      ],
      showlegend: false,
    }, { displayModeBar: false, responsive: true });
  }, []);

  const ab = B.ablation;
  const max = Math.max(...ab.flatMap(r => [r.faithfulness, r.context_precision, r.context_recall]));
  const cols = ["faithfulness","context_precision","context_recall"];
  const colHeaders = ["FAITHFULNESS","CONTEXT PRECISION","CONTEXT RECALL"];

  return (
    <div className="page">
      <h1 className="headline">By the <span className="ital">numbers</span>.</h1>
      <p className="subhead">Live evaluation across retrieval modes. Real RAGAs metrics, real prefix cache rates, real throughput on vLLM.</p>
      <div className="statline">9 EVAL QUESTIONS, 3 RETRIEVAL MODES, vLLM + LLAMA 3.1 8B + QWEN2.5-VL-7B</div>

      {/* ABLATION */}
      <div className="metrics-section" style={{maxWidth:1080}}>
        <div className="sec-head">
          <span className="sec-label">ABLATION</span>
          <span className="sec-count">(3 MODES)</span>
        </div>
        <div className="sec-rule"></div>
        <table className="ab-table">
          <thead>
            <tr>
              <th style={{width:"22%"}}>RETRIEVAL MODE</th>
              {colHeaders.map(h => <th key={h} className="num">{h}</th>)}
              <th className="num">LATENCY</th>
            </tr>
          </thead>
          <tbody>
            {ab.map((r, i) => (
              <tr key={i} className={r.mode === "Hybrid + Reranker" ? "best" : ""}>
                <td><span className="ab-mode">{r.mode}</span></td>
                {cols.map(c => (
                  <td key={c}>
                    <div className="ab-cell">
                      <div className="ab-bar"><div className="ab-bar-fill" style={{ width: `${(r[c] / max) * 100}%` }}></div></div>
                      <span className="ab-val">{r[c].toFixed(2)}</span>
                    </div>
                  </td>
                ))}
                <td><div className="ab-cell"><span className="ab-val">{r.avg_latency_ms}MS</span></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* CACHE */}
      <div className="metrics-section" style={{maxWidth:1080}}>
        <div className="sec-head">
          <span className="sec-label">CACHE HIT RATE</span>
        </div>
        <div className="sec-rule"></div>
        <p className="subline">hit_tokens / query_tokens. Climbing as sticky routing warms up.</p>
        <div className="chart-wrap" ref={chartRef}></div>
      </div>

      {/* THROUGHPUT */}
      <div className="metrics-section" style={{maxWidth:1080}}>
        <div className="sec-head">
          <span className="sec-label">THROUGHPUT</span>
        </div>
        <div className="sec-rule"></div>
        <p className="subline">Tokens per second across retrieval modes.</p>
        <div className="tput-grid">
          {ab.map((r, i) => (
            <div key={i} className={`tput-card ${r.mode === "Hybrid + Reranker" ? "best" : ""}`}>
              <div className="tput-mode">{r.mode.toUpperCase()}</div>
              <div className="tput-val">{Math.round(r.tokens_per_sec)}</div>
              <div className="tput-sub">tokens per sec</div>
              <div className="tput-foot">P95 {r.avg_latency_ms}MS</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- ARCHIVE ----------
function escapeRegex(s) { return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function archiveRelevance(a, terms) {
  let score = 0;
  for (const t of terms) {
    const re = new RegExp(escapeRegex(t), "gi");
    const qMatches = (a.query.match(re) || []).length;
    const xMatches = (a.excerpt.match(re) || []).length;
    const cMatches = ((a.citation || "").match(re) || []).length;
    score += qMatches * 3 + xMatches * 1.5 + cMatches;
    if (a.query.toLowerCase().includes(t)) score += 2;
  }
  return score;
}

function ArchivePage({ setPage, B }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const filters = ["All", "Engineering", "Sales", "Operations", "High score", "Low score"];

  const q = search.trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];

  const filtered = B.archive
    .filter(a => {
      if (filter === "High score") return a.score >= 0.85;
      if (filter === "Low score") return a.score < 0.75;
      if (filter !== "All" && a.team !== filter) return false;
      if (!terms.length) return true;
      return terms.some(t =>
        a.query.toLowerCase().includes(t) ||
        a.excerpt.toLowerCase().includes(t) ||
        (a.citation || "").toLowerCase().includes(t)
      );
    })
    .map(a => ({ ...a, _rel: terms.length ? archiveRelevance(a, terms) : null }))
    .sort((a, b) => terms.length ? b._rel - a._rel : 0);

  // group by week_label, keep order
  const groups = [];
  filtered.forEach(a => {
    const last = groups[groups.length - 1];
    if (last && last.label === a.week_label) last.items.push(a);
    else groups.push({ label: a.week_label, items: [a] });
  });

  return (
    <div className="page">
      <h1 className="headline">The <span className="ital">archive</span>.</h1>
      <p className="subhead">Every question your team has asked. Citable, searchable, replayable.</p>
      <div className="statline">{B.archive.length} ENTRIES, 8 WEEKS, INDEXED</div>

      <input className="archive-search" placeholder="Search the archive." value={search} onChange={e => setSearch(e.target.value)} />
      <div className="chip-row">
        {filters.map(f => (
          <button key={f} className={`chip-f ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f.toUpperCase()}</button>
        ))}
      </div>

      <div className="archive-list" style={{maxWidth:1080}}>
        {groups.length === 0 && <div style={{padding:"60px 0",color:"var(--text-tertiary)",fontSize:14}}>No entries match.</div>}
        {groups.map((g, gi) => (
          <div key={gi}>
            <div className="week-header">{g.label}</div>
            {g.items.map((a, i) => (
              <div key={i} className="archive-row" onClick={() => setPage("today")}>
                <div className="ar-time"><span className="d">{a.timestamp_d}</span>{a.timestamp_t}</div>
                <div className="ar-asker"><span>{a.asker}</span></div>
                <div>
                  <div className="ar-q">{a.query}</div>
                  <div className="ar-x">{a.excerpt}</div>
                  <div className="ar-c">↳ {a.citation}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- APP ----------
function App() {
  const [page, setPage] = useState("today");
  const [B, setB] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    window.Backend.load()
      .then(data => setB(data))
      .catch(err => {
        console.error("Backend load failed:", err);
        setLoadError(err.message);
      });
  }, []);

  // Poll for fresh signals + archive every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      window.Backend.refresh().then(updates => {
        setB(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            ...(updates.teamSignals ? { teamSignals: updates.teamSignals } : {}),
            ...(updates.archive ? { archive: updates.archive } : {}),
            ...(updates.seedSources ? { seedSources: updates.seedSources } : {}),
          };
        });
      }).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Cmd+K
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPage("today");
        setTimeout(() => window.__focusAtlas?.(), 250);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loadError) {
    return (
      <div className="app" style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#FF4A1C"}}>
          LOAD ERROR: {loadError}
        </div>
      </div>
    );
  }

  if (!B) {
    return (
      <div className="app" style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"#A0A0A0",letterSpacing:"0.14em"}}>
          {B === null ? "LOADING..." : "READY"}
          {!B?.live && B !== null && <span style={{marginLeft:16,color:"#FF4A1C"}}>MOCK DATA</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {!B.live && (
        <div style={{position:"fixed",bottom:12,right:16,fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"#FF4A1C",letterSpacing:"0.12em",zIndex:100}}>
          MOCK DATA — run node server.js to connect live sources
        </div>
      )}
      <Chrome page={page} setPage={setPage} B={B} />
      {page === "today" && <TodayPage key="today" setPage={setPage} B={B} />}
      {page === "sources" && <SourcesPage key="sources" B={B} />}
      {page === "metrics" && <MetricsPage key="metrics" B={B} />}
      {page === "archive" && <ArchivePage key="archive" setPage={setPage} B={B} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
