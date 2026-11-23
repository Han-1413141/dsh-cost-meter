// Browser regression for #192 and #576. Start with:
// node test/sidebar-footer-layout.mjs <directory containing react and react-dom> [--baseline v1.7.42]
// Open the printed URL and click Run regression. No real host/account is contacted.
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig } from '../lib/store.js'

const root = resolve(import.meta.dirname, '..')
const reactDir = process.argv[2]
if (!reactDir) throw new Error('Pass a node_modules directory containing react and react-dom')
const baselineIndex = process.argv.indexOf('--baseline')
const baseline = baselineIndex < 0 ? null : process.argv[baselineIndex + 1] ?? 'v1.7.42'
const fragments = readdirSync(resolve(root, 'src/client')).filter(n => n.endsWith('.js')).sort()
const source = fragments.map(n => baseline
  ? execFileSync('git', ['show', `${baseline}:src/client/${n}`], { cwd: root, encoding: 'utf8' })
  : readFileSync(resolve(root, 'src/client', n), 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.preview = { SidebarFooter }; exports.apply = apply')
const config = sanitizeConfig({ locale: 'zh', hideOfficialBalance: true, goQuota: { enabled: false },
  peakEnabled: true, peakNotice: true, sidebarModels: { enabled: true } })
// Footer geometry copied from DSH's SidebarRoot.module.css and
// bowenliang123/dsh-context src/client/styles/overview.css (2026-09-28 snapshot).
// IMPORTANT: SlotOutlet in ui-renderer/src/client/scoped-slots.tsx also adds
// <div data-slot="sidebar.footer.action" style={{display:'contents'}}>.
// The wrapper has no layout box, but changes DOM ancestry for :has(>...)!
const hostCSS = `
.host{padding:6px 12px;box-sizing:border-box;background:#f7f8fa;font-size:14px}
.host.collapsed{padding:18px 10px 6px}
.footArea{flex:none;display:flex;flex-direction:column}
.settingsArea,.footerActions{flex:none;min-width:0;width:100%}
.footerActions{display:flex}
.collapsed .footArea{align-items:center}
.collapsed .settingsArea,.collapsed .footerActions{display:flex;justify-content:center;width:auto}
.lc-ov-entry{display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;box-sizing:border-box;margin:0 -2px;border:0;padding:0 10px 0 8px;overflow:hidden;background:transparent;border-radius:12px;color:inherit;font:inherit;line-height:22px;cursor:pointer}
.lc-ov-entry-rail{flex:none;justify-content:center;gap:0;width:36px;height:36px;margin:0;padding:0;border-radius:50%}
.lc-ov-entry-icon{flex:none}
.lc-ov-entry-label{flex:1 1 auto;min-width:0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.extra{width:36px;height:36px;flex:none;border:0;background:transparent}
.settingsArea{height:42px;padding-top:10px;box-sizing:border-box}
`
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
let factory; window.__ModuleLoader__={load:v=>factory=v.factory};
${source}
const {SidebarFooter}=factory(n=>n==='react'?React:{Tooltip:({children})=><>{children}</>}).preview;
const totals={cost:1,apiCost:1,calls:1,input:100,output:20,cacheRead:0,cacheWrite:0,byProviderModel:{'deepseek:deepseek-v4-pro':{cost:1,apiCost:1,input:100,output:20,cacheRead:0,cacheWrite:0}}};
const state={config:${JSON.stringify(config)},today:totals,month:totals,total:totals,history:[],balance:{status:'off'},goQuota:{status:'off'},codingPlans:{},gatewayQuotas:{sources:[]}};
let update, checks=0;
function Scenario({width=280,simple=false,compact=false,enabled=true,hidden=false,extra=true,context=true,locale='zh',index=0,wrapped=true}){
 const wide=width>56, label=locale==='zh'?'上下文洞察':'Context Insights';
 const snapshot={...state,config:{...state.config,locale,sidebarSimple:simple,sidebarStyle:compact?'compact':'standard',hideTodayCost:hidden,peakNotice:!hidden,sidebarModels:{...state.config.sidebarModels,enabled:!hidden}}};
 const entries=<>
 {context&&<button key="context" className={'lc-ov-entry'+(wide?'':' lc-ov-entry-rail')} aria-label={label}><span className="lc-ov-entry-icon">▣</span>{wide&&<span className="lc-ov-entry-label">{label}</span>}</button>}
 {enabled&&<SidebarFooter key="cost" wide={wide} useCost={pick=>pick({state:snapshot})}/>}
 {extra&&<button key="extra" className="extra" aria-label="Remote control">↗</button>}
 </>;
 return <section data-case={index} data-expect-card={enabled && !hidden}><h2>{width}px · {simple?'简化':compact?'紧凑':'标准'} · {locale} · {wrapped?'有 SlotOutlet 包裹':'无包裹'}</h2><div className={'host'+(wide?'':' collapsed')} style={{width}}><div className="footArea"><div className="footerActions">
 {wrapped?<div data-slot="sidebar.footer.action" style={{display:'contents'}}>{entries}</div>:entries}
 </div><div className="settingsArea">{wide?'⚙ 设置':'⚙'}</div></div></div></section>
}
function App(){const [dynamic,setDynamic]=React.useState({});update=setDynamic;return <><h1>#192 侧栏布局回归</h1><button onClick={run}>Run regression</button><p id="result" role="status">Ready</p><main>{[true,false].flatMap(wrapped=>[240,280,360,56].flatMap(width=>['standard','compact','simple'].flatMap(mode=>['zh','en'].map(locale=><Scenario key={width+mode+locale+wrapped} width={width} compact={mode==='compact'} simple={mode==='simple'} locale={locale} wrapped={wrapped} index={width+mode+locale+wrapped}/>))))}</main><h2>动态挂载 / 隐藏 / 展开收起</h2><div id="dynamic"><Scenario {...dynamic}/></div></>}
function check(ok,msg){checks++;if(!ok)throw new Error(msg)}
function measure(section){
 const host=section.querySelector('.host'), parent=section.querySelector('.footerActions'), stack=parent.querySelector('.cm-footer-stack');
 const context=parent.querySelector('.lc-ov-entry'), extra=parent.querySelector('.extra'), wide=!host.classList.contains('collapsed');
 const rect=n=>n.getBoundingClientRect(), p=rect(parent), label=section.getAttribute('data-case');
 check(Boolean(stack)===(section.dataset.expectCard==='true'),label+' configured cost card is present even with peers');
 if(stack){const s=rect(stack);check(Math.abs(s.width-p.width)<1,label+' cost has full footer width');
  for(const button of [context,extra].filter(Boolean)){const b=rect(button);check(wide?b.top>=s.bottom-1:b.bottom<=s.top+1,label+' sibling does not share cost row');}
  check(stack.scrollWidth<=stack.clientWidth+1,label+' cost has no horizontal overflow');
 }
 if(context){const c=rect(context);check(Math.abs(c.width-(wide?p.width+4-(!stack&&extra?36:0):36))<1,label+' context keeps native width');
  const text=context.querySelector('.lc-ov-entry-label');if(text)check(text.scrollWidth<=text.clientWidth+1,label+' context label visible');}
 if(extra)check(Math.abs(rect(extra).width-36)<1,label+' extra button stays 36px');
 const slot=parent.querySelector('[data-slot="sidebar.footer.action"]');
 if(slot)check(slot.style.cssText==='display: contents;',label+' slot remains layout-neutral');
 const order=[...(slot??parent).children].map(n=>n.classList.contains('lc-ov-entry')?'context':n.classList.contains('cm-footer-stack')?'cost':'extra');
 check(order.join(',')===[context&&'context',stack&&'cost',extra&&'extra'].filter(Boolean).join(','),label+' React DOM order unchanged');
 check(parent.getAttribute('style')===null,label+' host inline styles untouched');
 if(!stack||slot){const style=getComputedStyle(parent);check(style.flexDirection==='row'&&style.flexWrap==='nowrap',label+' host layout restored');}
}
const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function run(){const result=document.getElementById('result');checks=0;try{
 document.querySelectorAll('main section').forEach(measure);
 for(const wrapped of [true,false])for(const next of [{width:56},{width:56,hidden:true},{width:56,enabled:false},{width:280},{width:280,context:false},{width:280,context:true,extra:false},{width:56,simple:true},{width:360,compact:true},{width:280,hidden:true},{width:280}]){
  flushSync(()=>update({...next,wrapped}));await frame();measure(document.querySelector('#dynamic section'));
 }
 result.textContent='PASS: 48 layouts + 20 transitions, '+checks+' assertions';
 }catch(error){result.textContent='FAIL: '+error.message;console.error(error)}}
createRoot(document.getElementById('root')).render(<App/>);
`
const bundle = await build({ stdin: { contents: entry, loader: 'jsx', resolveDir: root },
  nodePaths: [resolve(reactDir)], bundle: true, write: false, format: 'iife', logLevel: 'silent' })
const html = `<!doctype html><meta charset="utf-8"><title>#192 Sidebar layout regression</title><style>
:root{--dsw-alias-label-primary:#182035;--dsw-alias-label-secondary:#454545;--dsw-alias-label-tertiary:#777;--dsw-alias-state-business-primary:#4176e6;--dsw-alias-bg-layer-1:white;--dsw-alias-border-l1:#ddd;--dsw-alias-interactive-bg-hover:#eee}
body{font:14px Arial;padding:20px;color:#182035}main{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}h2{font-size:14px}#result{font-weight:bold}
${hostCSS}</style><div id="root"></div><script src="/app.js"></script>`
const server = createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/app.js'?bundle.outputFiles[0].contents:html)})
server.listen(0,'127.0.0.1',()=>console.log('Open http://127.0.0.1:'+server.address().port))
