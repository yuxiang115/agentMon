// A real reducer + PetOverlay replay, isolated from all user state.
// npm run demo:device             terminal animation (~17 seconds)
// npm run demo:device -- --export out/device-preview.html
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { activePet, addPet, createPet, freshState, levelFromXp, reduceEvent } from "../packages/core";
import type { EventType } from "../packages/events/types";
import { PetOverlay } from "../packages/pi-extension/widget";
import { setColorMode } from "../packages/renderer/src/halfblock";
import { BOTAMON, KOROMON, AGUMON } from "../pets/sprites/agumon-line";
import { PNG } from "pngjs";

setColorMode("true");
const exportIndex = process.argv.indexOf("--export");
const output = exportIndex >= 0 ? resolve(process.argv[exportIndex + 1] ?? "out/device-preview.html") : null;
let state = addPet(freshState(0), createPet({ name: "Partner", species: "botamon", now: 0 }));
let clock = 0;
const overlay = new PetOverlay({ requestRender() {}, showOverlay() { throw new Error("unused"); } }, () => state, 100, () => 0.5);
const frames: string[] = [];
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function htmlFrame(s: string): string {
  let result = "", last = 0, fg = "#c9e1c3", bg = "transparent";
  for (const match of s.matchAll(/\x1b\[([0-9;]*)m/g)) {
    result += `<span style="color:${fg};background:${bg}">${escape(s.slice(last, match.index))}</span>`;
    const codes = match[1].split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      if (codes[i] === 0) { fg = "#c9e1c3"; bg = "transparent"; }
      if ((codes[i] === 38 || codes[i] === 48) && codes[i + 1] === 2) {
        const color = `rgb(${codes.slice(i + 2, i + 5).join(",")})`;
        if (codes[i] === 38) fg = color; else bg = color;
        i += 4;
      }
    }
    last = match.index! + match[0].length;
  }
  return result + `<span style="color:${fg};background:${bg}">${escape(s.slice(last))}</span>`;
}

function events(...types: EventType[]): void {
  const before = activePet(state)!;
  for (const type of types) state = reduceEvent(state, { type, ts: ++clock });
  const after = activePet(state)!;
  overlay.refresh(state);
  if (after.species !== before.species) overlay.startEvolve(before.species);
  if (after.counters.xp > before.counters.xp) {
    const level = levelFromXp(after.counters.xp);
    overlay.startReward(`+${after.counters.xp - before.counters.xp} XP${level > levelFromXp(before.counters.xp) ? ` · LEVEL UP ${level}!` : " · quest reward"}`);
  }
}
const cycle = () => events("READ", "CODE_WRITE", "TEST_START", "TEST_PASS", "TASK_COMPLETE");
const schedule = new Map<number, () => void>([
  [10, () => events("THINK_START")], [20, () => events("READ")],
  [30, () => events("CODE_WRITE")], [40, () => events("TEST_START")],
  [50, () => events("TEST_FAIL")], [60, () => events("CODE_WRITE", "TEST_START", "TEST_PASS")],
  [70, () => events("TASK_COMPLETE")],
  [85, () => { for (let i = 0; i < 4; i++) cycle(); }],
  [120, () => { for (let i = 0; i < 9; i++) cycle(); }],
]);

try {
  if (!output) process.stdout.write("\x1b[?25l");
  for (let frame = 0; frame <= 165; frame++) {
    schedule.get(frame)?.();
    const rendered = overlay.render(36).join("\n");
    if (output) frames.push(htmlFrame(rendered));
    else process.stdout.write(`\x1b[H\x1b[2JDEMO ONLY — accelerated tasks; no saves\n${rendered}\n`);
    await wait(100);
  }
} finally {
  overlay.dispose();
  if (!output) process.stdout.write("\x1b[?25h");
}

