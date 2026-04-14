import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";

const GAME_WIDTH = 360;
const GAME_HEIGHT = 640;
const LANE_COUNT = 3;
const LANE_SPACING = 2.5;
const LANE_POSITIONS = [-(LANE_SPACING), 0, LANE_SPACING];

const DIFFICULTY = {
  beginner: { speed: 0.05, speedInc: 0.000025, spawnInt: 110, fishInt: 48, coinInt: 70 },
  intermediate: { speed: 0.09, speedInc: 0.00005, spawnInt: 80, fishInt: 40, coinInt: 58 },
  expert: { speed: 0.13, speedInc: 0.0001, spawnInt: 55, fishInt: 32, coinInt: 45 },
};

const COMBO_THRESHOLDS = [0, 3, 6, 10, 15];
const COMBO_COLORS_HEX = [0x4488aa, 0x00ccff, 0xaa66ff, 0xff44aa, 0xffdd00];
const FISH_COLORS_HEX = [0x66ffcc, 0x44ddff, 0x88aaff, 0xffaa66, 0xff88cc];
const CORAL_OBSTACLE_COLORS = [0xff6688, 0xff8844, 0xffaa33, 0xff5577, 0xff7755];
const REVIVE_COST = 8;

const getComboColorHex = (c) => { for (let i = COMBO_THRESHOLDS.length-1; i >= 0; i--) { if (c >= COMBO_THRESHOLDS[i]) return COMBO_COLORS_HEX[i]; } return COMBO_COLORS_HEX[0]; };
const getMultiplier = (c) => { if (c >= 15) return 5; if (c >= 10) return 4; if (c >= 6) return 3; if (c >= 3) return 2; return 1; };

// Storage helpers
const loadUsername = async () => {
  try { const r = await window.storage.get("shark-run-username"); return r?.value || ""; } catch { return ""; }
};
const saveUsername = async (name) => {
  try { await window.storage.set("shark-run-username", name); } catch (e) { console.error(e); }
};
const saveScore = async (username, scoreData) => {
  try {
    const key = `shark-lb:${username}`;
    let existing;
    try { existing = await window.storage.get(key, true); } catch { existing = null; }
    const prev = existing ? JSON.parse(existing.value) : { username, bestScore: 0, bestFish: 0, bestStreak: 0, bestCoins: 0 };
    const updated = {
      username,
      bestScore: Math.max(prev.bestScore, scoreData.score),
      bestFish: Math.max(prev.bestFish, scoreData.fish),
      bestStreak: Math.max(prev.bestStreak, scoreData.streak),
      bestCoins: Math.max(prev.bestCoins, scoreData.coins),
      lastPlayed: Date.now(),
    };
    await window.storage.set(key, JSON.stringify(updated), true);
  } catch (e) { console.error(e); }
};
const loadLeaderboard = async () => {
  try {
    const keys = await window.storage.list("shark-lb:", true);
    if (!keys?.keys?.length) return [];
    const entries = [];
    for (const key of keys.keys.slice(0, 20)) {
      try {
        const r = await window.storage.get(key, true);
        if (r?.value) entries.push(JSON.parse(r.value));
      } catch { /* skip */ }
    }
    return entries.sort((a, b) => b.bestScore - a.bestScore).slice(0, 10);
  } catch { return []; }
};

