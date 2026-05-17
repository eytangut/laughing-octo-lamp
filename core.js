export function parseModelTierList(raw) {
  return [...new Set((raw || "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean))];
}

export function isFallbackWorthyError(status, message = "") {
  const m = String(message).toLowerCase();
  return status === 429 || m.includes("quota") || m.includes("rate") || m.includes("resource_exhausted") || m.includes("limit");
}

export function classifyFallback(move, ply) {
  if (ply <= 8) return "book";
  if (/[+#]$/.test(move.san)) return "brilliant";
  if (/x/.test(move.san) && ply % 5 === 0) return "miss";
  if (ply % 9 === 0) return "blunder";
  if (ply % 4 === 0) return "inaccuracy";
  return "good";
}

export function fallbackAnalysis(verboseMoves) {
  return verboseMoves.map((m, i) => ({
    ply: i + 1,
    classification: classifyFallback(m, i + 1),
    comment: `On ${m.san}, keep an eye on king safety and piece activity.`,
    altMove: null,
    focusSquares: [m.from, m.to]
  }));
}

export function makePuzzleFromAnalysis(item, fen, index) {
  return {
    id: `${Date.now()}-${index}`,
    fen,
    question: `Find a better plan around ply ${item.ply}.`,
    bestMove: item.altMove || "(see explanation)",
    explanation: item.comment,
    wrongMoves: [{ move: "passive move", whyWrong: "It keeps the same structural weakness." }],
    difficulty: ["blunder", "miss"].includes(item.classification) ? "hard" : "medium",
    intervalDays: 1,
    dueAt: new Date().toISOString()
  };
}

export function scheduleFlashcard(card, quality) {
  const qualityMap = { again: 0.5, hard: 1.2, good: 2, easy: 3 };
  const mult = qualityMap[quality] || 1;
  const nextInterval = Math.max(1, Math.round((card.intervalDays || 1) * mult));
  const due = new Date(Date.now() + nextInterval * 86400000).toISOString();
  return { ...card, intervalDays: nextInterval, dueAt: due };
}

export function safeParsePuzzles(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Invalid puzzle deck format");
  return parsed.filter((p) => p && p.id && p.question && p.explanation);
}
