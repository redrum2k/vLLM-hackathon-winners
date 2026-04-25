// Atlas SPA — chrome, routing, all four pages
const { useState, useEffect, useRef, useMemo } = React;
const B = window.Backend;

// ---------- CHROME ----------
function Chrome({ page, setPage }) {
  const [time, setTime] = useState(formatTime());
  useEffect(() => {
    const i = setInterval(() => setTime(formatTime()), 30000);
    return () => clearInterval(i);
  }, []);
  function formatTime() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh} ${mm} EDT`;
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
        {time}&nbsp;&nbsp;<span className="live-dot"></span>LIVE INDEX LIVE
      </div>
      <div className="chips">
        {[
          ["01", "today"],
          ["02", "sources"],
          ["03", "metrics"],
          ["04", "archive"],
        ].map(([n, p]) => (
          <button
            key={p}
            className={`chip-nav ${page === p ? "active" : ""}`}
            onClick={() => setPage(p)}
            aria-label={`Go to ${p}`}
          >
            {n}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------- TODAY ----------
function TodayPage({ setPage }) {
  const [messages, setMessages] = useState([]); // {role, content, contexts?}
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState("Hybrid + Reranker");
  const [scores, setScores] = useState(B.ablation.find(a => a.mode === "Hybrid + Reranker"));
  const [deltas, setDeltas] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const inputRef = useRef(null);
  const m = B.nextMeeting;
  const hours = Math.floor(m.starts_in_minutes / 60);
  const mins = m.starts_in_minutes % 60;
  const upnext = `UP NEXT, IN ${hours}H ${mins}M`;

  // expose focus for cmd+k
  useEffect(() => { window.__focusAtlas = () => inputRef.current?.focus(); return () => { delete window.__focusAtlas; }; }, []);

  function ask(text) {
    const q = text.trim();
    if (!q) return;
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setInput("");
    setThinking(true);
    const contexts = B.seedChunks[mode];
    const answer = B.seedAnswer[mode];
    setTimeout(() => {
      setThinking(false);
      // streamed reveal
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
    }, 700);
  }

  function changeMode(newMode) {
    if (newMode === mode) return;
    const prevScores = scores;
    const newScores = B.ablation.find(a => a.mode === newMode);
    const d = {
      faithfulness: newScores.faithfulness - prevScores.faithfulness,
      answer_relevancy: newScores.answer_relevancy - prevScores.answer_relevancy,
      context_precision: newScores.context_precision - prevScores.context_precision,
      context_recall: newScores.context_recall - prevScores.context_recall,
    };
    setMode(newMode);
    setScores(newScores);
    setDeltas(d);
    setTimeout(() => setDeltas(null), 2000);
  }

  const hasChat = messages.length > 0;
  const hasOverdue = B.assignments.some(a => a.is_overdue);
  const subhead = hasOverdue
    ? "ACME-408 is overdue. Three threads from yesterday's API review still need closing. Your next meeting is the place to close them."
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
        <img src="assets/arrow-curve-down.svg" className="arrow-callout right-of" alt="" />
      </div>
      <p className="subhead">{subhead}</p>

      {/* BRIEF CARD */}
      <div className="brief-card">
        <div className="brief-top">
          <span className="upnext">{upnext}</span>
          <div className="attendees">
            {m.attendees.map((a, i) => <span key={i} className="att">{a}</span>)}
          </div>
        </div>
        <div className="brief-time">
          <span className="t">{m.time}</span>
          <span className="ttl">{m.title}</span>
        </div>
        <p className="brief-summary">{m.brief_summary}</p>
        <div className="tag-row">
          {m.tags.map(([k, v], i) => (
            <span key={i} className="tag">{k} · {v}</span>
          ))}
        </div>
        <div className="brief-link">
          <button onClick={() => ask("Brief me on the v2 API design review.")}>ASK ATLAS ABOUT THIS →</button>
        </div>
      </div>

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
          <span className="sec-tag">grounded in everything Acme.</span>
        </div>
        <div className="sec-rule"></div>

        {!hasChat ? (
          <>
            <input
              ref={inputRef}
              className="ask-input"
              placeholder="Ask anything about Acme."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") ask(input); }}
            />
            <div className="try-label" style={{marginBottom:16}}>TRY ASKING</div>
            {[
              "Brief me on the v2 API design review.",
              "Who owns the Stripe adapter now that Henrik is leaving?",
              "What is the deployment freeze policy this quarter?",
            ].map((s, i) => (
              <div key={i} className="try-row" onClick={() => ask(s)}>
                <span>{s}</span>
                <span className="ar">→</span>
              </div>
            ))}
          </>
        ) : (
          <div className="chat-grid">
            <div>
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
              <input
                ref={inputRef}
                className="ask-input"
                placeholder="Ask anything about Acme."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") ask(input); }}
              />
            </div>
            <div></div>
            <div className="rail-static">
              <Rail mode={mode} changeMode={changeMode} scores={scores} deltas={deltas} contexts={lastContexts} />
            </div>
          </div>
        )}
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

function Rail({ mode, changeMode, scores, deltas, contexts }) {
  const modes = ["Cosine", "Hybrid", "Hybrid + Reranker"];
  const stats = B.inferenceStats;
  const evalMetrics = [
    ["FAITHFULNESS", "faithfulness"],
    ["ANSWER RELEVANCY", "answer_relevancy"],
    ["CONTEXT PRECISION", "context_precision"],
    ["CONTEXT RECALL", "context_recall"],
  ];
  return (
    <div className="rail">
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
      <div>
        <div className="sec-label">SOURCES</div>
        <div className="sec-rule"></div>
        {(contexts || []).map((c, i) => (
          <div key={i} className="source">
            <span className="src-num">{i + 1}</span>
            <div>
              <div className="src-title">{c.doc_title}</div>
              <div className="src-snip">{c.snippet}</div>
            </div>
            <span className="src-score">{c.score.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="sec-label">EVAL</div>
        <div className="sec-rule"></div>
        {evalMetrics.map(([label, key]) => {
          const v = scores[key];
          const d = deltas?.[key];
          return (
            <div key={key} className="eval-row">
              <span className="eval-label">{label}</span>
              <div className="eval-bar"><div className="eval-fill" style={{ width: `${v * 100}%` }}></div></div>
              <span className="eval-val">{v.toFixed(3)}</span>
              <span className={`eval-delta ${d ? "show" : ""}`}>{d ? `${d > 0 ? "+" : ""}${d.toFixed(2)}` : ""}</span>
            </div>
          );
        })}
      </div>
      <div>
        <div className="sec-label">INFERENCE</div>
        <div className="sec-rule"></div>
        <div className="inf-row"><span className="inf-label">CACHE HIT RATE</span><span className="inf-val">{stats.cache_hit_rate.toFixed(2)}</span></div>
        <div className="inf-row"><span className="inf-label">TOKENS PER SEC</span><span className="inf-val">{stats.tokens_per_sec}</span></div>
        <div className="inf-row"><span className="inf-label">P95 LATENCY</span><span className="inf-val">{stats.p95_latency_ms}MS</span></div>
      </div>
    </div>
  );
}

// ---------- SOURCES ----------
function SourcesPage() {
  const sources = B.seedSources;
  const connected = sources.filter(s => s.status === "connected").length;
  return (
    <div className="page">
      <div className="hero-wrap">
        <h1 className="headline">Where Atlas <span className="ital">looks</span>.</h1>
        <img src="assets/arrow-curve-down.svg" className="arrow-callout above-right" alt="" />
      </div>
      <p className="subhead">Plug in your stack. Atlas indexes everything (Slack, Notion, Drive, Jira, GitHub) and grounds every answer in real sources.</p>
      <div className="statline">{connected} OF {sources.length} CONNECTED, ~64% OF ACME'S KNOWLEDGE GRAPH INDEXED</div>

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
function MetricsPage() {
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
  const max = Math.max(...ab.flatMap(r => [r.faithfulness, r.answer_relevancy, r.context_precision, r.context_recall]));
  const cols = ["faithfulness","answer_relevancy","context_precision","context_recall"];
  const colHeaders = ["FAITHFULNESS","ANSWER RELEVANCY","CONTEXT PRECISION","CONTEXT RECALL"];

  return (
    <div className="page">
      <h1 className="headline">By the <span className="ital">numbers</span>.</h1>
      <p className="subhead">Live evaluation across retrieval modes. Real RAGAs metrics, real prefix cache rates, real throughput on vLLM.</p>
      <div className="statline">47 QUERIES THIS SESSION, 9 ACME CORPUS DOCS, vLLM + LLAMA 3.2 VISION</div>

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
function ArchivePage({ setPage }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const filters = ["All", "Engineering", "Sales", "Operations", "High score", "Low score"];

  const filtered = B.archive.filter(a => {
    if (search && !a.query.toLowerCase().includes(search.toLowerCase()) && !a.excerpt.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "All") return true;
    if (filter === "High score") return a.score >= 0.85;
    if (filter === "Low score") return a.score < 0.75;
    return a.team === filter;
  });

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
            {g.items.map((a, i) => {
              const sc = a.score >= 0.85 ? "high" : a.score >= 0.75 ? "mid" : "low";
              return (
                <div key={i} className="archive-row" onClick={() => setPage("today")}>
                  <div className="ar-time"><span className="d">{a.timestamp_d}</span>{a.timestamp_t}</div>
                  <div className="ar-asker"><span>{a.asker}</span></div>
                  <div>
                    <div className="ar-q">{a.query}</div>
                    <div className="ar-x">{a.excerpt}</div>
                    <div className="ar-c">↳ {a.citation}</div>
                  </div>
                  <div className={`ar-score ${sc}`}>{a.score.toFixed(2)}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- APP ----------
function App() {
  const [page, setPage] = useState("today");

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

  return (
    <div className="app">
      <Chrome page={page} setPage={setPage} />
      {page === "today" && <TodayPage key="today" setPage={setPage} />}
      {page === "sources" && <SourcesPage key="sources" />}
      {page === "metrics" && <MetricsPage key="metrics" />}
      {page === "archive" && <ArchivePage key="archive" setPage={setPage} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
