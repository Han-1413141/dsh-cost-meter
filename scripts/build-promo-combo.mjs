// 仓库宣传预览拼图(v3,纯英文优先,简约蓝白)→ docs/promo-combo.png
import sharp from 'sharp';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, statSync, promises as statPromises } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DOCS = resolve(ROOT, 'docs');

const COLS = 3;
const ROWS = 2;
const CARD_W = 620;
const CARD_H = 380;
const LABEL_H = 40;
const GAP = 0;
const PAD_X = 0;
const HEADER_H = 100;
const BORDER_R = 14;

const CANVAS_W = PAD_X * 2 + COLS * (CARD_W + 2) + (COLS - 1) * GAP;
const CANVAS_H = HEADER_H + ROWS * (CARD_H + LABEL_H + GAP) - GAP;

function xml(s) { return Buffer.from(s, 'utf-8'); }

// 局部裁切 (x,y,w,h) 后再放大填满卡片
async function extractFit(p, x, y, w, h) {
  return sharp(p).extract({ left: x, top: y, width: w, height: h }).resize(CARD_W, CARD_H, { fit: 'fill' }).png().toBuffer();
}
// 白边 contain(不变形)
async function containFit(p) {
  return sharp(p).resize(CARD_W, CARD_H, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
}
// 直接铺满(不变形 cover,大图用)
async function coverFit(p) {
  return sharp(p).resize(CARD_W, CARD_H, { fit: 'cover' }).png().toBuffer();
}

// 两张图上下拼接,浅灰分割线(纯白底)
async function stackTopBottom(topPath, topH, bottomPath, bottomH, extraTopOpts = {}, extraBottomOpts = {}) {
  const w = CARD_W, h = CARD_H;
  const t = await sharp(resolve(DOCS, topPath))
    .resize(w, topH, { fit: 'fill', ...extraTopOpts })
    .png().toBuffer();
  const b = await sharp(resolve(DOCS, bottomPath))
    .resize(w, bottomH, { fit: 'fill', ...extraBottomOpts })
    .png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([
      { input: t, top: 0, left: 0 },
      { input: xml(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="2"><rect width="${w}" height="2" fill="#e2e8f0"/></svg>`), top: topH, left: 0 },
      { input: b, top: topH + 2, left: 0 },
    ])
    .png().toBuffer();
}

// ===== 8 张卡片(纯英文/通用符号:非 EN 标注的中文截图全部不用): =====
// Row 1 (功能总览):
//   0. Peak notice settings (EN) + Peak panel pricing (EN) 上下拼接——设置界面(带 Notice threshold / Threshold / Peak-off-peak pricing 等英文标签)
//   1. Session dock tally (EN):Input / Output / Cache read / Cache write / Reasoning 纯英文字段
//   2. Dock display settings (EN) + Display mode (screenshot-display-settings-v2 的小选项卡,中英文标签混合但大多英文)→ 实际用 dock-display-settings-en + peak-notice-settings-en 上半(均为 EN 标注)
//   3. Peak strip display (EN) + Peak notice box (EN) 组合——峰谷显示形态
// Row 2 (统计与定价):
//   4. Per-Model / Provider cost breakdown (EN) 主体
//   5. Weekly usage heatmap (Codex style,中文字段但数字/热度主体为主→替换为 model-stats-en 底部 Provider 条形图(纯英文 + $ + 模型名)→更稳妥)
//   6. Provider summary (EN) 顶部 + Price cards top (USD pricing $$$ 英文标签)
//   7. Peak panel settings (EN) + Custom provider 区域裁(从 settings-top-v2 裁 Custom provider box 但注意它含中文!→改为 corner-v2 + sidebar-rail-v2(纯数字不含文字)上下拼,叫 Display modes: corner badge / sidebar rail)
async function buildTile(index) {
  switch (index) {
    case 0:
      // Peak notice settings (EN) 1323×1266 裁上半 1266×700 含 threshold 英文标签
      return extractFit(resolve(DOCS, 'peak-notice-settings-en.png'), 30, 20, 1260, 820);
    case 1:
      // 用户新图(1):会话侧栏面板 (用户已保存为 docs/screenshots/（1）.png)
      {
        const p = resolve(DOCS, 'screenshots', '（1）.png');
        try { await statPromises.stat(p); } catch { throw new Error('❌ 缺少 ' + p); }
        return containFit(p);
      }
    case 2: {
      // Dock display settings (EN) 998×561 (上 52%) + Peak panel settings (EN) 978×450 (下 48%) 上下拼接——纯英文
      const w = CARD_W, h = CARD_H;
      const a = await sharp(resolve(DOCS, 'dock-display-settings-en.png'))
        .resize(w, Math.floor(h * 0.52), { fit: 'contain', background: '#ffffff' }).png().toBuffer();
      const b = await sharp(resolve(DOCS, 'peak-panel-settings-en.png'))
        .resize(w, h - Math.floor(h * 0.52) - 2, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
      return sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
        .composite([
          { input: a, top: 0, left: 0 },
          { input: xml(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="2"><rect width="${w}" height="2" fill="#e2e8f0"/></svg>`), top: Math.floor(h*0.52), left: 0 },
          { input: b, top: Math.floor(h*0.52) + 2, left: 0 },
        ]).png().toBuffer();
    }
    case 3:
    case 6:
      // 已删除(右侧两卡与 Price cards 卡不再使用)
      throw new Error('tile ' + index + ' removed');
    case 4:
      // Per-model / Provider breakdown (EN) — 裁右侧 Provider 汇总(含美元/Remaining/Consumed/模型英文/Provider 英文)
      return extractFit(resolve(DOCS, 'screenshot-model-stats-en.png'), 40, 40, 1470, 760);
    case 5:
      // 用户新图(2):Custom provider balance 英文设置弹窗 (用户已保存为 docs/screenshots/（2）.png)
      {
        const p = resolve(DOCS, 'screenshots', '（2）.png');
        try { await statPromises.stat(p); } catch { throw new Error('❌ 缺少 ' + p); }
        return containFit(p);
      }
    case 7: {
      // 左:In-session peak notice 弹窗(EN,原 card3 下方图,源图无黑边,白底 contain 不产生黑边)
      // 右上/右下:Peak rail compact + expanded compact 两种显示形态
      const w = CARD_W, h = CARD_H;
      const left = await sharp(resolve(DOCS, 'peak-notice-en.png'))
        .resize(Math.floor(w * 0.6), h, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
      // Peak strip rail compact + expanded compact 拼接(两张 EN 标注)
      const rail = await sharp(resolve(DOCS, 'peak-strip-rail-compact-en.png'))
        .resize(Math.floor(w * 0.2), Math.floor(h * 0.45), { fit: 'contain', background: '#ffffff' }).png().toBuffer();
      const expanded = await sharp(resolve(DOCS, 'peak-strip-expanded-compact-en.png'))
        .resize(Math.floor(w * 0.4), Math.floor(h * 0.52), { fit: 'contain', background: '#ffffff' }).png().toBuffer();
      const rmR = await sharp(rail).metadata();
      const rmE = await sharp(expanded).metadata();
      return sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
        .composite([
          { input: left, top: 0, left: 0 },
          { input: expanded, top: 16, left: w - rmE.width - 14 },
          { input: rail, top: h - rmR.height - 14, left: w - rmR.width - 14 },
        ]).png().toBuffer();
    }
  }
  throw new Error('bad index ' + index);
}

