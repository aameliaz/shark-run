import { useState, useEffect, useRef, useCallback } from "react";

const W = 360, H = 640;
const LANE_COUNT = 3, LANE_W = W / LANE_COUNT;
const RUNNER_Y = H - 90, RUNNER_SZ = 24;
const OBS_W = 75, OBS_H = 28, FISH_SZ = 13, COIN_SZ = 10;
const REVIVE_COST = 8;

const DIFF = {
  beginner: { speed: 2, inc: 0.001, max: 3.2, obsInt: 100, fishInt: 45, coinInt: 70 },
  intermediate: { speed: 3.5, inc: 0.002, max: 5.5, obsInt: 70, fishInt: 38, coinInt: 55 },
  expert: { speed: 5, inc: 0.004, max: 8, obsInt: 45, fishInt: 30, coinInt: 45 },
};

const COMBO_TH = [0, 3, 6, 10, 15];
const getMult = (c) => { if (c >= 15) return 5; if (c >= 10) return 4; if (c >= 6) return 3; if (c >= 3) return 2; return 1; };

// Pastel dreamlike palette
const P = {
  bg1: "#e8d5c4", bg2: "#c9b8d4", bg3: "#b0c4de",
  water1: "#d4e6f1", water2: "#c5d9e8", water3: "#b8ccd9",
  shark: "#7a8fa6", sharkBelly: "#e8e0d8", sharkFin: "#6b7d8f",
  fish: ["#f4a6b0", "#a6d4c8", "#c4b0e0", "#f4d4a0", "#a6c8e4"],
  coin: "#f0d080", coinEdge: "#d4b060", coinShine: "#faf0d0",
  coral: ["#e8a0a8", "#d4a088", "#c0a8c4", "#a8c0a0", "#d4c0a0"],
  coralTip: "#f8f0e8",
  seaweed: ["#88b4a0", "#78a090", "#98c0a8"],
  sand: "#d8c8b0",
  bubble: "rgba(200,220,240,0.3)",
  text: "#5a4a3a",
  textLight: "rgba(90,74,58,0.5)",
  heart: "#d4808c",
  heartEmpty: "rgba(212,128,140,0.2)",
  streak: ["#7a8fa6", "#88b4cc", "#a088c4", "#c488a0", "#d4c080"],
};

// Storage
const loadUsername = async () => { try { return localStorage.getItem("shark-run-username") || ""; } catch { return ""; } };
const saveUsername = async (n) => { try { localStorage.setItem("shark-run-username", n); } catch {} };
const saveScore = async (username, d, diff) => {
  try {
    const key = `shark-lb:${username}:${diff}`;
    const prev = JSON.parse(localStorage.getItem(key) || "null") || { username, difficulty: diff, bestScore: 0, bestFish: 0, bestStreak: 0, bestCoins: 0 };
    const updated = { username, difficulty: diff, bestScore: Math.max(prev.bestScore, d.score), bestFish: Math.max(prev.bestFish, d.fish), bestStreak: Math.max(prev.bestStreak, d.streak), bestCoins: Math.max(prev.bestCoins, d.coins), lastPlayed: Date.now() };
    localStorage.setItem(key, JSON.stringify(updated));
    const keys = JSON.parse(localStorage.getItem("shark-lb-keys") || "[]");
    if (!keys.includes(key)) { keys.push(key); localStorage.setItem("shark-lb-keys", JSON.stringify(keys)); }
  } catch {}
};
const loadLeaderboard = async () => {
  try {
    const keys = JSON.parse(localStorage.getItem("shark-lb-keys") || "[]");
    return keys.map(k => JSON.parse(localStorage.getItem(k))).filter(Boolean).sort((a, b) => b.bestScore - a.bestScore).slice(0, 15);
  } catch { return []; }
};

