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
  .replace('exports.apply = apply', 'exports.preview = { SessionStatisticsButton }; exports.apply = apply')
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
let factory;window.__ModuleLoader__={load:m=>factory=m.factory};
${source}
const ui=factory(n=>n==='react'?React:{}).preview;
const locale=new URLSearchParams(location.search).get('locale')||'zh';
const config={...${JSON.stringify(sanitizeConfig({}))},locale};
const props={sessionId:'synthetic',useCost:()=>({state:{config}}),api:{loadStatistics:async()=>()=>React.createElement('p',null,'Synthetic details')}};
const title=locale==='zh'?'这是一段需要保留可读性的会话标题':'A conversation title that must remain readable';
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
  React.createElement('header',null,React.createElement('span',{className:'title'},title),React.createElement('button',null,'PTC'),React.createElement(ui.SessionStatisticsButton,{...props,entryPosition:'header'})),
  React.createElement('main',null,'Synthetic conversation'),
  React.createElement('footer',null,React.createElement('span',null,locale==='zh'?'费用 ¥0.02':'Cost $0.02'),React.createElement(ui.SessionStatisticsButton,{...props,entryPosition:'dock'}))));`
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
dock.click();await new Promise(r=>setTimeout(r,40));check(!!doc.querySelector('dialog[open]'),frame.title+' details open');
doc.querySelector('dialog button').click();await new Promise(r=>setTimeout(r,20));check(!doc.querySelector('dialog'),frame.title+' details close');
}document.getElementById('result').textContent='PASS '+checks+' assertions';}catch(e){document.getElementById('result').textContent='FAIL '+checks+' '+e.message;}};
</script>`
const server = createServer((request, response) => {
  if (request.url === '/entry.js') { response.setHeader('content-type','text/javascript; charset=utf-8'); response.end(bundle.outputFiles[0].text); return }
  response.setHeader('content-type','text/html; charset=utf-8')
  response.end(request.url.startsWith('/case') ? `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:14px system-ui;color:#222}header,footer{display:flex;align-items:center;gap:8px;padding:12px;box-sizing:border-box;max-width:100%}.title{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}header>button{flex-shrink:0}main{padding:8px}footer{font-size:12px;flex-wrap:wrap}button{font:inherit}dialog{box-sizing:border-box}
</style><div id="root"></div><script src="/entry.js"></script>` : overview)
})
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:'+server.address().port))