const TILE_LABELS = {
  0: 'Peak notice · Peak-off-peak pricing (EN)',
  1: 'Session panel · Go 5h · Budget · Peak countdown (1)',
  2: 'Dock display · Peak panel settings (EN)',
  4: 'Per-model / Provider cost breakdown (EN)',
  5: 'Custom provider balance settings (2) · EN',
  7: 'In-session notice · Peak rail / expanded (EN)',
};

// ===== 简约蓝白配色 =====
function headerSvg(w, h) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#eff6ff"/>
      <stop offset="1" stop-color="#f8fafc"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" x2="1">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#0ea5e9"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect x="0" y="${h-4}" width="${w}" height="4" fill="url(#bar)"/>
  <rect x="${PAD_X}" y="14" width="6" height="${h-28}" fill="url(#bar)" rx="3"/>
  <text x="${PAD_X+30}" y="42" font-family="Segoe UI, system-ui, sans-serif" font-size="40" font-weight="800" fill="#0f172a">dsh-cost-meter</text>
  <text x="${PAD_X+30}" y="72" font-family="Segoe UI, system-ui, sans-serif" font-size="20" font-weight="600" fill="#1e3a8a">Cost accounting · Budgets · Balances · Pricing for dsh Web</text>
  <text x="${PAD_X+30}" y="94" font-family="Segoe UI, system-ui, sans-serif" font-size="15" font-weight="400" fill="#475569">Live session metering · 90+ models · DeepSeek peak/off-peak tiers · Custom provider endpoints</text>
