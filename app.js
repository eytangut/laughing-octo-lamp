import { Chess } from "https://esm.sh/chess.js@1.0.0";
import {
  parseModelTierList,
  isFallbackWorthyError,
  fallbackAnalysis,
  makePuzzleFromAnalysis,
  scheduleFlashcard,
  safeParsePuzzles,
} from "./core.js";

const el = {
  pgnFile: document.getElementById("pgnFile"),
  pgnInput: document.getElementById("pgnInput"),
  playerSide: document.getElementById("playerSide"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  apiKey: document.getElementById("apiKey"),
  modelTierList: document.getElementById("modelTierList"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  statusLine: document.getElementById("statusLine"),
  board: document.getElementById("board"),
  arrowLayer: document.getElementById("arrowLayer"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  playBtn: document.getElementById("playBtn"),
  moveLabel: document.getElementById("moveLabel"),
  moveTimeline: document.getElementById("moveTimeline"),
  coachMessage: document.getElementById("coachMessage"),
  generatePuzzlesBtn: document.getElementById("generatePuzzlesBtn"),
  exportPuzzlesBtn: document.getElementById("exportPuzzlesBtn"),
  importPuzzlesInput: document.getElementById("importPuzzlesInput"),
  puzzleDeck: document.getElementById("puzzleDeck"),
};

const PIECES = {
  p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚",
  P: "♙", R: "♖", N: "♘", B: "♗", Q: "♕", K: "♔"
};

const STORAGE_KEY = "chessCoachSettings";
const PUZZLES_KEY = "chessCoachPuzzles";

const state = {
  chess: new Chess(),
  positions: [new Chess().fen()],
  moves: [],
  currentPly: 0,
  analyses: [],
  puzzles: [],
  autoPlayTimer: null,
};

loadSettings();
loadPuzzles();
renderBoard();
updateMoveView();

el.pgnFile.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  el.pgnInput.value = await file.text();
});

el.saveSettingsBtn.addEventListener("click", () => {
  const settings = {
    models: parseModelTierList(el.modelTierList.value),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  setStatus(`Saved ${settings.models.length} model tier(s). API key stays only in this browser tab.`);
});

el.analyzeBtn.addEventListener("click", async () => {
  try {
    stopAutoPlay();
    await loadAndAnalyzeGame(el.pgnInput.value, el.playerSide.value);
    setStatus("Game loaded and analyzed.");
  } catch (err) {
    setStatus(`Failed: ${err.message}`);
  }
});

el.prevBtn.addEventListener("click", () => goToPly(state.currentPly - 1));
el.nextBtn.addEventListener("click", () => goToPly(state.currentPly + 1));
el.playBtn.addEventListener("click", () => {
  if (state.autoPlayTimer) {
    stopAutoPlay();
    return;
  }
  state.autoPlayTimer = setInterval(() => {
    if (state.currentPly >= state.moves.length) return stopAutoPlay();
    goToPly(state.currentPly + 1);
  }, 1000);
  el.playBtn.textContent = "Pause";
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowLeft") goToPly(state.currentPly - 1);
  if (ev.key === "ArrowRight") goToPly(state.currentPly + 1);
});

el.generatePuzzlesBtn.addEventListener("click", async () => {
  const generated = await generatePuzzles();
  state.puzzles = [...generated, ...state.puzzles].slice(0, 120);
  persistPuzzles();
  renderPuzzles();
  setStatus(`Generated ${generated.length} puzzle flashcards.`);
});

el.exportPuzzlesBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.puzzles, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "chess-coach-puzzles.json";
  a.click();
  URL.revokeObjectURL(url);
});

el.importPuzzlesInput.addEventListener("change", async (ev) => {
  const f = ev.target.files?.[0];
  if (!f) return;
  try {
    const imported = safeParsePuzzles(await f.text());
    state.puzzles = [...imported, ...state.puzzles].slice(0, 120);
    persistPuzzles();
    renderPuzzles();
    setStatus(`Imported ${imported.length} cards.`);
  } catch (e) {
    setStatus(e.message);
  }
});