export default function SharkRunPainterly() {
  const [gs, setGs] = useState("start");
  const [score, setScore] = useState(0);
  const [fishEaten, setFishEaten] = useState(0);
  const [coins, setCoins] = useState(0);
  const [lives, setLives] = useState(3);
  const [combo, setCombo] = useState(0);
  const [mult, setMult] = useState(1);
  const [maxCombo, setMaxCombo] = useState(0);
  const [hiScore, setHiScore] = useState(0);
  const [hiCoins, setHiCoins] = useState(0);
  const [canRevive, setCanRevive] = useState(false);
  const [multFlash, setMultFlash] = useState(0);
  const [username, setUsername] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [showLB, setShowLB] = useState(false);
  const [lb, setLb] = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const [lastDiff, setLastDiff] = useState("beginner");
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const gRef = useRef(null);

  useEffect(() => { loadUsername().then(n => { if (n) { setUsername(n); setNameInput(n); } }); }, []);

  const handleShare = async () => {
    const dn = { beginner: "SHALLOW", intermediate: "DEEP", expert: "ABYSS" };
    const msg = `🎨 SHARK RUN 🦈\nLevel: ${dn[lastDiff]||"?"} | Dist: ${score} | Fish: ${fishEaten} | Streak: ${maxCombo} | Coins: ${coins}\nCan you beat my score?`;
    if (navigator.share) {
      try { await navigator.share({ title: "Shark Run", text: msg, url: "https://shark-run.vercel.app/" }); setShareMsg("Shared!"); } catch (e) { if (e.name !== "AbortError") setShareMsg("Couldn't share"); }
    } else {
      try { await navigator.clipboard.writeText(msg + "\n\nPlay here: https://shark-run.vercel.app/"); setShareMsg("Copied!"); } catch { setShareMsg("Couldn't copy"); }
    }
    setTimeout(() => setShareMsg(""), 2000);
  };

  const handleSave = async () => {
    const n = nameInput.trim(); if (!n) return;
    setUsername(n); await saveUsername(n);
    await saveScore(n, { score, fish: fishEaten, streak: maxCombo, coins }, lastDiff);
    setSaved(true);
  };

  const handleLB = async () => { setLbLoading(true); setLb(await loadLeaderboard()); setLbLoading(false); setShowLB(true); };

  const getLaneX = (l) => l * LANE_W + LANE_W / 2;
  const getStreakColor = (c) => { for (let i = COMBO_TH.length - 1; i >= 0; i--) { if (c >= COMBO_TH[i]) return P.streak[i]; } return P.streak[0]; };

  // Painterly brush stroke helper
  const brushRect = (ctx, x, y, w, h, color, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    // Main shape with soft edges
    ctx.beginPath();
    ctx.moveTo(x + 2, y);
    ctx.quadraticCurveTo(x + w / 2, y - 1.5, x + w - 2, y);
    ctx.quadraticCurveTo(x + w + 1, y + h / 2, x + w - 2, y + h);
    ctx.quadraticCurveTo(x + w / 2, y + h + 1.5, x + 2, y + h);
    ctx.quadraticCurveTo(x - 1, y + h / 2, x + 2, y);
    ctx.fill();
    ctx.restore();
  };

  // Soft circle
  const softCircle = (ctx, x, y, r, color, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, color);
    grad.addColorStop(0.7, color);
    grad.addColorStop(1, color + "00");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const drawBG = (ctx, frame, speed) => {
    // Watercolor gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, P.bg3);
    bgGrad.addColorStop(0.3, P.water1);
    bgGrad.addColorStop(0.6, P.water2);
    bgGrad.addColorStop(1, P.water3);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Impressionist light dapples
    for (let i = 0; i < 8; i++) {
      const dx = Math.sin(frame * 0.003 + i * 1.7) * 40 + (i * 47) % W;
      const dy = Math.cos(frame * 0.004 + i * 2.1) * 30 + (i * 83) % H;
      softCircle(ctx, dx, dy, 30 + Math.sin(frame * 0.005 + i) * 10, "#f8f0e0", 0.06);
    }

    // Soft watercolor blobs for atmosphere
    for (let i = 0; i < 5; i++) {
      const bx = (i * 97 + 30) % W;
      const by = (i * 143 + 100) % H;
      softCircle(ctx, bx, by, 50 + i * 10, i % 2 === 0 ? "#d8c8e0" : "#c8d8c8", 0.04);
    }

    // Soft lane dividers - brushstroke style
    for (let i = 1; i < LANE_COUNT; i++) {
      const x = i * LANE_W;
      ctx.strokeStyle = "rgba(160,140,120,0.12)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([12, 18]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Flowing water current lines - impressionist strokes
    const offset = (frame * speed * 1.5) % 50;
    ctx.strokeStyle = "rgba(180,200,220,0.08)";
    ctx.lineWidth = 2;
    for (let y = -50 + offset; y < H; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < W; x += 15) {
        ctx.lineTo(x, y + Math.sin(x * 0.025 + frame * 0.015) * 6);
      }
      ctx.stroke();
    }

    // Bubbles - soft watercolor circles
    for (let i = 0; i < 6; i++) {
      const bx = (Math.sin(frame * 0.008 + i * 2.5) * 0.5 + 0.5) * W;
      const by = ((frame * 0.3 + i * 110) % (H + 40)) - 20;
      ctx.strokeStyle = P.bubble;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bx, H - by, 3 + i * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Seaweed at edges - painterly strokes
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -10 : W + 10;
      const sx = side + (i < 3 ? 1 : -1) * (10 + (i % 3) * 12);
      const baseY = H - 20 - (i % 3) * 40;
      const sway = Math.sin(frame * 0.01 + i) * 5;
      ctx.strokeStyle = P.seaweed[i % 3];
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, baseY);
      ctx.quadraticCurveTo(sx + sway, baseY - 30, sx + sway * 1.5, baseY - 50 - (i % 3) * 15);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Sandy bottom - soft gradient
    const sandGrad = ctx.createLinearGradient(0, H - 15, 0, H);
    sandGrad.addColorStop(0, "rgba(216,200,176,0)");
    sandGrad.addColorStop(1, "rgba(216,200,176,0.15)");
    ctx.fillStyle = sandGrad;
    ctx.fillRect(0, H - 15, W, 15);
  };

  const drawShark = (ctx, lane, invincible, comboCount, frame) => {
    const x = getLaneX(lane);
    const y = RUNNER_Y + Math.sin(frame * 0.04) * 3;
    const blink = invincible > 0 && Math.floor(invincible / 5) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.3;

    const sc = getStreakColor(comboCount);

    // Combo glow aura
    if (comboCount >= 3) {
      softCircle(ctx, x, y, RUNNER_SZ + comboCount * 1.5, sc, 0.12);
    }

    // Shark body - soft painterly style
    ctx.fillStyle = P.shark;
    ctx.beginPath();
    ctx.moveTo(x, y - RUNNER_SZ * 1.1); // nose
    ctx.quadraticCurveTo(x + RUNNER_SZ * 0.8, y - RUNNER_SZ * 0.2, x + RUNNER_SZ * 0.55, y + RUNNER_SZ * 0.4);
    ctx.quadraticCurveTo(x + RUNNER_SZ * 0.3, y + RUNNER_SZ * 0.65, x, y + RUNNER_SZ * 0.5);
    ctx.quadraticCurveTo(x - RUNNER_SZ * 0.3, y + RUNNER_SZ * 0.65, x - RUNNER_SZ * 0.55, y + RUNNER_SZ * 0.4);
    ctx.quadraticCurveTo(x - RUNNER_SZ * 0.8, y - RUNNER_SZ * 0.2, x, y - RUNNER_SZ * 1.1);
    ctx.fill();

    // Belly - lighter
    ctx.fillStyle = P.sharkBelly;
    ctx.globalAlpha = blink ? 0.2 : 0.6;
    ctx.beginPath();
    ctx.ellipse(x, y + RUNNER_SZ * 0.1, RUNNER_SZ * 0.35, RUNNER_SZ * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = blink ? 0.3 : 1;

    // Dorsal fin
    ctx.fillStyle = P.sharkFin;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - RUNNER_SZ * 0.3);
    ctx.lineTo(x, y - RUNNER_SZ * 1.4);
    ctx.lineTo(x + 5, y - RUNNER_SZ * 0.2);
    ctx.closePath();
    ctx.fill();

    // Tail
    ctx.beginPath();
    const tailWag = Math.sin(frame * 0.1) * 3;
    ctx.moveTo(x - 2, y + RUNNER_SZ * 0.4);
    ctx.lineTo(x - RUNNER_SZ * 0.4 + tailWag, y + RUNNER_SZ * 1.1);
    ctx.lineTo(x + RUNNER_SZ * 0.4 + tailWag, y + RUNNER_SZ * 1.1);
    ctx.lineTo(x + 2, y + RUNNER_SZ * 0.4);
    ctx.fill();

    // Side fins
    ctx.beginPath();
    ctx.moveTo(x - RUNNER_SZ * 0.5, y + RUNNER_SZ * 0.1);
    ctx.lineTo(x - RUNNER_SZ * 0.9, y + RUNNER_SZ * 0.3);
    ctx.lineTo(x - RUNNER_SZ * 0.4, y + RUNNER_SZ * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + RUNNER_SZ * 0.5, y + RUNNER_SZ * 0.1);
    ctx.lineTo(x + RUNNER_SZ * 0.9, y + RUNNER_SZ * 0.3);
    ctx.lineTo(x + RUNNER_SZ * 0.4, y + RUNNER_SZ * 0.25);
    ctx.closePath();
    ctx.fill();

    // Eyes - anime style, larger
    ctx.fillStyle = "#f8f4f0";
    ctx.beginPath();
    ctx.ellipse(x + RUNNER_SZ * 0.22, y - RUNNER_SZ * 0.4, 4.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x - RUNNER_SZ * 0.22, y - RUNNER_SZ * 0.4, 4.5, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Pupils
    ctx.fillStyle = "#2a2a3a";
    ctx.beginPath();
    ctx.arc(x + RUNNER_SZ * 0.22, y - RUNNER_SZ * 0.38, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - RUNNER_SZ * 0.22, y - RUNNER_SZ * 0.38, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Eye shine - anime sparkle
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + RUNNER_SZ * 0.25, y - RUNNER_SZ * 0.43, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - RUNNER_SZ * 0.19, y - RUNNER_SZ * 0.43, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Smile when combo high
    if (comboCount >= 6) {
      ctx.strokeStyle = "#4a3a3a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y - RUNNER_SZ * 0.6, 4, 0.1, Math.PI - 0.1);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  };

  const drawSmallFish = (ctx, fish, frame) => {
    const x = getLaneX(fish.lane);
    const y = fish.y;
    const color = P.fish[fish.ci];

    // Soft glow ring
    softCircle(ctx, x, y, FISH_SZ + 6, color, 0.1);

    // Body - anime-style rounded fish
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, FISH_SZ, FISH_SZ * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tail
    ctx.beginPath();
    ctx.moveTo(x - FISH_SZ * 0.7, y);
    ctx.lineTo(x - FISH_SZ * 1.3, y - FISH_SZ * 0.4);
    ctx.lineTo(x - FISH_SZ * 1.3, y + FISH_SZ * 0.4);
    ctx.closePath();
    ctx.fill();

    // Dorsal
    ctx.beginPath();
    ctx.moveTo(x - 2, y - FISH_SZ * 0.4);
    ctx.lineTo(x + 2, y - FISH_SZ * 0.8);
    ctx.lineTo(x + 5, y - FISH_SZ * 0.35);
    ctx.closePath();
    ctx.fill();

    // Eye - big anime eye
    ctx.fillStyle = "#f8f4f0";
    ctx.beginPath();
    ctx.arc(x + FISH_SZ * 0.4, y - FISH_SZ * 0.05, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a2a3a";
    ctx.beginPath();
    ctx.arc(x + FISH_SZ * 0.43, y - FISH_SZ * 0.05, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + FISH_SZ * 0.46, y - FISH_SZ * 0.1, 0.8, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawCoin = (ctx, coin, frame) => {
    const x = getLaneX(coin.lane);
    const y = coin.y;
    const pulse = Math.sin(frame * 0.05 + y * 0.02) * 1.5;

    // Outer glow
    softCircle(ctx, x, y, COIN_SZ + 6 + pulse, P.coin, 0.12);

    // Coin body
    ctx.fillStyle = P.coin;
    ctx.beginPath();
    ctx.arc(x, y, COIN_SZ + pulse, 0, Math.PI * 2);
    ctx.fill();

    // Edge
    ctx.strokeStyle = P.coinEdge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, COIN_SZ + pulse, 0, Math.PI * 2);
    ctx.stroke();

    // Shine
    ctx.fillStyle = P.coinShine;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(x - 2, y - 2, COIN_SZ * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Star
    ctx.fillStyle = P.coinEdge;
    ctx.font = `bold ${COIN_SZ - 1}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("★", x, y + 1);
  };

  const drawCoral = (ctx, obs) => {
    const x = getLaneX(obs.lane);
    const y = obs.y + OBS_H / 2;
    const color = P.coral[obs.ci];

    // Base rock
    ctx.fillStyle = "rgba(160,148,130,0.5)";
    ctx.beginPath();
    ctx.ellipse(x, y + OBS_H * 0.3, OBS_W * 0.45, OBS_H * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main coral body - organic blobs
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x - 8, y - 2, 14, 12, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 10, y, 12, 10, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y - 6, 10, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Branch tips - white highlights
    ctx.fillStyle = P.coralTip;
    ctx.globalAlpha = 0.7;
    [-12, -2, 8, 14].forEach((dx, i) => {
      ctx.beginPath();
      ctx.arc(x + dx, y - 12 - (i % 2) * 4, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Soft painterly outline
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y - 2, OBS_W * 0.35, OBS_H * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const drawLives = (ctx, n) => {
    for (let i = 0; i < 3; i++) {
      const hx = 22 + i * 22, hy = 22;
      ctx.fillStyle = i < n ? P.heart : P.heartEmpty;
      ctx.beginPath();
      const s = 7;
      ctx.moveTo(hx, hy + s * 0.3);
      ctx.bezierCurveTo(hx, hy - s * 0.3, hx - s, hy - s * 0.3, hx - s, hy + s * 0.1);
      ctx.bezierCurveTo(hx - s, hy + s * 0.6, hx, hy + s, hx, hy + s * 1.1);
      ctx.bezierCurveTo(hx, hy + s, hx + s, hy + s * 0.6, hx + s, hy + s * 0.1);
      ctx.bezierCurveTo(hx + s, hy - s * 0.3, hx, hy - s * 0.3, hx, hy + s * 0.3);
      ctx.fill();
    }
  };

  const drawHUD = (ctx, d) => {
    drawLives(ctx, d.lives);

    // Combo meter
    if (d.combo > 0) {
      const color = getStreakColor(d.combo);
      const barX = 15, barY = 48, barW = 70, barH = 4;
      const next = COMBO_TH.find(t => t > d.combo) || d.combo + 5;
      const prev = [...COMBO_TH].reverse().find(t => t <= d.combo) || 0;
      const prog = (d.combo - prev) / (next - prev);
      ctx.fillStyle = "rgba(160,140,120,0.15)";
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = color;
      ctx.fillRect(barX, barY, barW * prog, barH);
      ctx.fillStyle = color;
      ctx.font = "bold 10px 'Georgia', serif";
      ctx.textAlign = "left";
      ctx.fillText(`🪙x${d.multiplier}`, barX + barW + 4, barY + 5);
      ctx.fillStyle = P.textLight;
      ctx.font = "8px 'Georgia', serif";
      ctx.fillText(`${d.combo} streak`, barX, barY - 3);
    }

    // Stats
    ctx.font = "9px 'Georgia', serif";
    ctx.textAlign = "right";
    ctx.fillStyle = P.textLight;
    ctx.fillText("FISH", W / 2 - 10, 15);
    ctx.fillStyle = "#78a090";
    ctx.font = "bold 16px 'Georgia', serif";
    ctx.fillText(`${d.fishCount}`, W / 2 - 10, 32);

    ctx.font = "9px 'Georgia', serif";
    ctx.fillStyle = P.textLight;
    ctx.textAlign = "center";
    ctx.fillText("COINS", W / 2 + 40, 15);
    ctx.fillStyle = P.coinEdge;
    ctx.font = "bold 16px 'Georgia', serif";
    ctx.fillText(`${d.coinCount}`, W / 2 + 40, 32);

    ctx.font = "9px 'Georgia', serif";
    ctx.fillStyle = P.textLight;
    ctx.textAlign = "right";
    ctx.fillText("DIST", W - 18, 15);
    ctx.fillStyle = P.shark;
    ctx.font = "bold 16px 'Georgia', serif";
    ctx.fillText(`${d.score}`, W - 18, 32);
  };

  const drawMultDisp = (ctx, m, timer, comboCount) => {
    if (timer <= 0) return;
    const alpha = Math.min(timer / 10, 1);
    const scale = 1 + (1 - alpha) * 0.3;
    const color = getStreakColor(comboCount);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H / 2 - 40);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.font = "bold 52px 'Georgia', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`x${m}`, 0, 0);
    ctx.fillStyle = P.coinEdge;
    ctx.font = "bold 13px 'Georgia', serif";
    ctx.fillText(m >= 5 ? "FRENZY!" : m >= 4 ? "COIN RUSH!" : m >= 3 ? "x3 COINS!" : "x2 COINS!", 0, 32);
    ctx.restore();
    ctx.globalAlpha = 1;
  };

  const drawPopup = (ctx, p) => {
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.font = `bold ${p.size || 13}px 'Georgia', serif`;
    ctx.textAlign = "center";
    ctx.fillText(p.text, p.x, p.y - (p.maxLife - p.life) * 1.1);
    ctx.globalAlpha = 1;
  };

  const resetGame = useCallback((diff) => {
    const s = DIFF[diff];
    gRef.current = {
      lane: 1, obstacles: [], fishes: [], coins: [], frame: 0,
      speed: s.speed, inc: s.inc, maxSpeed: s.max, obsInt: s.obsInt, fishInt: s.fishInt, coinInt: s.coinInt,
      score: 0, fishCount: 0, coinCount: 0, lives: 3, combo: 0, maxCombo: 0, multiplier: 1,
      invincible: 0, flash: 0, shake: 0, popups: [], multDisp: 0, trail: [],
    };
    setScore(0); setFishEaten(0); setCoins(0); setLives(3);
    setCombo(0); setMult(1); setMaxCombo(0);
    setCanRevive(false); setMultFlash(0); setSaved(false); setShowLB(false); setShareMsg("");
  }, []);

  const startGame = useCallback((diff) => { setLastDiff(diff); resetGame(diff); setGs("playing"); }, [resetGame]);

  const revive = useCallback(() => {
    const g = gRef.current;
    if (g && g.coinCount >= REVIVE_COST) {
      g.coinCount -= REVIVE_COST; g.lives = 1; g.invincible = 90; g.combo = 0; g.multiplier = 1;
      g.obstacles = g.obstacles.filter(o => o.y < RUNNER_Y - 100 || o.y > RUNNER_Y + 50);
      setCoins(g.coinCount); setLives(1); setCombo(0); setMult(1); setGs("playing");
    }
  }, []);

  const gameLoop = useCallback(() => {
    const cvs = canvasRef.current; if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const g = gRef.current;

    ctx.save();
    if (g.shake > 0) {
      ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
      g.shake *= 0.85; if (g.shake < 0.5) g.shake = 0;
    }

    g.frame++;
    drawBG(ctx, g.frame, g.speed);

    if (g.flash > 0) {
      ctx.fillStyle = `rgba(212,128,140,${g.flash / 25})`;
      ctx.fillRect(0, 0, W, H);
      g.flash--;
    }

    // Spawning
    if (g.frame % g.obsInt === 0) g.obstacles.push({ lane: Math.floor(Math.random() * LANE_COUNT), y: -OBS_H, ci: Math.floor(Math.random() * P.coral.length), nearMissed: false });
    if (g.frame % g.fishInt === 0) {
      const ln = Math.floor(Math.random() * LANE_COUNT);
      if (!g.obstacles.some(o => o.lane === ln && o.y < 50 && o.y > -50))
        g.fishes.push({ lane: ln, y: -FISH_SZ, ci: Math.floor(Math.random() * P.fish.length), missed: false, mp: false });
    }
    if (g.frame % g.coinInt === 0) {
      const ln = Math.floor(Math.random() * LANE_COUNT);
      if (!g.obstacles.some(o => o.lane === ln && o.y < 50 && o.y > -50))
        g.coins.push({ lane: ln, y: -COIN_SZ });
    }

    // Update
    if (g.speed < g.maxSpeed) g.speed += g.inc;
    g.score += 1;

    g.obstacles = g.obstacles.filter(o => { o.y += g.speed; return o.y < H + OBS_H; });
    g.fishes = g.fishes.filter(f => {
      f.y += g.speed;
      if (f.y > RUNNER_Y + RUNNER_SZ * 1.5 && !f.missed) f.missed = true;
      return f.y < H + FISH_SZ;
    });
    const missed = g.fishes.filter(f => f.missed && !f.mp);
    if (missed.length > 0) {
      missed.forEach(f => f.mp = true);
      if (g.combo > 0) {
        g.popups.push({ text: "STREAK LOST!", x: W / 2, y: RUNNER_Y - 50, life: 28, maxLife: 28, color: P.heart, size: 13 });
        g.combo = 0; g.multiplier = 1; setCombo(0); setMult(1);
      }
    }
    g.coins = g.coins.filter(c => { c.y += g.speed; return c.y < H + COIN_SZ; });
    g.popups = g.popups.filter(p => { p.life--; return p.life > 0; });
    if (g.multDisp > 0) g.multDisp--;

    // Trail
    if (g.combo >= 3 && g.frame % 2 === 0) {
      g.trail.push({ x: getLaneX(g.lane), y: RUNNER_Y + RUNNER_SZ, life: 12 });
    }
    g.trail = g.trail.filter(t => { t.life--; return t.life > 0; });

    // Draw trail
    g.trail.forEach(t => {
      softCircle(ctx, t.x, t.y, RUNNER_SZ * 0.25 * (t.life / 12), getStreakColor(g.combo), (t.life / 12) * 0.2);
    });

    // Draw objects
    g.obstacles.forEach(o => drawCoral(ctx, o));
    g.fishes.forEach(f => { if (!f.missed) drawSmallFish(ctx, f, g.frame); });
    g.coins.forEach(c => drawCoin(ctx, c, g.frame));
    g.popups.forEach(p => drawPopup(ctx, p));
    drawShark(ctx, g.lane, g.invincible, g.combo, g.frame);
    drawMultDisp(ctx, g.multiplier, g.multDisp, g.combo);
    drawHUD(ctx, g);

    // Collisions
    const rx = getLaneX(g.lane), rt = RUNNER_Y - RUNNER_SZ * 1.1, rb = RUNNER_Y + RUNNER_SZ * 0.5;
    const rl = rx - RUNNER_SZ * 0.55, rr = rx + RUNNER_SZ * 0.55;

    // Fish collection
    g.fishes = g.fishes.filter(f => {
      if (f.missed) return true;
      const fx = getLaneX(f.lane);
      if (Math.sqrt((rx - fx) ** 2 + (RUNNER_Y - f.y) ** 2) < RUNNER_SZ + FISH_SZ) {
        g.fishCount++; g.combo++;
        if (g.combo > g.maxCombo) g.maxCombo = g.combo;
        const nm = getMult(g.combo);
        if (nm > g.multiplier) g.multDisp = 45;
        g.multiplier = nm;
        setFishEaten(g.fishCount); setCombo(g.combo); setMult(g.multiplier); setMaxCombo(g.maxCombo);
        g.popups.push({ text: "+1 🐟", x: fx, y: f.y, life: 22, maxLife: 22, color: P.fish[f.ci], size: 12 });
        return false;
      }
      return true;
    });

    // Coin collection
    g.coins = g.coins.filter(c => {
      const cx = getLaneX(c.lane);
      if (Math.sqrt((rx - cx) ** 2 + (RUNNER_Y - c.y) ** 2) < RUNNER_SZ + COIN_SZ) {
        g.coinCount += g.multiplier;
        setCoins(g.coinCount);
        g.popups.push({ text: g.multiplier > 1 ? `+${g.multiplier} 🪙` : "+1 🪙", x: cx, y: c.y, life: 22, maxLife: 22, color: P.coinEdge, size: g.multiplier > 1 ? 16 : 12 });
        return false;
      }
      return true;
    });

    // Near miss
    g.obstacles.forEach(o => {
      if (o.nearMissed) return;
      if (Math.abs(o.y + OBS_H / 2 - RUNNER_Y) < OBS_H && Math.abs(o.lane - g.lane) === 1) {
        o.nearMissed = true; g.score += 5;
      }
    });

    // Invincibility
    if (g.invincible > 0) g.invincible--;

    // Obstacle collision
    if (g.invincible === 0) {
      for (const o of g.obstacles) {
        const ol = getLaneX(o.lane) - OBS_W / 2, or2 = ol + OBS_W;
        if (rr > ol && rl < or2 && rb > o.y && rt < o.y + OBS_H) {
          g.lives--; g.flash = 15; g.shake = 10;
          if (g.combo > 0) g.popups.push({ text: "STREAK LOST!", x: W / 2, y: RUNNER_Y - 55, life: 30, maxLife: 30, color: P.heart, size: 14 });
          g.combo = 0; g.multiplier = 1;
          setLives(g.lives); setCombo(0); setMult(1);
          if (g.lives <= 0) {
            setScore(g.score); setFishEaten(g.fishCount); setCoins(g.coinCount);
            setHiScore(p => Math.max(p, g.score)); setHiCoins(p => Math.max(p, g.coinCount));
            setMaxCombo(g.maxCombo); setCanRevive(g.coinCount >= REVIVE_COST);
            setGs("gameover"); ctx.restore(); return;
          } else {
            g.invincible = 90;
            g.obstacles = g.obstacles.filter(ob => ob !== o);
            break;
          }
        }
      }
    }

    setScore(g.score);
    ctx.restore();
    frameRef.current = requestAnimationFrame(gameLoop);
  }, []);

  useEffect(() => {
    if (gs === "playing") frameRef.current = requestAnimationFrame(gameLoop);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [gs, gameLoop]);

  useEffect(() => {
    const h = (e) => {
      if (gs === "playing" && gRef.current) {
        if ((e.key === "ArrowLeft" || e.key === "a") && gRef.current.lane > 0) gRef.current.lane--;
        if ((e.key === "ArrowRight" || e.key === "d") && gRef.current.lane < LANE_COUNT - 1) gRef.current.lane++;
        if (e.key === "Escape") { setGs("start"); if (frameRef.current) cancelAnimationFrame(frameRef.current); }
      }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [gs]);

  const panelBg = "rgba(248,244,238,0.95)";
  const btnBase = { background: "rgba(122,143,166,0.08)", color: P.text, border: `1px solid rgba(122,143,166,0.2)`, padding: "11px 18px", borderRadius: "10px", fontSize: "13px", fontFamily: "'Georgia', serif", cursor: "pointer", width: "210px", textAlign: "left" };

  const Btn = ({ diff, label, desc }) => (
    <button onClick={() => startGame(diff)} style={btnBase}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(122,143,166,0.15)"; e.currentTarget.style.borderColor = P.shark; }}
      onMouseLeave={e => { e.currentTarget.style.background = "rgba(122,143,166,0.08)"; e.currentTarget.style.borderColor = "rgba(122,143,166,0.2)"; }}>
      <div style={{ fontWeight: "bold", letterSpacing: "1.5px", marginBottom: "3px", fontSize: "12px" }}>{label}</div>
      <div style={{ fontSize: "10px", color: P.textLight }}>{desc}</div>
    </button>
  );

  const diffColors = { beginner: "#78a090", intermediate: "#d4a060", expert: "#c47080" };
  const diffLabels = { beginner: "SHLW", intermediate: "DEEP", expert: "ABYS" };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#e8e0d8", fontFamily: "'Georgia', serif" }}>
      <div style={{ position: "relative" }}>
        <canvas ref={canvasRef} width={W} height={H} style={{ border: "2px solid rgba(160,140,120,0.2)", borderRadius: "14px", display: "block", boxShadow: "0 4px 20px rgba(120,100,80,0.1)" }} />

        {gs === "playing" && (
          <div style={{ display: "flex", gap: "14px", position: "absolute", bottom: "-55px", left: "50%", transform: "translateX(-50%)" }}>
            <button onPointerDown={() => { if (gRef.current && gRef.current.lane > 0) gRef.current.lane--; }}
              style={{ background: "rgba(122,143,166,0.1)", color: P.text, border: "1px solid rgba(122,143,166,0.2)", padding: "12px 24px", borderRadius: "10px", fontSize: "18px", fontFamily: "'Georgia', serif", cursor: "pointer", userSelect: "none", touchAction: "manipulation" }}>← left</button>
            <button onPointerDown={() => { if (gRef.current && gRef.current.lane < LANE_COUNT - 1) gRef.current.lane++; }}
              style={{ background: "rgba(122,143,166,0.1)", color: P.text, border: "1px solid rgba(122,143,166,0.2)", padding: "12px 24px", borderRadius: "10px", fontSize: "18px", fontFamily: "'Georgia', serif", cursor: "pointer", userSelect: "none", touchAction: "manipulation" }}>right →</button>
          </div>
        )}

        {gs === "start" && (
          <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: panelBg, borderRadius: "14px", gap: "10px" }}>
            <div style={{ fontSize: "28px", fontWeight: "bold", color: P.shark, letterSpacing: "3px" }}>🦈 shark run</div>
            <div style={{ color: P.textLight, fontSize: "11px", textAlign: "center", lineHeight: "1.7", padding: "0 30px" }}>
              eat small fish to build streaks<br />streaks multiply coin rewards<br />miss a fish = streak resets<br />avoid coral · coins = extra lives
            </div>
            <div style={{ color: P.textLight, fontSize: "10px", letterSpacing: "2px", marginTop: "2px" }}>select depth</div>
            <Btn diff="beginner" label="SHALLOW" desc="calm waters, easy catches" />
            <Btn diff="intermediate" label="DEEP" desc="faster currents, more coral" />
            <Btn diff="expert" label="ABYSS" desc="maximum speed, survive" />
            <div style={{ color: P.textLight, fontSize: "9px", marginTop: "4px" }}>← → or A/D to swim · ESC to surface</div>
          </div>
        )}

        {gs === "gameover" && !showLB && (
          <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: panelBg, borderRadius: "14px", gap: "5px" }}>
            <div style={{ color: P.heart, fontSize: "22px", fontWeight: "bold", letterSpacing: "2px" }}>oh no!</div>
            <div style={{ display: "flex", gap: "12px", margin: "4px 0" }}>
              {[["DIST", score, P.shark, hiScore], ["FISH", fishEaten, "#78a090"], ["STREAK", maxCombo, getStreakColor(maxCombo)], ["COINS", coins, P.coinEdge, hiCoins]].map(([l, v, c, best], i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  <div style={{ color: P.textLight, fontSize: "9px" }}>{l}</div>
                  <div style={{ color: c, fontSize: "16px", fontWeight: "bold" }}>{v}</div>
                  {best !== undefined && <div style={{ color: P.textLight, fontSize: "8px" }}>best: {best}</div>}
                </div>
              ))}
            </div>
            {!saved ? (
              <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "2px" }}>
                <input type="text" placeholder="your name" maxLength={12} value={nameInput} onChange={e => setNameInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
                  style={{ background: "rgba(122,143,166,0.08)", border: "1px solid rgba(122,143,166,0.25)", borderRadius: "8px", padding: "7px 10px", color: P.text, fontSize: "12px", fontFamily: "'Georgia', serif", width: "110px", outline: "none" }} />
                <button onClick={handleSave} style={{ background: "rgba(122,143,166,0.1)", color: P.shark, border: "1px solid rgba(122,143,166,0.3)", padding: "7px 12px", borderRadius: "8px", fontSize: "11px", fontFamily: "'Georgia', serif", fontWeight: "bold", cursor: "pointer" }}>SAVE</button>
              </div>
            ) : (
              <div style={{ color: "#78a090", fontSize: "11px", marginTop: "2px" }}>✓ saved as {username}</div>
            )}
            <div style={{ display: "flex", gap: "8px", marginTop: "3px" }}>
              <button onClick={handleShare} style={{ background: "rgba(122,143,166,0.08)", color: P.shark, border: "1px solid rgba(122,143,166,0.2)", padding: "7px 12px", borderRadius: "8px", fontSize: "10px", fontFamily: "'Georgia', serif", fontWeight: "bold", cursor: "pointer" }}>📤 share</button>
              <button onClick={handleLB} style={{ background: "rgba(240,208,128,0.15)", color: P.coinEdge, border: "1px solid rgba(212,176,96,0.3)", padding: "7px 12px", borderRadius: "8px", fontSize: "10px", fontFamily: "'Georgia', serif", fontWeight: "bold", cursor: "pointer" }}>🏆 leaderboard</button>
            </div>
            {shareMsg && <div style={{ color: "#78a090", fontSize: "10px" }}>{shareMsg}</div>}
            {canRevive && (
              <button onClick={revive} style={{ background: "rgba(240,208,128,0.15)", color: P.coinEdge, border: "2px solid " + P.coinEdge, padding: "7px 14px", borderRadius: "8px", fontSize: "11px", fontFamily: "'Georgia', serif", fontWeight: "bold", cursor: "pointer", marginTop: "2px" }}>🪙 revive ({REVIVE_COST} coins)</button>
            )}
            <button onClick={() => startGame(lastDiff)} style={{ background: "rgba(122,143,166,0.1)", color: P.shark, border: "1px solid rgba(122,143,166,0.3)", padding: "8px 18px", borderRadius: "8px", fontSize: "11px", fontFamily: "'Georgia', serif", fontWeight: "bold", cursor: "pointer", letterSpacing: "1.5px", marginTop: "2px" }}>dive again</button>
            <div style={{ display: "flex", gap: "6px", marginTop: "2px" }}>
              <button onClick={() => startGame("beginner")} style={{ ...btnBase, width: "95px", padding: "6px 10px", fontSize: "10px" }}><div style={{ fontWeight: "bold", fontSize: "9px" }}>SHALLOW</div></button>
              <button onClick={() => startGame("intermediate")} style={{ ...btnBase, width: "95px", padding: "6px 10px", fontSize: "10px" }}><div style={{ fontWeight: "bold", fontSize: "9px" }}>DEEP</div></button>
              <button onClick={() => startGame("expert")} style={{ ...btnBase, width: "95px", padding: "6px 10px", fontSize: "10px" }}><div style={{ fontWeight: "bold", fontSize: "9px" }}>ABYSS</div></button>
            </div>
          </div>
        )}

        {gs === "gameover" && showLB && (
          <div style={{ position: "absolute", top: 0, left: 0, width: W, height: H, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", background: panelBg, borderRadius: "14px", gap: "6px", paddingTop: "25px", overflowY: "auto" }}>
            <div style={{ color: P.coinEdge, fontSize: "20px", fontWeight: "bold", letterSpacing: "2px" }}>🏆 leaderboard</div>
            {lbLoading ? <div style={{ color: P.textLight, fontSize: "12px", marginTop: "20px" }}>Loading...</div> :
              lb.length === 0 ? <div style={{ color: P.textLight, fontSize: "12px", marginTop: "20px", textAlign: "center", padding: "0 30px" }}>No scores yet!</div> : (
                <div style={{ width: "92%", marginTop: "6px" }}>
                  <div style={{ display: "flex", padding: "5px 6px", borderBottom: "1px solid rgba(160,140,120,0.15)" }}>
                    <div style={{ width: "20px", color: P.textLight, fontSize: "8px" }}>#</div>
                    <div style={{ flex: 1, color: P.textLight, fontSize: "8px" }}>PLAYER</div>
                    <div style={{ width: "42px", textAlign: "center", color: P.textLight, fontSize: "8px" }}>LEVEL</div>
                    <div style={{ width: "42px", textAlign: "right", color: P.textLight, fontSize: "8px" }}>DIST</div>
                    <div style={{ width: "34px", textAlign: "right", color: P.textLight, fontSize: "8px" }}>FISH</div>
                    <div style={{ width: "36px", textAlign: "right", color: P.textLight, fontSize: "8px" }}>STRK</div>
                  </div>
                  {lb.map((e, i) => {
                    const isMe = e.username === username && e.difficulty === lastDiff;
                    return (
                      <div key={i} style={{ display: "flex", padding: "5px 6px", alignItems: "center", background: isMe ? "rgba(122,143,166,0.08)" : "transparent", borderRadius: "4px", borderLeft: isMe ? `2px solid ${P.shark}` : "2px solid transparent" }}>
                        <div style={{ width: "20px", color: i < 3 ? [P.coinEdge, "#aaa", "#b08040"][i] : P.textLight, fontSize: "11px", fontWeight: i < 3 ? "bold" : "normal" }}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : `${i + 1}`}</div>
                        <div style={{ flex: 1, color: isMe ? P.shark : P.text, fontSize: "11px", fontWeight: isMe ? "bold" : "normal", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.username}{isMe ? " (you)" : ""}</div>
                        <div style={{ width: "42px", textAlign: "center" }}><span style={{ background: diffColors[e.difficulty] || "#888", color: "#fff", fontSize: "7px", fontWeight: "bold", padding: "2px 4px", borderRadius: "3px" }}>{diffLabels[e.difficulty] || "?"}</span></div>
                        <div style={{ width: "42px", textAlign: "right", color: P.shark, fontSize: "11px", fontFamily: "monospace" }}>{e.bestScore}</div>
                        <div style={{ width: "34px", textAlign: "right", color: "#78a090", fontSize: "11px", fontFamily: "monospace" }}>{e.bestFish}</div>
                        <div style={{ width: "36px", textAlign: "right", color: getStreakColor(e.bestStreak), fontSize: "11px", fontFamily: "monospace" }}>{e.bestStreak}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            <button onClick={() => setShowLB(false)} style={{ background: "rgba(122,143,166,0.08)", color: P.shark, border: "1px solid rgba(122,143,166,0.2)", padding: "7px 18px", borderRadius: "8px", fontSize: "11px", fontFamily: "'Georgia', serif", cursor: "pointer", marginTop: "10px" }}>← back</button>
          </div>
        )}
      </div>
    </div>
  );
}
