// Browser regression for #214: the composer-dock cost entry must read like the
// native stats beside it — two parts joined by "·", one clickable row, currency before amount.
// Run with a node_modules path containing react, react-dom and playwright-core.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig } from '../lib/store.js'

const root = resolve(import.meta.dirname, '..')
const peerCss = process.argv[3] && !process.argv[3].startsWith('--') ? readFileSync(resolve(process.argv[3]), 'utf8') : ''
if (!process.argv[2]) throw new Error('Pass the node_modules directory containing react and react-dom')
const modules = process.argv[2]
const browserReq = createRequire(resolve(modules, '__cost_entry_layout.cjs'))
const { chromium } = browserReq('playwright-core')
const source = readdirSync(resolve(root, 'src/client')).filter(n => n.endsWith('.js')).sort()
  .map(n => readFileSync(resolve(root, 'src/client', n), 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.preview = { SessionStatisticsButton, DockLine, CornerChips }; exports.apply = apply')
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
let factory;window.__ModuleLoader__={load:m=>factory=m.factory};
${source}
const ui=factory(n=>n==='react'?React:{Tooltip:({children})=>children}).preview;
const locale=new URLSearchParams(location.search).get('locale')||'zh';
const config={...${JSON.stringify(sanitizeConfig({ corner: { enabled: true, budget: true }, budget: { enabled: true, amount: 100 } }))},locale};
const usage={input:1200000,cacheRead:13400000,cacheWrite:0,output:263000,cost:0.8629583};
const props={sessionId:'synthetic',useProjection:()=>usage,useCost:()=>({state:{config,budgetUsed:0}}),api:{loadStatistics:async()=>()=>React.createElement('p',null,'Synthetic details')}};
const title=locale==='zh'?'这是一段需要保留可读性的会话标题':'A conversation title that must remain readable';
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
  React.createElement('header',null,React.createElement('span',{className:'title'},title),React.createElement(ui.SessionStatisticsButton,{...props})),
  React.createElement('main',null,'Synthetic conversation'),
  React.createElement('footer',null,React.createElement('div',{'data-slot':'conversation.composer.dock'},
    React.createElement('div',{className:'native-stats anchor'},
      React.createElement('span',{className:'native-pill pill'},locale==='zh'?'◷ 2 轮 26 步 · 273 tok/s':'◷ 2 turns 26 steps · 273 tok/s'),
      React.createElement('span',{className:'native-pill pill'},locale==='zh'?'▤ 1.4M tok · 缓存命中 98%':'▤ 1.4M tok · cache hit 98%')),
    React.createElement(ui.DockLine,props),
    React.createElement(ui.CornerChips,props)),React.createElement('span',{className:'context-meter'},'◌ 8%'))));`
const bundle = await build({ stdin: { contents: entry, loader: 'js', resolveDir: root }, bundle: true, write: false,
  nodePaths: [resolve(modules)], format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } })
const widths = [320, 360, 390, 414, 480, 640, 641, 768, 1440]
const overview = `<!doctype html><meta charset="utf-8"><title>Cost entry layout regression</title>
<style>body{font:14px system-ui}iframe{height:150px;border:1px solid #aaa}section{margin:12px 0}</style>
<h1>#214 费用入口窄屏回归</h1><button id="run">Run regression</button><p id="result" role="status">Ready</p>
${widths.flatMap(width => ['zh','en'].map(locale => `<section>${width}px · ${locale}<br><iframe title="${width}-${locale}" width="${width}" src="/case?locale=${locale}"></iframe></section>`)).join('')}
<script>
document.getElementById('run').onclick=async()=>{let checks=0;const check=(ok,msg)=>{checks++;if(!ok)throw Error(msg)};
try{for(const frame of document.querySelectorAll('iframe')){const doc=frame.contentDocument,win=frame.contentWindow,header=doc.querySelector('.cm-stat-header'),title=doc.querySelector('.title');
const dock=doc.querySelector('.cm-dp');
const label=doc.querySelector('.cm-dl');
const amountVisible=()=>!!label&&label.getBoundingClientRect().width>0&&label.getBoundingClientRect().right<=dock.getBoundingClientRect().right+1;
check(!!dock,frame.title+' merged cost entry mounted');
check(!dock.querySelector('.cm-dsym'),frame.title+' currency is part of the amount, not a leading icon');
check(['本会话 ¥','This session ¥'].some(prefix=>label.textContent.startsWith(prefix)),frame.title+' configured currency immediately precedes the amount');
check(label.textContent.split('¥').length===2,frame.title+' ordinary amount shows its currency once');
check(dock.textContent.includes('·'),frame.title+' the two parts are joined by ·');
check(amountVisible(),frame.title+' session amount is readable beside native stats');
doc.querySelectorAll('.native-pill').forEach((pill,i)=>{pill.textContent=i?'▤ 14.8M tok · cache hit 92%':'◷ 3 turns 175 steps · 51 tok/s';});
check(amountVisible(),frame.title+' async native stats do not squeeze session amount away');
check(!dock.title,frame.title+' hover details come from the host Tooltip, not a native title');
check(dock.getAttribute('aria-label')==='本会话费用明细'||dock.getAttribute('aria-label')==='Conversation cost details',frame.title+' accessible name retained');
check(dock.getBoundingClientRect().height<=24,frame.title+' compact typography');
const dockStyle=win.getComputedStyle(dock);
check(dockStyle.paddingLeft==='8px'&&dockStyle.paddingRight==='8px',frame.title+' official pill padding');
check(dockStyle.borderRadius==='6px',frame.title+' official pill radius');
const transparent = value => value === 'rgba(0, 0, 0, 0)' || value === 'transparent';
check(transparent(dockStyle.backgroundColor),frame.title+' idle pill has no background');
check(doc.documentElement.scrollWidth<=win.innerWidth,frame.title+' no horizontal page overflow');
if(win.innerWidth<=640){check(win.getComputedStyle(header).display==='none',frame.title+' header entry hidden');const before=title.getBoundingClientRect().width;check(before>0,frame.title+' title keeps full baseline width');}
else check(header.getBoundingClientRect().width>0,frame.title+' desktop header entry unaffected');
check(dock.getBoundingClientRect().width>0,frame.title+' composer entry remains accessible');
const stats=doc.querySelector('.native-stats'),corner=doc.querySelector('.cm-corner'),meter=doc.querySelector('.context-meter');
for(const part of [stats,corner,meter])check(Math.abs(part.getBoundingClientRect().top+part.getBoundingClientRect().height/2-dock.getBoundingClientRect().top-dock.getBoundingClientRect().height/2)<2,frame.title+' native stats, cost entry, budget and context stay in one row');
check(dock.getBoundingClientRect().right<=corner.getBoundingClientRect().left+1,frame.title+' cost entry does not overlap quota chips');
dock.click();await new Promise(r=>setTimeout(r,40));check(!!doc.querySelector('dialog[open]'),frame.title+' the whole row opens the details dialog');
check(dock.getAttribute('aria-expanded')==='true',frame.title+' pill exposes its expanded state');
check(win.getComputedStyle(dock).backgroundColor==='rgb(240, 241, 244)',frame.title+' expanded pill uses the official hover background');
doc.querySelector('dialog button').click();await new Promise(r=>setTimeout(r,20));check(!doc.querySelector('dialog'),frame.title+' details close');
check(transparent(win.getComputedStyle(dock).backgroundColor),frame.title+' closed pill drops the background again');
}document.getElementById('result').textContent='PASS '+checks+' assertions';}catch(e){document.getElementById('result').textContent='FAIL '+checks+' '+e.message;}};
</script>`
const server = createServer((request, response) => {
  if (request.url === '/peer.css') { response.setHeader('content-type','text/css; charset=utf-8'); response.end(peerCss); return }
  if (request.url === '/entry.js') { response.setHeader('content-type','text/javascript; charset=utf-8'); response.end(bundle.outputFiles[0].text); return }
  response.setHeader('content-type','text/html; charset=utf-8')
  response.end(request.url.startsWith('/case') ? `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/peer.css"><style>
:root{--dsw-alias-label-primary:#25262b;--dsw-alias-label-secondary:#737780;--dsw-alias-label-tertiary:#858a94;--dsw-alias-interactive-bg-hover:#f0f1f4;--dsw-alias-separator-primary:#c4c7cc;--dsw-radius-sm:6px;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-base:#fff}
body{margin:0;font:14px system-ui;color:#222}header,footer{display:flex;align-items:center;gap:12px;box-sizing:border-box;max-width:100%}header{padding:12px}.title{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}main{padding:8px}footer{font-size:12px;justify-content:center;padding:4px 4px 0}[data-slot]{display:contents}.native-stats{display:flex;justify-content:center;gap:12px;min-width:0;max-width:100%;line-height:20px}.native-pill{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.context-meter{flex:none;white-space:nowrap;line-height:20px}button{font:inherit}dialog{box-sizing:border-box}
</style><div id="root"></div><script src="/entry.js"></script>` : overview)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const url = 'http://127.0.0.1:' + server.address().port
if (!process.argv.includes('--check')) console.log(url)
else {
  const executablePath = process.env.CM_TEST_BROWSER ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url)
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(frame => frame.contentDocument.querySelector('.cm-dp')))
    await page.locator('#run').click()
    await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.querySelector('#result').textContent))
    const result = await page.locator('#result').innerText()
    mkdirSync('.tmp-cost-entry', { recursive: true })
    await page.screenshot({ path: '.tmp-cost-entry/layout.png', fullPage: true })
    assert.match(result, /^PASS/)
    assert.deepEqual(errors, [])
    console.log('[ok] composer currency and native stats layout: ' + result)
  } finally { await browser.close(); await new Promise(done => server.close(done)) }
}
