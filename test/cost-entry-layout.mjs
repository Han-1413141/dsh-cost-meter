// Browser regression for #214. Run with a node_modules path containing React.
import { readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig } from '../lib/store.js'

const root = resolve(import.meta.dirname, '..')
if (!process.argv[2]) throw new Error('Pass the node_modules directory containing react and react-dom')
const source = readdirSync(resolve(root, 'src/client')).filter(n => n.endsWith('.js')).sort()
  .map(n => readFileSync(resolve(root, 'src/client', n), 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.preview = { SessionStatisticsButton, CornerChips }; exports.apply = apply')
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
let factory;window.__ModuleLoader__={load:m=>factory=m.factory};
${source}
const ui=factory(n=>n==='react'?React:{Tooltip:({children})=>children}).preview;
const locale=new URLSearchParams(location.search).get('locale')||'zh';
const config={...${JSON.stringify(sanitizeConfig({ corner: { enabled: true, budget: true }, budget: { enabled: true, amount: 100 } }))},locale};
const props={sessionId:'synthetic',useCost:()=>({state:{config,budgetUsed:0}}),api:{loadStatistics:async()=>()=>React.createElement('p',null,'Synthetic details')}};
const title=locale==='zh'?'这是一段需要保留可读性的会话标题':'A conversation title that must remain readable';
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
  React.createElement('header',null,React.createElement('span',{className:'title'},title),React.createElement('button',null,'PTC'),React.createElement(ui.SessionStatisticsButton,{...props,entryPosition:'header'})),
  React.createElement('main',null,'Synthetic conversation'),
  React.createElement('footer',null,React.createElement('div',{'data-slot':'conversation.composer.dock'},
    React.createElement('div',{className:'native-stats'},
      React.createElement('span',{className:'native-pill'},locale==='zh'?'◷ 2 轮 26 步 · 273 tok/s':'◷ 2 turns 26 steps · 273 tok/s'),
      React.createElement('span',{className:'native-pill'},locale==='zh'?'▤ 1.4M tok · 缓存命中 98%':'▤ 1.4M tok · cache hit 98%')),
    React.createElement(ui.SessionStatisticsButton,{...props,entryPosition:'dock'}),
    React.createElement(ui.CornerChips,props)),React.createElement('span',{className:'context-meter'},'◌ 8%'))));`
const bundle = await build({ stdin: { contents: entry, loader: 'js', resolveDir: root }, bundle: true, write: false,
  nodePaths: [resolve(process.argv[2])], format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } })
const widths = [320, 360, 390, 414, 480, 640, 641, 768, 1440]
const overview = `<!doctype html><meta charset="utf-8"><title>Cost entry layout regression</title>
<style>body{font:14px system-ui}iframe{height:150px;border:1px solid #aaa}section{margin:12px 0}</style>
<h1>#214 费用入口窄屏回归</h1><button id="run">Run regression</button><p id="result" role="status">Ready</p>
${widths.flatMap(width => ['zh','en'].map(locale => `<section>${width}px · ${locale}<br><iframe title="${width}-${locale}" width="${width}" src="/case?locale=${locale}"></iframe></section>`)).join('')}
<script>
document.getElementById('run').onclick=async()=>{let checks=0;const check=(ok,msg)=>{checks++;if(!ok)throw Error(msg)};
try{for(const frame of document.querySelectorAll('iframe')){const doc=frame.contentDocument,win=frame.contentWindow,header=doc.querySelector('.cm-stat-header'),dock=doc.querySelector('.cm-stat-dock'),title=doc.querySelector('.title');
check(!!header&&!!dock,frame.title+' both configured entries mounted');
check(dock.getBoundingClientRect().height<=24,frame.title+' compact typography');
check(doc.documentElement.scrollWidth<=win.innerWidth,frame.title+' no horizontal page overflow');
if(win.innerWidth<=640){check(win.getComputedStyle(header).display==='none',frame.title+' header entry hidden');const before=title.getBoundingClientRect().width;header.style.display='none';check(title.getBoundingClientRect().width===before,frame.title+' title keeps full baseline width');header.style.display='';}
else check(header.getBoundingClientRect().width>0,frame.title+' desktop entry visible');
check(dock.getBoundingClientRect().width>0,frame.title+' composer entry remains accessible');
check(dock.scrollWidth<=dock.clientWidth,frame.title+' details label stays readable');
const stats=doc.querySelector('.native-stats'),corner=doc.querySelector('.cm-corner'),meter=doc.querySelector('.context-meter'),footer=doc.querySelector('footer');
for(const part of [stats,corner,meter])check(Math.abs(part.getBoundingClientRect().top+part.getBoundingClientRect().height/2-dock.getBoundingClientRect().top-dock.getBoundingClientRect().height/2)<2,frame.title+' native stats, details, budget and context stay in one row');
check(footer.getBoundingClientRect().height<=28,frame.title+' no extra footer row or blank space');
check(dock.getBoundingClientRect().right<=corner.getBoundingClientRect().left+1,frame.title+' details do not overlap quota chips');
check(dock.getAttribute('aria-label')===dock.title,frame.title+' full accessible label retained');
dock.click();await new Promise(r=>setTimeout(r,40));check(!!doc.querySelector('dialog[open]'),frame.title+' details open');
doc.querySelector('dialog button').click();await new Promise(r=>setTimeout(r,20));check(!doc.querySelector('dialog'),frame.title+' details close');
}document.getElementById('result').textContent='PASS '+checks+' assertions';}catch(e){document.getElementById('result').textContent='FAIL '+checks+' '+e.message;}};
</script>`
const server = createServer((request, response) => {
  if (request.url === '/entry.js') { response.setHeader('content-type','text/javascript; charset=utf-8'); response.end(bundle.outputFiles[0].text); return }
  response.setHeader('content-type','text/html; charset=utf-8')
  response.end(request.url.startsWith('/case') ? `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:14px system-ui;color:#222}header,footer{display:flex;align-items:center;gap:12px;box-sizing:border-box;max-width:100%}header{padding:12px}.title{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}header>button{flex-shrink:0}main{padding:8px}footer{font-size:12px;justify-content:center;padding:4px 4px 0}[data-slot]{display:contents}.native-stats{display:flex;justify-content:center;gap:12px;min-width:0;max-width:100%;line-height:20px}.native-pill{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.context-meter{flex:none;white-space:nowrap;line-height:20px}button{font:inherit}dialog{box-sizing:border-box}
</style><div id="root"></div><script src="/entry.js"></script>` : overview)
})
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:'+server.address().port))