</svg>`;
}

function labelSvg(w, h, label) {
  const safe = String(label).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#eff6ff"/>
  <rect x="0" y="0" width="4" height="${h}" fill="#2563eb"/>
  <text x="22" y="${h/2 + 6}" font-family="Segoe UI, system-ui, sans-serif" font-size="17" font-weight="600" fill="#0f172a">${safe}</text>
</svg>`;
}

async function roundedCard(tileBuf, labelText) {
  const w = CARD_W;
  const h = CARD_H + LABEL_H;
  const combined = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([
      { input: tileBuf, top: 0, left: 0 },
      { input: xml(labelSvg(w, LABEL_H, labelText)), top: CARD_H, left: 0 },
    ])
    .png().toBuffer();
  const mask = xml(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="${BORDER_R}" ry="${BORDER_R}" fill="#000"/></svg>`);
  const cut = await sharp(combined).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const bw = w + 2, bh = h + 2;
  return sharp({ create: { width: bw, height: bh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: xml(`<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}"><rect width="${bw}" height="${bh}" rx="${BORDER_R+1}" ry="${BORDER_R+1}" fill="#cbd5e1"/></svg>`), top: 0, left: 0 },
      { input: cut, top: 1, left: 1 },
    ])
    .png().toBuffer();
}

async function main() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  const TILES = [0, 1, 2, 4, 5, 7];
  const tileBufs = await Promise.all(TILES.map(buildTile));
  const cards = await Promise.all(tileBufs.map((buf, i) => roundedCard(buf, TILE_LABELS[TILES[i]])));
  const cardW = CARD_W + 2, cardH = CARD_H + LABEL_H + 2;

  const headerBuf = xml(headerSvg(CANVAS_W, HEADER_H));

  const comps = [{ input: headerBuf, top: 0, left: 0 }];
  cards.forEach((buf, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD_X + col * (cardW + GAP);
    const y = HEADER_H + row * (cardH + GAP);
    comps.push({ input: buf, top: y, left: x });
  });

  const outPath = resolve(DOCS, 'promo-combo.png');
  await sharp({ create: { width: CANVAS_W, height: CANVAS_H, channels: 3, background: { r: 248, g: 250, b: 252 } } })
    .composite(comps)
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toFile(outPath);

  const s = statSync(outPath);
  console.log(`✅ 已生成 ${outPath}`);
  console.log(`   尺寸: ${CANVAS_W} × ${CANVAS_H} px   大小: ${(s.size/1024).toFixed(1)} KB`);
}

main().catch(e => { console.error('❌ 失败:', e); process.exit(1); });