if (output) {
  mkdirSync(dirname(output), { recursive: true });
  const species = [BOTAMON, KOROMON, AGUMON];
  const art = (index: number) => {
    const s = species[index];
    const pixels = s.poses.idleA.flatMap((row, y) => [...row].flatMap((c, x) => c === "." ? [] :
      [`<rect x="${x}" y="${y}" width="1" height="1" fill="${s.palette![c]}"/>`])).join("");
    return `<svg viewBox="0 0 16 16" width="128" height="128" shape-rendering="crispEdges">${pixels}</svg>`;
  };
  writeFileSync(output, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>agentMon · Coding Digivice</title>
<style>*{box-sizing:border-box}body{margin:0;background:#101816;color:#e9eee6;font:16px system-ui}main{max-width:1100px;margin:48px auto;padding:24px}small{color:#a2baaa;letter-spacing:3px}h1{font-size:42px;margin:12px 0}p{color:#adc0b2;line-height:1.8}.layout{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:36px}.device{padding:22px;background:#293b33;border:2px solid #4b6354;border-radius:24px;box-shadow:0 16px 50px #0005}pre{font:16px/20px Consolas,'Courier New',monospace;background:#15221a;border-radius:12px;padding:16px;margin:0;overflow:auto}button{background:#b6e384;color:#142015;border:0;border-radius:8px;padding:10px 13px;cursor:pointer;margin:4px}input{width:100%;accent-color:#b6e384}.forms{display:flex;justify-content:space-between;margin:20px 0}.form{text-align:center;color:#cee0d1}.form b{display:block}.form svg{background:#bac9a8;border-radius:12px;margin-bottom:10px}.notes{font-size:14px;padding:16px 0;border-top:1px solid #354c40}.stage{color:#ddf39f;min-height:28px}@media(max-width:850px){.layout{grid-template-columns:1fr}h1{font-size:32px}}</style>
<main><small>AGENTMON / CODING DIGIVICE</small><h1>把每一次完成，养成进化。</h1><p>黑球兽 → 滚球兽 → 亚古兽。真实插件渲染器回放：思考、探索、编写、验证、奖励、升级、进化。</p><div class="layout"><div class="device"><pre id="screen"></pre><p class="stage" id="stage"></p><input id="seek" aria-label="回放进度" type="range" min="0" max="${frames.length - 1}" value="0"><button id="play">暂停</button><button data-frame="0">黑球兽</button><button data-frame="85">第一次进化</button><button data-frame="120">亚古兽进化</button></div><div><div class="forms">${species.map((s, i) => `<div class="form">${art(i)}<b>${["黑球兽", "滚球兽", "亚古兽"][i]}</b><p>${s.lifeStage}</p></div>`).join("")}</div><h2>工作，就是训练。</h2><p>完成任务 +10 XP<br>验证通过 +5 XP · 首次通过再 +5 XP<br>新改动测试通过 +3 XP / 构建通过 +2 XP</p><div class="notes">Lv.2 / 100 XP + 3 个任务 → 滚球兽<br>Lv.3 / 300 XP + 8 个任务 + 2 次验证任务 → 亚古兽</div><div class="notes">这是加速演示，不会修改宠物存档。<br>Pi 内输入 <code>/pet journey</code> 查看成长；<br><code>/pet hatch</code> 领养新黑球兽并保留旧伙伴。</div></div></div></main>
<script>const frames=${JSON.stringify(frames).replaceAll("<", "\\u003c")};let n=0,playing=true;const screen=document.getElementById('screen'),seek=document.getElementById('seek'),play=document.getElementById('play'),stage=document.getElementById('stage');function draw(){screen.innerHTML=frames[n];seek.value=n;stage.textContent=n>=120?'第二次进化 · 亚古兽':n>=85?'第一次进化 · 滚球兽':n>=70?'任务结算 · 获得经验':n>=60?'修复后验证通过':n>=50?'验证失败 · 重试':n>=40?'正在验证':n>=30?'正在编写代码':n>=20?'正在探索':n>=10?'正在思考':'黑球兽 · 等待任务';}play.onclick=()=>{playing=!playing;play.textContent=playing?'暂停':'播放'};seek.oninput=()=>{n=+seek.value;draw()};document.querySelectorAll('[data-frame]').forEach(b=>b.onclick=()=>{n=+b.dataset.frame;draw()});setInterval(()=>{if(playing){n=(n+1)%frames.length;draw()}},100);draw();</script></html>`, "utf8");
  // Native-pixel contact sheet, useful for reviewing the actual shipped art.
  const png = new PNG({ width: 600, height: 200 });
  for (let y = 0; y < 200; y++) for (let x = 0; x < 600; x++) {
    const s = species[Math.floor(x / 200)];
    const sx = Math.floor((x % 200 - 36) / 8), sy = Math.floor((y - 36) / 8);
    const c = s.poses.idleA[sy]?.[sx];
    const color = c && c !== "." ? s.palette![c] : "#bac9a8";
    const i = (y * 600 + x) * 4;
    [1, 3, 5].forEach((offset, channel) => { png.data[i + channel] = parseInt(color.slice(offset, offset + 2), 16); });
    png.data[i + 3] = 255;
  }
  writeFileSync(resolve(dirname(output), "agumon-line.png"), PNG.sync.write(png));
  console.log(`Preview: ${output}`);
}
