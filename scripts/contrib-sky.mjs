// Draws the last year of GitHub contributions as a moonlit night sky: every day is a star,
// active days are joined into a constellation, and an ember comet flies along it.
// usage: GITHUB_TOKEN=... node scripts/contrib-sky.mjs <login> <out.svg>
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [login = "HavenLeno22", out = "dist/contrib-sky.svg"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is not set");

const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
  totalContributions weeks{contributionDays{date contributionCount contributionLevel weekday}}}}}}`;
const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "contrib-sky" },
  body: JSON.stringify({ query, variables: { login } }),
});
const json = await res.json();
if (!res.ok || json.errors) throw new Error(`GraphQL failed: ${JSON.stringify(json.errors || json)}`);
const cal = json.data.user.contributionsCollection.contributionCalendar;
const weeks = cal.weeks;

// ---- stats ----
const days = weeks.flatMap(w => w.contributionDays);
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
const busiest = days.reduce((a, b) => (b.contributionCount > a.contributionCount ? b : a), days[0]);
const activeDays = days.filter(d => d.contributionCount > 0).length;
const fmt = iso => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// ---- layout ----
const W = 1600, H = 450, BAR = 46;
const X0 = 78, CELL = (W - X0 - 170) / Math.max(53, weeks.length), Y0 = 128, ROW = 36;
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const STYLE = [
  { r: 1.6, fill: "#c7d2fe", op: 0.28 },
  { r: 3.4, fill: "#e6ecf8", op: 0.95 },
  { r: 4.4, fill: "#ffe2bf", op: 1 },
  { r: 5.4, fill: "#ffb15e", op: 1 },
  { r: 6.6, fill: "#ff9a3c", op: 1 },
];
// a small stable jitter so the sky looks hand-scattered rather than gridded
const jit = (s, k) => { const x = Math.sin(s * 12.9898 + k * 78.233) * 43758.5453; return (x - Math.floor(x) - 0.5) * 7; };

const stars = [], path = [];
weeks.forEach((w, wi) => w.contributionDays.forEach(d => {
  const i = wi * 7 + d.weekday;
  const x = X0 + wi * CELL + CELL / 2 + jit(i, 1), y = Y0 + d.weekday * ROW + jit(i, 2);
  const lv = LEVEL[d.contributionLevel] ?? 0;
  stars.push({ x, y, lv, i, d });
  if (lv > 0) path.push({ x, y, date: d.date });
}));

const r1 = n => n.toFixed(1);
// faint background dust so quiet stretches still read as sky
const dust = Array.from({ length: 140 }, (_, k) => `<circle cx="${r1(((jit(k, 5) / 7 + 0.5) * W))}" cy="${r1(BAR + 20 + (jit(k, 6) / 7 + 0.5) * (H - BAR - 40))}" r="${(0.5 + (jit(k, 7) / 7 + 0.5) * 0.9).toFixed(2)}" fill="#e6ecff" opacity="${(0.12 + (jit(k, 8) / 7 + 0.5) * 0.3).toFixed(2)}"/>`).join("");
const starSvg = stars.map(s => {
  const st = STYLE[s.lv];
  if (s.lv === 0) return `<circle cx="${r1(s.x)}" cy="${r1(s.y)}" r="${st.r}" fill="${st.fill}" opacity="${st.op}"/>`;
  const tw = `tw${(s.i % 4) + 1}`;
  return `<g class="${tw}" style="animation-delay:-${(s.i % 7) * 0.6}s"><circle cx="${r1(s.x)}" cy="${r1(s.y)}" r="${st.r * 2.6}" fill="url(#halo${s.lv})"/>` +
    `<circle cx="${r1(s.x)}" cy="${r1(s.y)}" r="${st.r}" fill="${st.fill}" filter="url(#glow)"/>` +
    (s.lv >= 3 ? `<path d="M${r1(s.x - st.r * 2.2)} ${r1(s.y)}H${r1(s.x + st.r * 2.2)}M${r1(s.x)} ${r1(s.y - st.r * 2.2)}V${r1(s.y + st.r * 2.2)}" stroke="${st.fill}" stroke-width="1" opacity=".55"/>` : "") +
    `<title>${s.d.date}: ${s.d.contributionCount} contribution${s.d.contributionCount === 1 ? "" : "s"}</title></g>`;
}).join("");

// constellation: join active days in date order, breaking the line across long gaps
const segs = [];
let cur = [];
path.forEach((p, k) => {
  if (k && (new Date(p.date) - new Date(path[k - 1].date)) / 864e5 > 21) { if (cur.length > 1) segs.push(cur); cur = []; }
  cur.push(p);
});
if (cur.length > 1) segs.push(cur);
const lines = segs.map(s => `<polyline points="${s.map(p => `${r1(p.x)},${r1(p.y)}`).join(" ")}" fill="none" stroke="#9fb4ff" stroke-opacity=".32" stroke-width="1.3" stroke-linejoin="round"/>`).join("");

// the comet follows every active day; with no activity it just crosses the sky
const route = path.length > 1 ? path : [{ x: X0 - 40, y: Y0 + 2 * ROW }, { x: W - 40, y: Y0 + 4 * ROW }];
const routeD = `M${r1(route[0].x)} ${r1(route[0].y)}` + route.slice(1).map(p => `L${r1(p.x)} ${r1(p.y)}`).join("");
const dur = Math.min(26, Math.max(10, route.length * 0.35));

const months = [];
weeks.forEach((w, wi) => {
  const d = new Date(w.contributionDays[0].date + "T00:00:00Z");
  if (d.getUTCDate() <= 7) months.push(`<text x="${r1(X0 + wi * CELL + 2)}" y="${Y0 - 34}" class="m">${d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }).toLowerCase()}</text>`);
});

const mono = `ui-monospace,'SFMono-Regular','JetBrains Mono',Consolas,'Liberation Mono',monospace`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${cal.totalContributions} contributions in the last year, drawn as a night sky">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1430"/><stop offset=".7" stop-color="#14234a"/><stop offset="1" stop-color="#1b2b56"/></linearGradient>
  <radialGradient id="moonglow"><stop offset="0" stop-color="#dfe6f2" stop-opacity=".28"/><stop offset="1" stop-color="#dfe6f2" stop-opacity="0"/></radialGradient>
  <radialGradient id="moon" cx=".38" cy=".36"><stop offset="0" stop-color="#f6f8fd"/><stop offset=".6" stop-color="#cfd8e8"/><stop offset="1" stop-color="#aab6cc"/></radialGradient>
  ${[1, 2, 3, 4].map(l => `<radialGradient id="halo${l}"><stop offset="0" stop-color="${STYLE[l].fill}" stop-opacity="${0.18 + l * 0.08}"/><stop offset="1" stop-color="${STYLE[l].fill}" stop-opacity="0"/></radialGradient>`).join("")}
  <radialGradient id="milky"><stop offset="0" stop-color="#8b7cf6" stop-opacity=".16"/><stop offset=".5" stop-color="#5b7bd6" stop-opacity=".08"/><stop offset="1" stop-color="#5b7bd6" stop-opacity="0"/></radialGradient>
  <radialGradient id="milky2"><stop offset="0" stop-color="#ffd7a8" stop-opacity=".10"/><stop offset="1" stop-color="#ffd7a8" stop-opacity="0"/></radialGradient>
  <linearGradient id="tail" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="-170" y2="0"><stop offset="0" stop-color="#ffd7a8"/><stop offset=".25" stop-color="#ff9a3c" stop-opacity=".8"/><stop offset="1" stop-color="#ff6a1a" stop-opacity="0"/></linearGradient>
  <filter id="glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <clipPath id="win"><rect width="${W}" height="${H}" rx="22"/></clipPath>
</defs>
<style>
  .m{font:500 15px ${mono};fill:#7f8aa6}
  .t{font:600 16px ${mono};fill:rgba(226,232,240,.72)}
  .s{font:500 18px ${mono};fill:#9aa7c2}.s tspan.v{fill:#ffb15e;font-weight:700}
  .tw1{animation:tw 3.2s ease-in-out infinite}.tw2{animation:tw 4.1s ease-in-out infinite}
  .tw3{animation:tw 2.6s ease-in-out infinite}.tw4{animation:tw 5s ease-in-out infinite}
  @keyframes tw{0%,100%{opacity:1}50%{opacity:.45}}
  @media (prefers-reduced-motion:reduce){.tw1,.tw2,.tw3,.tw4{animation:none}}
</style>
<g clip-path="url(#win)">
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <g transform="rotate(-14 ${W / 2} ${H / 2})"><ellipse cx="${W * 0.46}" cy="${H * 0.52}" rx="${W * 0.62}" ry="62" fill="url(#milky)"/><ellipse cx="${W * 0.38}" cy="${H * 0.5}" rx="${W * 0.36}" ry="24" fill="url(#milky2)"/></g>
  ${dust}
  <circle cx="${W - 82}" cy="${BAR + 92}" r="190" fill="url(#moonglow)"/>
  <circle cx="${W - 82}" cy="${BAR + 92}" r="34" fill="url(#moon)"/>
  <ellipse cx="${W * 0.3}" cy="${H + 20}" rx="420" ry="60" fill="#c8d2eb" opacity=".06"/>
  <ellipse cx="${W * 0.78}" cy="${H + 10}" rx="380" ry="55" fill="#c8d2eb" opacity=".07"/>
  ${months.join("")}
  ${lines}
  ${starSvg}
  <g>
    <path d="M0 0H-170" stroke="url(#tail)" stroke-width="6" stroke-linecap="round"/><path d="M0 0L-110 -5M0 0L-110 5" stroke="url(#tail)" stroke-width="1.6" opacity=".7"/>
    <circle r="5.5" fill="#fff4e0" filter="url(#glow)"/>
    <circle r="14" fill="url(#halo4)"/>
    <animateMotion dur="${dur.toFixed(1)}s" repeatCount="indefinite" rotate="auto" path="${routeD}"/>
  </g>
  <rect width="${W}" height="${BAR}" fill="#0f1429"/>
  <rect y="${BAR - 1}" width="${W}" height="1" fill="#ff9a3c" opacity=".55"/>
  <circle cx="26" cy="${BAR / 2}" r="6.5" fill="#ff5f57"/><circle cx="48" cy="${BAR / 2}" r="6.5" fill="#febc2e"/><circle cx="70" cy="${BAR / 2}" r="6.5" fill="#28c840"/>
  <text x="${W / 2}" y="${BAR / 2 + 6}" text-anchor="middle" class="t">haven@universe: ~ — git log --graph --since=1.year</text>
  <text x="${X0}" y="${H - 34}" class="s"><tspan class="v">${cal.totalContributions}</tspan> contributions · <tspan class="v">${activeDays}</tspan> active days · longest streak <tspan class="v">${longest}</tspan> day${longest === 1 ? "" : "s"} · brightest night <tspan class="v">${fmt(busiest.date)}</tspan></text>
  <g transform="translate(${W - 350},${H - 40})"><text class="s" x="0" y="6">dim</text>
    ${[0, 1, 2, 3, 4].map((l, k) => `<circle cx="${58 + k * 30}" cy="0" r="${STYLE[l].r}" fill="${STYLE[l].fill}" opacity="${STYLE[l].op}"${l ? ' filter="url(#glow)"' : ""}/>`).join("")}
    <text class="s" x="${58 + 5 * 30 - 6}" y="6">bright</text></g>
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="22" fill="none" stroke="#fff" stroke-opacity=".13"/>
</svg>`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`wrote ${out}: ${cal.totalContributions} contributions, ${activeDays} active days, streak ${longest}`);