async function loadAndAnalyzeGame(pgn, side) {
  const chess = new Chess();
  if (!pgn) {
    throw new Error("Invalid PGN");
  }
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch {
    throw new Error("Invalid PGN");
  }
  const verbose = chess.history({ verbose: true });
  state.moves = verbose;
  state.positions = [new Chess().fen()];

  const replay = new Chess();
  for (const m of verbose) {
    replay.move(m.san);
    state.positions.push(replay.fen());
  }

  state.currentPly = 0;
  state.analyses = await analyzeMovesWithGemini(verbose, side);
  renderTimeline();
  goToPly(0);
}

async function analyzeMovesWithGemini(verboseMoves, side) {
  const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  const models = settings.models?.length ? settings.models : parseModelTierList(el.modelTierList.value);
  const apiKey = el.apiKey.value.trim();
  if (!apiKey || !models.length) return fallbackAnalysis(verboseMoves);

  const prompt = `You are a funny but insightful chess coach. Analyze this game from ${side} perspective.
Return STRICT JSON array with one object per ply:
{ "ply": number, "classification": "book|good|inaccuracy|miss|blunder|brilliant", "comment": string, "altMove": string|null, "focusSquares": ["e2","e4"] }
Game SAN moves: ${verboseMoves.map((m) => m.san).join(" ")}`;

  let lastError = "";
  for (const model of models) {
    try {
      const text = await callGemini(model, apiKey, prompt);
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Invalid response payload");
      return parsed;
    } catch (e) {
      const status = Number(e.status || 0);
      lastError = `${model}: ${e.message || e}`;
      if (!isFallbackWorthyError(status, e.message)) break;
      setStatus(`Model ${model} unavailable/limited, trying next tier...`);
    }
  }
  setStatus(`Gemini fallback used (${lastError}).`);
  return fallbackAnalysis(verboseMoves);
}

async function generatePuzzles() {
  if (!state.analyses.length) return [];
  const weak = state.analyses.filter((a) => ["blunder", "miss", "inaccuracy"].includes(a.classification));
  const fallbackCards = weak.slice(0, 12).map((item, idx) => makePuzzleFromAnalysis(item, state.positions[item.ply - 1] || state.positions[0], idx));

  const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  const apiKey = el.apiKey.value.trim();
  const models = settings.models || [];
  if (!apiKey || !models.length) return fallbackCards;

  const prompt = `Generate ${Math.min(24, Math.max(8, weak.length * 2))} chess puzzle flashcards as STRICT JSON array.
Fields per card: id, fen, question, bestMove, explanation, wrongMoves([{move,whyWrong}]), difficulty, intervalDays, dueAt.
Use these weak moments: ${JSON.stringify(weak.slice(0, 20))}`;

  for (const model of models) {
    try {
      const text = await callGemini(model, apiKey, prompt);
      const parsed = safeParsePuzzles(text);
      return parsed;
    } catch (e) {
      if (!isFallbackWorthyError(Number(e.status || 0), e.message)) break;
      setStatus(`Puzzle generation switched from ${model} to next tier...`);
    }
  }

  return fallbackCards;
}