export default function SharkRun() {
  const [gameState, setGameState] = useState("start");
  const [score, setScore] = useState(0);
  const [fishEaten, setFishEaten] = useState(0);
  const [coins, setCoins] = useState(0);
  const [lives, setLives] = useState(3);
  const [combo, setCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [maxCombo, setMaxCombo] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [highCoins, setHighCoins] = useState(0);
  const [canRevive, setCanRevive] = useState(false);
  const [multiplierFlash, setMultiplierFlash] = useState(0);
  const [username, setUsername] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [scoreSaved, setScoreSaved] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const [lastDifficulty, setLastDifficulty] = useState("beginner");
  const mountRef = useRef(null);
  const frameRef = useRef(null);
  const gameRef = useRef(null);

  // Load username on mount
  useEffect(() => {
    loadUsername().then((name) => { if (name) { setUsername(name); setUsernameInput(name); } });
  }, []);

  const handleShare = async () => {
    const text = `🦈 SHARK RUN 🦈\nDistance: ${score} | Fish: ${fishEaten} | Streak: ${maxCombo} | Coins: ${coins}\nCan you beat my score?\n\nPlay here: https://shark-run.vercel.app/`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Shark Run - My Score", text, url: "https://shark-run.vercel.app/" });
        setShareMsg("Shared!");
      } catch (e) {
        if (e.name !== "AbortError") setShareMsg("Couldn't share");
      }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        setShareMsg("Copied to clipboard!");
      } catch {
        setShareMsg("Couldn't copy");
      }
    }
    setTimeout(() => setShareMsg(""), 2000);
  };

  const handleSaveScore = async () => {
    const name = usernameInput.trim();
    if (!name) return;
    setUsername(name);
    await saveUsername(name);
    await saveScore(name, { score, fish: fishEaten, streak: maxCombo, coins });
    setScoreSaved(true);
  };

  const handleShowLeaderboard = async () => {
    setLeaderboardLoading(true);
    const lb = await loadLeaderboard();
    setLeaderboard(lb);
    setLeaderboardLoading(false);
    setShowLeaderboard(true);
  };

  const createShark = useCallback(() => {
    const group = new THREE.Group();
    const bodyGeo = new THREE.SphereGeometry(0.6, 16, 12); bodyGeo.scale(0.55, 0.4, 1.8);
    group.add(new THREE.Mesh(bodyGeo, new THREE.MeshPhongMaterial({ color: 0x556677, emissive: 0x334455, emissiveIntensity: 0.15, shininess: 60, specular: 0x889999 })));
    const bellyGeo = new THREE.SphereGeometry(0.55, 12, 8); bellyGeo.scale(0.45, 0.25, 1.6);
    const belly = new THREE.Mesh(bellyGeo, new THREE.MeshPhongMaterial({ color: 0xddddcc, emissive: 0xccccbb, emissiveIntensity: 0.1 }));
    belly.position.y = -0.08; group.add(belly);
    const finMat = new THREE.MeshPhongMaterial({ color: 0x445566, emissive: 0x334455, emissiveIntensity: 0.1 });
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.55, 4), finMat);
    dorsal.position.set(0, 0.45, -0.1); dorsal.rotation.x = -0.15; group.add(dorsal);
    const tailTop = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 4), finMat);
    tailTop.position.set(0, 0.2, 0.95); tailTop.rotation.x = -0.6; group.add(tailTop);
    const tailBot = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.35, 4), finMat);
    tailBot.position.set(0, -0.1, 0.9); tailBot.rotation.x = 0.4; group.add(tailBot);
    const tailConn = new THREE.Mesh((() => { const g = new THREE.SphereGeometry(0.2, 8, 6); g.scale(0.4, 0.5, 1); return g; })(),
      new THREE.MeshPhongMaterial({ color: 0x556677, emissive: 0x334455, emissiveIntensity: 0.1 }));
    tailConn.position.z = 0.85; group.add(tailConn);
    [-1, 1].forEach((s) => { const f = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.45, 4), finMat); f.position.set(s*0.35, -0.12, 0.1); f.rotation.z = s*1.2; f.rotation.x = 0.3; group.add(f); });
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 8), new THREE.MeshPhongMaterial({ color: 0x667788, emissive: 0x445566, emissiveIntensity: 0.1 }));
    snout.position.z = -0.95; snout.rotation.x = Math.PI/2; group.add(snout);
    [-1, 1].forEach((s) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshPhongMaterial({ color: 0x111111, emissive: 0x222222, emissiveIntensity: 0.3 }));
      eye.position.set(s*0.28, 0.08, -0.65); group.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(s*0.3, 0.1, -0.68); group.add(glint);
      for (let i = 0; i < 3; i++) { const gill = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.08, 0.003), new THREE.MeshPhongMaterial({ color: 0x334455 })); gill.position.set(s*0.32, 0.02-i*0.06, -0.3+i*0.05); group.add(gill); }
    });
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 4, 12, Math.PI), new THREE.MeshPhongMaterial({ color: 0x334455 }));
    mouth.position.set(0, -0.1, -0.82); mouth.rotation.x = Math.PI/2; mouth.rotation.z = Math.PI; group.add(mouth);
    return group;
  }, []);

  const createSmallFish = useCallback((color) => {
    const group = new THREE.Group(); const s = 0.32;
    const bodyGeo = new THREE.SphereGeometry(s, 10, 8); bodyGeo.scale(0.7, 0.5, 1.2);
    group.add(new THREE.Mesh(bodyGeo, new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.35, shininess: 80, transparent: true, opacity: 0.9 })));
    const tailGeo = new THREE.ConeGeometry(s*0.4, s*0.55, 4);
    const tailMat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.25, transparent: true, opacity: 0.75 });
    const tail = new THREE.Mesh(tailGeo, tailMat); tail.position.z = s*1.05; tail.rotation.x = Math.PI/2; group.add(tail);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(s*0.08, s*0.3, 3), tailMat);
    fin.position.set(0, s*0.35, 0); group.add(fin);
    [-1, 1].forEach((side) => { const eye = new THREE.Mesh(new THREE.SphereGeometry(s*0.12, 6, 6), new THREE.MeshPhongMaterial({ color: 0xffffff })); eye.position.set(side*s*0.3, s*0.1, -s*0.6); group.add(eye); });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(s*1.6, 10, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06 })));
    const fl = new THREE.PointLight(color, 0.25, 2.5); fl.position.y = 0.3; group.add(fl);
    return group;
  }, []);

  const createCoinMesh = useCallback(() => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 24), new THREE.MeshPhongMaterial({ color: 0xffd700, emissive: 0xcc9900, emissiveIntensity: 0.3, shininess: 150, specular: 0xffffff })));
    const rimMat = new THREE.MeshPhongMaterial({ color: 0xffcc00, emissive: 0xaa8800, emissiveIntensity: 0.2, shininess: 120 });
    [0.04, -0.04].forEach((y) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 24), rimMat); r.position.y = y; r.rotation.x = Math.PI/2; group.add(r); });
    const starShape = new THREE.Shape();
    for (let i = 0; i < 5; i++) { const oa = (i*2*Math.PI)/5 - Math.PI/2; const ia = oa + Math.PI/5; if (i===0) starShape.moveTo(Math.cos(oa)*0.15, Math.sin(oa)*0.15); else starShape.lineTo(Math.cos(oa)*0.15, Math.sin(oa)*0.15); starShape.lineTo(Math.cos(ia)*0.07, Math.sin(ia)*0.07); }
    starShape.closePath();
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.02, bevelEnabled: false }), new THREE.MeshPhongMaterial({ color: 0xffee55, emissive: 0xddcc33, emissiveIntensity: 0.3 }));
    star.rotation.x = -Math.PI/2; star.position.y = 0.04; group.add(star);
    const cl = new THREE.PointLight(0xffd700, 0.2, 2); cl.position.y = 0.3; group.add(cl);
    return group;
  }, []);

  const createCoralObstacle = useCallback(() => {
    const group = new THREE.Group();
    const color = CORAL_OBSTACLE_COLORS[Math.floor(Math.random()*CORAL_OBSTACLE_COLORS.length)];
    const mainGeo = new THREE.SphereGeometry(0.5, 7, 6);
    const pos = mainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i); pos.setXYZ(i, x*(1+Math.sin(x*5)*Math.cos(z*5)*0.2), y*0.7, z*(1+Math.sin(x*5)*Math.cos(z*5)*0.2)); }
    mainGeo.computeVertexNormals();
    const mainMat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.2, shininess: 20, flatShading: true });
    group.add(new THREE.Mesh(mainGeo, mainMat));
    for (let i = 0; i < 4; i++) {
      const a = (i/4)*Math.PI*2+Math.random()*0.5;
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 0.3+Math.random()*0.3, 5), mainMat);
      br.position.set(Math.cos(a)*0.25, 0.35+Math.random()*0.15, Math.sin(a)*0.25);
      br.rotation.z = (Math.random()-0.5)*0.5; br.rotation.x = (Math.random()-0.5)*0.5; group.add(br);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 5), new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.4 }));
      tip.position.copy(br.position); tip.position.y += 0.18; group.add(tip);
    }
    const baseGeo = new THREE.SphereGeometry(0.35, 6, 5); baseGeo.scale(1.2, 0.4, 1.2);
    const base = new THREE.Mesh(baseGeo, new THREE.MeshPhongMaterial({ color: 0x555544, emissive: 0x333322, emissiveIntensity: 0.1, flatShading: true }));
    base.position.y = -0.3; group.add(base);
    const wl = new THREE.PointLight(color, 0.15, 2.5); wl.position.y = 0.3; group.add(wl);
    return group;
  }, []);

  const createParticleBurst = useCallback((scene, position, color, count) => {
    const ps = [];
    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.04+Math.random()*0.04, 4, 4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
      p.position.copy(position);
      p.userData.vel = new THREE.Vector3((Math.random()-0.5)*0.15, Math.random()*0.1, (Math.random()-0.5)*0.15);
      p.userData.life = 30+Math.random()*20;
      scene.add(p); ps.push(p);
    }
    return ps;
  }, []);

  const initScene = useCallback(() => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x1a4060, 0.02);
    const camera = new THREE.PerspectiveCamera(45, GAME_WIDTH/GAME_HEIGHT, 0.1, 100);
    camera.position.set(0, 14, 10); camera.lookAt(0, 0, -3);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(GAME_WIDTH, GAME_HEIGHT);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a4065);

    scene.add(new THREE.AmbientLight(0x88bbdd, 1.3));
    const sun = new THREE.DirectionalLight(0xccddff, 1.3); sun.position.set(3, 20, 5); scene.add(sun);
    scene.add(new THREE.DirectionalLight(0x99bbdd, 0.6).translateX(0).translateY(5).translateZ(15));
    scene.add(new THREE.DirectionalLight(0x4488bb, 0.4).translateY(-3));
    const rl = new THREE.PointLight(0x66aacc, 0.6, 15); rl.position.set(0, 5, 4); scene.add(rl);

    const rayMat = new THREE.MeshBasicMaterial({ color: 0xccddff, transparent: true, opacity: 0.04, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(0.25+Math.random()*0.5, 35), rayMat.clone());
      ray.position.set((Math.random()-0.5)*12, 6, -8+Math.random()*-15);
      ray.rotation.z = (Math.random()-0.5)*0.25;
      ray.userData.isRay = true; ray.userData.baseOpacity = 0.015+Math.random()*0.02;
      scene.add(ray);
    }

    const floorGeo = new THREE.PlaneGeometry(30, 80, 20, 40);
    const fp = floorGeo.attributes.position;
    for (let i = 0; i < fp.count; i++) fp.setZ(i, Math.sin(fp.getX(i)*0.4)*Math.cos(fp.getY(i)*0.3)*0.15+(Math.random()-0.5)*0.08);
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshPhongMaterial({ color: 0x2a5070, emissive: 0x1a3855, emissiveIntensity: 0.25, shininess: 10, flatShading: true }));
    floor.rotation.x = -Math.PI/2; floor.position.set(0, -2.2, -15); scene.add(floor);

    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.CircleGeometry(0.5+Math.random()*1.2, 8), new THREE.MeshPhongMaterial({ color: 0x3a5577, emissive: 0x2a4466, emissiveIntensity: 0.2 }));
      s.rotation.x = -Math.PI/2; s.position.set((Math.random()-0.5)*14, -2.15, Math.random()*-30-3); scene.add(s);
    }

    const dc = [0xee6688, 0x88cc55, 0xcc8844, 0x6688cc, 0xcc66aa, 0x55ccaa];
    for (let i = 0; i < 18; i++) {
      const cg = new THREE.SphereGeometry(0.12+Math.random()*0.3, 6, 5); cg.scale(1, 0.5+Math.random()*1.5, 1);
      const c = new THREE.Mesh(cg, new THREE.MeshPhongMaterial({ color: dc[i%6], emissive: dc[i%6], emissiveIntensity: 0.15, flatShading: true }));
      const side = Math.random()>0.5?1:-1;
      c.position.set(side*(4+Math.random()*4.5), -2+c.geometry.parameters.radius*0.3, Math.random()*-35-2);
      c.rotation.y = Math.random()*Math.PI; scene.add(c);
    }

    const swc = [0x2a8855, 0x339966, 0x228844];
    for (let i = 0; i < 16; i++) {
      const h = 0.8+Math.random()*2;
      const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, h, 5), new THREE.MeshPhongMaterial({ color: swc[i%3], emissive: 0x115533, emissiveIntensity: 0.15, transparent: true, opacity: 0.75 }));
      const side = Math.random()>0.5?1:-1;
      sw.position.set(side*(3.5+Math.random()*5), -2+h/2, Math.random()*-35-2);
      sw.userData.sway = 0.008+Math.random()*0.015; sw.userData.baseRot = (Math.random()-0.5)*0.15; scene.add(sw);
    }

    for (let i = 0; i < LANE_COUNT+1; i++) {
      const x = (i-LANE_COUNT/2)*LANE_SPACING;
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.01, 50), new THREE.MeshBasicMaterial({ color: 0x3a6688, transparent: true, opacity: 0.3 }));
      l.position.set(x, -2.1, -10); scene.add(l);
    }

    const bubbles = [];
    for (let i = 0; i < 30; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshPhongMaterial({ color: 0x99ccee, transparent: true, opacity: 0.1+Math.random()*0.12, shininess: 100, specular: 0xffffff }));
      b.scale.setScalar(0.5+Math.random()*1.5);
      b.position.set((Math.random()-0.5)*14, Math.random()*10-2, Math.random()*-35);
      b.userData.speed = 0.006+Math.random()*0.012; b.userData.baseX = b.position.x; b.userData.wobble = 0.3+Math.random()*0.5;
      scene.add(b); bubbles.push(b);
    }
    return { scene, camera, renderer, runnerLight: rl, bubbles };
  }, []);

  const resetGame = useCallback((diff) => {
    const s = DIFFICULTY[diff];
    gameRef.current = {
      runnerLane:1, targetLane:1, obstacles:[], fishes:[], coins:[], particles:[], trailMeshes:[],
      frameCount:0, speed:s.speed, speedInc:s.speedInc,
      spawnInt:s.spawnInt, fishInt:s.fishInt, coinInt:s.coinInt,
      score:0, fishCount:0, coinCount:0, lives:3, combo:0, maxCombo:0, multiplier:1, invincible:0, difficulty:diff, runnerMesh:null,
    };
    setScore(0); setFishEaten(0); setCoins(0); setLives(3);
    setCombo(0); setMultiplier(1); setMaxCombo(0);
    setCanRevive(false); setMultiplierFlash(0); setScoreSaved(false); setShowLeaderboard(false); setShareMsg("");
  }, []);

  const startGame = useCallback((diff) => { setLastDifficulty(diff); resetGame(diff); setGameState("playing"); }, [resetGame]);

  const revive = useCallback(() => {
    const g = gameRef.current;
    if (g && g.coinCount >= REVIVE_COST) {
      g.coinCount -= REVIVE_COST; g.lives = 1; g.invincible = 120; g.combo = 0; g.multiplier = 1;
      setCoins(g.coinCount); setLives(1); setCombo(0); setMultiplier(1); setGameState("playing");
    }
  }, []);

  useEffect(() => {
    if (gameState !== "playing") return;
    const mount = mountRef.current; if (!mount) return;
    const { scene, camera, renderer, runnerLight, bubbles } = initScene();
    mount.innerHTML = ""; mount.appendChild(renderer.domElement);
    const g = gameRef.current;
    const shark = createShark();
    shark.position.set(LANE_POSITIONS[g.runnerLane], 0, 4); shark.rotation.y = Math.PI;
    scene.add(shark); g.runnerMesh = shark;
    const glowLight = new THREE.PointLight(0x4488aa, 0.7, 8); scene.add(glowLight);

    const animate = () => {
      if (gameRef.current !== g) return;
      g.frameCount++;
      const tX = LANE_POSITIONS[g.targetLane];
      shark.position.x += (tX - shark.position.x)*0.18;
      shark.rotation.z = -(tX - shark.position.x)*0.15;
      shark.rotation.x = Math.sin(g.frameCount*0.03)*0.03;
      g.runnerLane = g.targetLane;
      shark.position.y = Math.sin(g.frameCount*0.035)*0.1;
      shark.rotation.y = Math.PI + Math.sin(g.frameCount*0.1)*0.04;

      if (g.invincible > 0) { g.invincible--; shark.visible = Math.floor(g.invincible/5)%2===0; } else shark.visible = true;

      const cc = getComboColorHex(g.combo);
      glowLight.color.setHex(g.combo>=3?cc:0x4488aa);
      glowLight.intensity = 0.6+g.combo*0.12;
      glowLight.position.set(shark.position.x, shark.position.y+2, shark.position.z);
      runnerLight.color.setHex(g.combo>=3?cc:0x4488aa);
      runnerLight.position.set(shark.position.x, 5, shark.position.z);

      if (g.combo>=3 && g.frameCount%3===0) {
        const t = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4), new THREE.MeshBasicMaterial({ color: cc, transparent: true, opacity: 0.4 }));
        t.position.set(shark.position.x+(Math.random()-0.5)*0.2, shark.position.y, shark.position.z+0.9);
        t.userData.life = 22; scene.add(t); g.trailMeshes.push(t);
      }
      g.trailMeshes = g.trailMeshes.filter((t) => { t.userData.life--; t.material.opacity=(t.userData.life/22)*0.35; t.position.z+=0.015; t.position.y+=0.008; t.scale.multiplyScalar(0.96); if(t.userData.life<=0){scene.remove(t);return false;} return true; });

      g.speed += g.speedInc; g.score += 1;

      if (g.frameCount%g.spawnInt===0) { const ln=Math.floor(Math.random()*LANE_COUNT); const m=createCoralObstacle(); m.position.set(LANE_POSITIONS[ln],-0.5,-30); scene.add(m); g.obstacles.push({lane:ln,mesh:m,nearMissed:false}); }
      if (g.frameCount%g.fishInt===0) { const ln=Math.floor(Math.random()*LANE_COUNT); if(!g.obstacles.some(o=>o.lane===ln&&o.mesh.position.z>-33&&o.mesh.position.z<-27)){const ci=Math.floor(Math.random()*FISH_COLORS_HEX.length);const m=createSmallFish(FISH_COLORS_HEX[ci]);m.position.set(LANE_POSITIONS[ln],0,-30);scene.add(m);g.fishes.push({lane:ln,mesh:m,missed:false,missProcessed:false});}}
      if (g.frameCount%g.coinInt===0) { const ln=Math.floor(Math.random()*LANE_COUNT); if(!g.obstacles.some(o=>o.lane===ln&&o.mesh.position.z>-33&&o.mesh.position.z<-27)){const m=createCoinMesh();m.position.set(LANE_POSITIONS[ln],0.6,-30);scene.add(m);g.coins.push({lane:ln,mesh:m});}}

      g.obstacles = g.obstacles.filter(o=>{o.mesh.position.z+=g.speed;o.mesh.position.y=-0.5+Math.sin(g.frameCount*0.012+o.mesh.position.z*0.3)*0.08;if(o.mesh.position.z>10){scene.remove(o.mesh);return false;}return true;});
      g.fishes = g.fishes.filter(f=>{f.mesh.position.z+=g.speed;f.mesh.position.y=Math.sin(g.frameCount*0.04+f.mesh.position.z*0.4)*0.18;f.mesh.rotation.y=Math.sin(g.frameCount*0.05+f.mesh.position.z)*0.15;if(f.mesh.position.z>6&&!f.missed)f.missed=true;if(f.mesh.position.z>10){scene.remove(f.mesh);return false;}return true;});
      const missed=g.fishes.filter(f=>f.missed&&!f.missProcessed);
      if(missed.length>0){missed.forEach(f=>f.missProcessed=true);if(g.combo>0){g.combo=0;g.multiplier=1;setCombo(0);setMultiplier(1);}}
      g.coins = g.coins.filter(c=>{c.mesh.position.z+=g.speed;c.mesh.rotation.x+=0.04;c.mesh.position.y=0.6+Math.sin(g.frameCount*0.025+c.mesh.position.z*0.4)*0.1;if(c.mesh.position.z>10){scene.remove(c.mesh);return false;}return true;});
      g.particles = g.particles.filter(p=>{p.userData.life--;p.position.add(p.userData.vel);p.userData.vel.y-=0.002;p.material.opacity=p.userData.life/40;p.scale.multiplyScalar(0.97);if(p.userData.life<=0){scene.remove(p);return false;}return true;});
      bubbles.forEach(b=>{b.position.y+=b.userData.speed;b.position.x=b.userData.baseX+Math.sin(b.position.y*b.userData.wobble)*0.4;if(b.position.y>9)b.position.y=-2;});
      scene.traverse(ch=>{if(ch.userData.sway)ch.rotation.z=ch.userData.baseRot+Math.sin(g.frameCount*ch.userData.sway)*0.12;if(ch.userData.isRay)ch.material.opacity=ch.userData.baseOpacity+Math.sin(g.frameCount*0.007+ch.position.x)*0.008;});

      const rX=shark.position.x, rZ=shark.position.z;
      g.fishes=g.fishes.filter(f=>{if(f.missed)return true;if(Math.sqrt((rX-f.mesh.position.x)**2+(rZ-f.mesh.position.z)**2)<1.4){g.particles.push(...createParticleBurst(scene,f.mesh.position,f.mesh.children[0]?.material?.color?.getHex()||0x66ffcc,8));scene.remove(f.mesh);g.fishCount++;g.combo++;if(g.combo>g.maxCombo)g.maxCombo=g.combo;const nm=getMultiplier(g.combo);if(nm>g.multiplier)setMultiplierFlash(50);g.multiplier=nm;setFishEaten(g.fishCount);setCombo(g.combo);setMultiplier(g.multiplier);setMaxCombo(g.maxCombo);return false;}return true;});
      g.coins=g.coins.filter(c=>{if(Math.sqrt((rX-c.mesh.position.x)**2+(rZ-c.mesh.position.z)**2)<1.3){g.particles.push(...createParticleBurst(scene,c.mesh.position,0xffd700,6));scene.remove(c.mesh);g.coinCount+=g.multiplier;setCoins(g.coinCount);return false;}return true;});
      g.obstacles.forEach(o=>{if(o.nearMissed)return;if(Math.abs(o.mesh.position.z-rZ)<1.0&&Math.abs(o.lane-g.targetLane)===1){o.nearMissed=true;g.combo++;if(g.combo>g.maxCombo)g.maxCombo=g.combo;const nm=getMultiplier(g.combo);if(nm>g.multiplier)setMultiplierFlash(50);g.multiplier=nm;g.score+=5;setCombo(g.combo);setMultiplier(g.multiplier);setMaxCombo(g.maxCombo);}});
      if(g.invincible<=0){for(const o of g.obstacles){if(Math.abs(o.mesh.position.z-rZ)<0.9&&Math.abs(LANE_POSITIONS[o.lane]-rX)<1.0){g.lives--;g.combo=0;g.multiplier=1;g.particles.push(...createParticleBurst(scene,shark.position,0xff4466,15));setLives(g.lives);setCombo(0);setMultiplier(1);if(g.lives<=0){setScore(g.score);setFishEaten(g.fishCount);setCoins(g.coinCount);setHighScore(p=>Math.max(p,g.score));setHighCoins(p=>Math.max(p,g.coinCount));setMaxCombo(g.maxCombo);setCanRevive(g.coinCount>=REVIVE_COST);setGameState("gameover");return;}else{g.invincible=90;scene.remove(o.mesh);g.obstacles=g.obstacles.filter(ob=>ob!==o);break;}}}}

      setScore(g.score);
      camera.position.x = Math.sin(g.frameCount*0.004)*0.2;
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => { if(frameRef.current)cancelAnimationFrame(frameRef.current); if(mount.contains(renderer.domElement))mount.removeChild(renderer.domElement); renderer.dispose(); };
  }, [gameState, initScene, createShark, createSmallFish, createCoinMesh, createCoralObstacle, createParticleBurst]);

  useEffect(() => { if(multiplierFlash>0){const t=setTimeout(()=>setMultiplierFlash(p=>p-1),16);return()=>clearTimeout(t);} }, [multiplierFlash]);
  useEffect(() => {
    const h = (e) => { if(gameState==="playing"&&gameRef.current){const g=gameRef.current;if((e.key==="ArrowLeft"||e.key==="a")&&g.targetLane>0)g.targetLane--;if((e.key==="ArrowRight"||e.key==="d")&&g.targetLane<LANE_COUNT-1)g.targetLane++;if(e.key==="Escape"){setGameState("start");if(frameRef.current)cancelAnimationFrame(frameRef.current);}} };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [gameState]);

  const cCSS = ["#4488aa","#00ccff","#aa66ff","#ff44aa","#ffdd00"];
  const gCSS = (c) => { for(let i=COMBO_THRESHOLDS.length-1;i>=0;i--){if(c>=COMBO_THRESHOLDS[i])return cCSS[i];}return cCSS[0]; };

  const Btn = ({diff, label, desc, small}) => (
    <button onClick={()=>startGame(diff)}
      style={{background:"rgba(255,255,255,0.06)",color:"#eaeaea",border:"1px solid rgba(100,180,255,0.2)",padding:small?"8px 14px":"12px 20px",borderRadius:"8px",fontSize:small?"12px":"14px",fontFamily:"monospace",cursor:"pointer",width:small?"180px":"220px",textAlign:"left"}}
      onMouseEnter={e=>{e.currentTarget.style.background="rgba(0,200,255,0.1)";e.currentTarget.style.borderColor="#44aacc";}}
      onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.06)";e.currentTarget.style.borderColor="rgba(100,180,255,0.2)";}}>
      <div style={{fontWeight:"bold",letterSpacing:"2px",marginBottom:"2px",fontSize:small?"11px":"14px"}}>{label}</div>
      <div style={{fontSize:small?"9px":"11px",color:"rgba(255,255,255,0.4)"}}>{desc}</div>
    </button>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0a1a2e",fontFamily:"monospace"}}>
      <div style={{position:"relative",width:GAME_WIDTH,height:GAME_HEIGHT,border:"2px solid rgba(100,180,255,0.15)",borderRadius:"12px",overflow:"hidden",background:"#1a4065"}}>
        <div ref={mountRef} style={{width:"100%",height:"100%"}} />

        {gameState==="playing" && (
          <div style={{position:"absolute",top:0,left:0,width:GAME_WIDTH,padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",fontFamily:"monospace",pointerEvents:"none",zIndex:10}}>
            <div>
              <div style={{display:"flex",gap:"4px",marginBottom:"4px"}}>{[0,1,2].map(i=>(<span key={i} style={{fontSize:"14px",opacity:i<lives?1:0.2}}>❤️</span>))}</div>
              {combo>0 && <div style={{fontSize:"10px",color:gCSS(combo),textShadow:"0 0 8px rgba(0,0,0,0.9)"}}>{combo} streak 🪙x{multiplier}</div>}
            </div>
            <div style={{display:"flex",gap:"14px",textAlign:"center"}}>
              <div><div style={{color:"rgba(255,255,255,0.5)",fontSize:"9px",textShadow:"0 0 6px rgba(0,0,0,0.9)"}}>FISH</div><div style={{color:"#66ffcc",fontSize:"16px",fontWeight:"bold",textShadow:"0 0 8px rgba(0,0,0,0.9)"}}>{fishEaten}</div></div>
              <div><div style={{color:"rgba(255,255,255,0.5)",fontSize:"9px",textShadow:"0 0 6px rgba(0,0,0,0.9)"}}>COINS</div><div style={{color:"#ffd700",fontSize:"16px",fontWeight:"bold",textShadow:"0 0 8px rgba(0,0,0,0.9)"}}>{coins}</div></div>
              <div><div style={{color:"rgba(255,255,255,0.5)",fontSize:"9px",textShadow:"0 0 6px rgba(0,0,0,0.9)"}}>DIST</div><div style={{color:"#88ccee",fontSize:"16px",fontWeight:"bold",textShadow:"0 0 8px rgba(0,0,0,0.9)"}}>{score}</div></div>
            </div>
          </div>
        )}

        {gameState==="playing" && multiplierFlash>0 && (
          <div style={{position:"absolute",top:"40%",left:"50%",transform:`translate(-50%,-50%) scale(${1+(1-Math.min(multiplierFlash/10,1))*0.3})`,fontFamily:"monospace",textAlign:"center",pointerEvents:"none",opacity:Math.min(multiplierFlash/10,1),zIndex:20}}>
            <div style={{fontSize:"56px",fontWeight:"bold",color:gCSS(combo),textShadow:`0 0 30px ${gCSS(combo)}, 0 0 60px ${gCSS(combo)}`}}>x{multiplier}</div>
            <div style={{fontSize:"14px",color:"#ffd700",textShadow:"0 0 10px rgba(0,0,0,0.9)"}}>{multiplier>=5?"FRENZY!":multiplier>=4?"COIN RUSH!":multiplier>=3?"x3 COINS!":"x2 COINS!"}</div>
          </div>
        )}

        {gameState==="start" && (
          <div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(4,14,26,0.95)",gap:"10px",zIndex:30}}>
            <div style={{fontSize:"18px"}}>🦈</div>
            <div style={{color:"#88ccee",fontSize:"32px",fontWeight:"bold",letterSpacing:"3px"}}>SHARK RUN</div>
            <div style={{color:"rgba(255,255,255,0.45)",fontSize:"11px",textAlign:"center",lineHeight:"1.7",padding:"0 24px"}}>eat small fish to build streaks<br/>streaks multiply your coin rewards<br/>miss a fish = streak resets<br/>avoid coral · coins = extra lives</div>
            <div style={{color:"rgba(100,180,255,0.4)",fontSize:"11px",letterSpacing:"2px",marginTop:"2px"}}>SELECT DEPTH</div>
            <Btn diff="beginner" label="SHALLOW" desc="Calm waters, easy catches" />
            <Btn diff="intermediate" label="DEEP" desc="Faster currents, more coral" />
            <Btn diff="expert" label="ABYSS" desc="Maximum speed, survive" />
            <div style={{color:"rgba(255,255,255,0.25)",fontSize:"10px",marginTop:"2px"}}>← → or A/D to swim · ESC to surface</div>
          </div>
        )}

        {gameState==="gameover" && !showLeaderboard && (
          <div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(4,14,26,0.95)",gap:"6px",zIndex:30,overflowY:"auto"}}>
            <div style={{color:"#ff6688",fontSize:"24px",fontWeight:"bold",letterSpacing:"3px"}}>WRECKED!</div>

            <div style={{display:"flex",gap:"12px",margin:"4px 0"}}>
              <div style={{textAlign:"center"}}><div style={{color:"rgba(255,255,255,0.4)",fontSize:"9px"}}>DIST</div><div style={{color:"#88ccee",fontSize:"16px",fontWeight:"bold"}}>{score}</div><div style={{color:"rgba(255,255,255,0.25)",fontSize:"8px"}}>best: {highScore}</div></div>
              <div style={{textAlign:"center"}}><div style={{color:"rgba(255,255,255,0.4)",fontSize:"9px"}}>FISH</div><div style={{color:"#66ffcc",fontSize:"16px",fontWeight:"bold"}}>{fishEaten}</div></div>
              <div style={{textAlign:"center"}}><div style={{color:"rgba(255,255,255,0.4)",fontSize:"9px"}}>STREAK</div><div style={{color:gCSS(maxCombo),fontSize:"16px",fontWeight:"bold"}}>{maxCombo}</div></div>
              <div style={{textAlign:"center"}}><div style={{color:"rgba(255,255,255,0.4)",fontSize:"9px"}}>COINS</div><div style={{color:"#ffd700",fontSize:"16px",fontWeight:"bold"}}>{coins}</div><div style={{color:"rgba(255,255,255,0.25)",fontSize:"8px"}}>best: {highCoins}</div></div>
            </div>

            {/* Username + Save */}
            {!scoreSaved ? (
              <div style={{display:"flex",gap:"6px",alignItems:"center",marginTop:"4px"}}>
                <input
                  type="text" placeholder="Enter name" maxLength={12}
                  value={usernameInput} onChange={e=>setUsernameInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter")handleSaveScore();}}
                  style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(100,180,255,0.3)",borderRadius:"6px",padding:"8px 10px",color:"#eaeaea",fontSize:"12px",fontFamily:"monospace",width:"120px",outline:"none"}}
                />
                <button onClick={handleSaveScore}
                  style={{background:"rgba(0,200,255,0.15)",color:"#88ccee",border:"1px solid rgba(100,180,255,0.4)",padding:"8px 12px",borderRadius:"6px",fontSize:"11px",fontFamily:"monospace",fontWeight:"bold",cursor:"pointer",letterSpacing:"1px"}}>
                  SAVE
                </button>
              </div>
            ) : (
              <div style={{color:"#66ffcc",fontSize:"11px",marginTop:"4px"}}>✓ Score saved as {username}</div>
            )}

            {/* Action buttons row */}
            <div style={{display:"flex",gap:"8px",marginTop:"4px"}}>
              <button onClick={handleShare}
                style={{background:"rgba(100,180,255,0.12)",color:"#88ccee",border:"1px solid rgba(100,180,255,0.3)",padding:"8px 14px",borderRadius:"6px",fontSize:"11px",fontFamily:"monospace",fontWeight:"bold",cursor:"pointer",letterSpacing:"1px"}}>
                📤 SHARE
              </button>
              <button onClick={handleShowLeaderboard}
                style={{background:"rgba(255,215,0,0.1)",color:"#ffd700",border:"1px solid rgba(255,215,0,0.3)",padding:"8px 14px",borderRadius:"6px",fontSize:"11px",fontFamily:"monospace",fontWeight:"bold",cursor:"pointer",letterSpacing:"1px"}}>
                🏆 LEADERBOARD
              </button>
            </div>
            {shareMsg && <div style={{color:"#66ffcc",fontSize:"10px"}}>{shareMsg}</div>}

            {canRevive && (
              <button onClick={revive} style={{background:"rgba(255,215,0,0.12)",color:"#ffd700",border:"2px solid #ffd700",padding:"8px 16px",borderRadius:"8px",fontSize:"12px",fontFamily:"monospace",fontWeight:"bold",cursor:"pointer",marginTop:"2px"}}>
                🪙 REVIVE ({REVIVE_COST} COINS)
              </button>
            )}

            <button onClick={()=>startGame(lastDifficulty)} style={{background:"rgba(100,180,255,0.1)",color:"#88ccee",border:"1px solid rgba(100,180,255,0.3)",padding:"8px 20px",borderRadius:"6px",fontSize:"11px",fontFamily:"monospace",fontWeight:"bold",cursor:"pointer",letterSpacing:"2px",marginTop:"2px"}}>{canRevive?"OR DIVE AGAIN":"DIVE AGAIN"}</button>
            <div style={{display:"flex",gap:"6px"}}>
              <Btn diff="beginner" label="SHALLOW" desc="Easy" small />
              <Btn diff="expert" label="ABYSS" desc="Hard" small />
            </div>
          </div>
        )}

        {/* Leaderboard overlay */}
        {gameState==="gameover" && showLeaderboard && (
          <div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",background:"rgba(4,14,26,0.97)",gap:"6px",zIndex:31,paddingTop:"30px",overflowY:"auto"}}>
            <div style={{color:"#ffd700",fontSize:"22px",fontWeight:"bold",letterSpacing:"3px"}}>🏆 LEADERBOARD</div>

            {leaderboardLoading ? (
              <div style={{color:"rgba(255,255,255,0.4)",fontSize:"12px",marginTop:"20px"}}>Loading...</div>
            ) : leaderboard.length === 0 ? (
              <div style={{color:"rgba(255,255,255,0.4)",fontSize:"12px",marginTop:"20px",textAlign:"center",padding:"0 30px"}}>No scores yet. Be the first to save your score!</div>
            ) : (
              <div style={{width:"90%",marginTop:"8px"}}>
                {/* Header */}
                <div style={{display:"flex",padding:"6px 8px",borderBottom:"1px solid rgba(100,180,255,0.15)",marginBottom:"4px"}}>
                  <div style={{width:"25px",color:"rgba(255,255,255,0.3)",fontSize:"9px"}}>#</div>
                  <div style={{flex:1,color:"rgba(255,255,255,0.3)",fontSize:"9px"}}>PLAYER</div>
                  <div style={{width:"55px",textAlign:"right",color:"rgba(255,255,255,0.3)",fontSize:"9px"}}>DIST</div>
                  <div style={{width:"45px",textAlign:"right",color:"rgba(255,255,255,0.3)",fontSize:"9px"}}>FISH</div>
                  <div style={{width:"50px",textAlign:"right",color:"rgba(255,255,255,0.3)",fontSize:"9px"}}>STREAK</div>
                </div>
                {leaderboard.map((entry, idx) => {
                  const isMe = entry.username === username;
                  const medalColors = ["#ffd700", "#c0c0c0", "#cd7f32"];
                  return (
                    <div key={idx} style={{
                      display:"flex", padding:"6px 8px", alignItems:"center",
                      background: isMe ? "rgba(0,200,255,0.08)" : "transparent",
                      borderRadius:"4px", borderLeft: isMe ? "2px solid #44aacc" : "2px solid transparent",
                    }}>
                      <div style={{width:"25px",color:idx<3?medalColors[idx]:"rgba(255,255,255,0.35)",fontSize:"12px",fontWeight:idx<3?"bold":"normal"}}>
                        {idx<3?["🥇","🥈","🥉"][idx]:`${idx+1}`}
                      </div>
                      <div style={{flex:1,color:isMe?"#88ccee":"rgba(255,255,255,0.7)",fontSize:"12px",fontWeight:isMe?"bold":"normal",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {entry.username}{isMe?" (you)":""}
                      </div>
                      <div style={{width:"55px",textAlign:"right",color:"#88ccee",fontSize:"12px",fontFamily:"monospace"}}>{entry.bestScore}</div>
                      <div style={{width:"45px",textAlign:"right",color:"#66ffcc",fontSize:"12px",fontFamily:"monospace"}}>{entry.bestFish}</div>
                      <div style={{width:"50px",textAlign:"right",color:gCSS(entry.bestStreak),fontSize:"12px",fontFamily:"monospace"}}>{entry.bestStreak}</div>
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={()=>setShowLeaderboard(false)}
              style={{background:"rgba(255,255,255,0.06)",color:"#88ccee",border:"1px solid rgba(100,180,255,0.2)",padding:"8px 20px",borderRadius:"6px",fontSize:"12px",fontFamily:"monospace",cursor:"pointer",marginTop:"12px",letterSpacing:"1px"}}>
              ← BACK
            </button>
          </div>
        )}
      </div>

      <div style={{display:"flex",gap:"16px",marginTop:"16px"}}>
        {gameState==="playing" && (
          <>
            <button onPointerDown={()=>{const g=gameRef.current;if(g&&g.targetLane>0)g.targetLane--;}} style={{background:"rgba(100,180,255,0.08)",color:"#eaeaea",border:"1px solid rgba(100,180,255,0.2)",padding:"14px 28px",borderRadius:"8px",fontSize:"20px",fontFamily:"monospace",cursor:"pointer",userSelect:"none",touchAction:"manipulation"}}>← LEFT</button>
            <button onPointerDown={()=>{const g=gameRef.current;if(g&&g.targetLane<LANE_COUNT-1)g.targetLane++;}} style={{background:"rgba(100,180,255,0.08)",color:"#eaeaea",border:"1px solid rgba(100,180,255,0.2)",padding:"14px 28px",borderRadius:"8px",fontSize:"20px",fontFamily:"monospace",cursor:"pointer",userSelect:"none",touchAction:"manipulation"}}>RIGHT →</button>
          </>
        )}
      </div>
    </div>
  );
}