async function callGemini(model, apiKey, prompt) {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  const payload = await resp.json();
  if (!resp.ok) {
    const err = new Error(payload?.error?.message || `HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");
  return text;
}

function goToPly(ply) {
  state.currentPly = Math.max(0, Math.min(ply, state.moves.length));
  renderBoard();
  updateMoveView();
  if (state.currentPly === state.moves.length && state.moves.length) {
    setCoach("Game finished! Generate puzzles to train recurring mistakes.");
  }
}

function renderBoard() {
  const chess = new Chess(state.positions[state.currentPly] || state.positions[0]);
  const board = chess.board();
  el.board.innerHTML = "";
  const analysis = state.analyses[state.currentPly - 1];
  const focus = new Set((analysis?.focusSquares || []).map(String));

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement("div");
      sq.className = `square ${(r + c) % 2 ? "dark" : "light"}`;
      const algebraic = `${"abcdefgh"[c]}${8 - r}`;
      if (focus.has(algebraic)) sq.classList.add("hl");
      const piece = board[r][c];
      if (piece) sq.textContent = PIECES[piece.color === "w" ? piece.type.toUpperCase() : piece.type];
      el.board.appendChild(sq);
    }
  }
  drawArrow(analysis?.focusSquares?.[0], analysis?.focusSquares?.[1]);
}

function drawArrow(from, to) {
  el.arrowLayer.innerHTML = "";
  if (!from || !to) return;
  const f = squareCenter(from);
  const t = squareCenter(to);
  if (!f || !t) return;

  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "arrowHead");
  marker.setAttribute("markerWidth", "10");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("refX", "9");
  marker.setAttribute("refY", "3.5");
  marker.setAttribute("orient", "auto");
  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  polygon.setAttribute("points", "0 0, 10 3.5, 0 7");
  polygon.setAttribute("fill", "#70d0ff");
  marker.appendChild(polygon);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.appendChild(marker);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(f.x));
  line.setAttribute("y1", String(f.y));
  line.setAttribute("x2", String(t.x));
  line.setAttribute("y2", String(t.y));
  line.setAttribute("stroke", "#70d0ff");
  line.setAttribute("stroke-width", "12");
  line.setAttribute("marker-end", "url(#arrowHead)");
  line.setAttribute("stroke-linecap", "round");
  el.arrowLayer.append(defs, line);
}

function squareCenter(square) {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = 8 - Number(square[1]);
  return { x: file * 100 + 50, y: rank * 100 + 50 };
}

function updateMoveView() {
  el.moveLabel.textContent = `Move ${state.currentPly}/${state.moves.length}`;
  const a = state.analyses[state.currentPly - 1];
  if (a) setCoach(`${emojiFor(a.classification)} ${a.comment}`);
}

function renderTimeline() {
  el.moveTimeline.innerHTML = "";
  state.moves.forEach((m, i) => {
    const a = state.analyses[i] || {};
    const li = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = `badge ${a.classification || "good"}`;
    badge.textContent = a.classification || "good";
    const move = document.createElement("strong");
    move.textContent = `${i + 1}. ${m.san}`;
    li.append(badge, move);
    if (a.altMove) {
      li.append(document.createTextNode(` ↪ alt: ${a.altMove}`));
    }
    li.addEventListener("click", () => goToPly(i + 1));
    el.moveTimeline.appendChild(li);
  });
}

function renderPuzzles() {
  const now = Date.now();
  const due = state.puzzles.filter((p) => new Date(p.dueAt).getTime() <= now);
  el.puzzleDeck.innerHTML = `${due.length} due / ${state.puzzles.length} total`;

  state.puzzles.slice(0, 25).forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "deck-card";
    const q = document.createElement("div");
    const qStrong = document.createElement("strong");
    qStrong.textContent = p.question;
    q.appendChild(qStrong);
    const meta = document.createElement("small");
    meta.textContent = `${p.difficulty || "mixed"} • due ${new Date(p.dueAt).toLocaleString()}`;
    const best = document.createElement("div");
    best.textContent = `Best: ${p.bestMove}`;
    const exp = document.createElement("div");
    exp.textContent = p.explanation;
    card.append(q, meta, best, exp);
    const row = document.createElement("div");
    row.className = "inline";
    ["again", "hard", "good", "easy"].forEach((q) => {
      const b = document.createElement("button");
      b.className = "secondary";
      b.textContent = q;
      b.addEventListener("click", () => {
        state.puzzles[idx] = scheduleFlashcard(p, q);
        persistPuzzles();
        renderPuzzles();
      });
      row.appendChild(b);
    });
    card.appendChild(row);
    el.puzzleDeck.appendChild(card);
  });
}

function setCoach(message) {
  el.coachMessage.textContent = message;
}

function emojiFor(classification) {
  return ({ brilliant: "✨", blunder: "😵", miss: "🤔", inaccuracy: "⚠️", good: "👍", book: "📚" })[classification] || "🧠";
}

function setStatus(message) {
  el.statusLine.textContent = message;
}

function loadSettings() {
  const settings = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  if (Array.isArray(settings.models)) el.modelTierList.value = settings.models.join("\n");
}

function loadPuzzles() {
  try {
    state.puzzles = safeParsePuzzles(localStorage.getItem(PUZZLES_KEY) || "[]");
  } catch {
    state.puzzles = [];
  }
  renderPuzzles();
}

function persistPuzzles() {
  localStorage.setItem(PUZZLES_KEY, JSON.stringify(state.puzzles));
}

function stopAutoPlay() {
  if (!state.autoPlayTimer) return;
  clearInterval(state.autoPlayTimer);
  state.autoPlayTimer = null;
  el.playBtn.textContent = "Auto Play";
}
