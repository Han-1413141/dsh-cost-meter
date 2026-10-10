// 真实 React + 真实浏览器回归:费用明细弹窗不得压住 DSH 标题栏(窗口按钮区)。
// 用法: node test/statistics-dialog-titlebar.mjs [node_modules] [--wait] [--browser=<exe>] [--timeout=<ms>]
//   node_modules  含 react/react-dom 的目录;缺省取 DSH_TEST_NODE_MODULES(与其它浏览器回归同约定)。
//   --wait        自己启动一个无头浏览器打开本页,等页面回报结果后按退出码结束(CI 用)。
//                 浏览器取自 --browser,其次 CM_TEST_BROWSER,再按 PATH 与常见安装路径探测;
//                 找不到就以非零退出,而不是静默等人手动打开。
//   不加 --wait   进程打印地址供人工打开核对(页面同时显示 PASS/FAIL)。
//
// 本文件是「机器可判定」的:页面把断言结果 POST 回 /report,Node 进程据此决定退出码
// (全通过 0,有失败 1,超时 1)。
//
// 背景:DSH 桌面版(Windows)把关闭/最小化/全屏按钮画在视口顶部 40px 的覆盖层里
// (app.asar → /lib/preload-app.cjs 设 --dsh-windows-titlebar-height: 40px)。原生
// modal <dialog> 默认 inset:0 + margin:auto 在整个视口居中,顶部会钻进这条标题栏,
// 压住窗口按钮 —— 实测 1280x800 压 25px、900x600 压 35px(按钮被盖 84–88%)。
//
// 本测试锁定三条不变式:
//   A. Windows 桌面版:弹窗与 40px 标题栏零重叠,且窄窗口不横向溢出;
//   B. 桌面版全屏:--dsh-frame-chrome-top 归 0,弹窗回到普通 16px 边距(不留空隙);
//   C. 纯 Web(无标记、变量缺失):回退 0px,行为与修复前一致。
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { build } from 'esbuild'

process.on('exit', () => { try { cleanupBrowser() } catch (error) { /* 退出路径上的清理失败无需上报 */ } })

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const positional = args.filter(arg => !arg.startsWith('--'))
const explicitBrowser = (args.find(arg => arg.startsWith('--browser=')) ?? '').slice('--browser='.length)
const waitForBrowser = args.includes('--wait')
const hostDir = positional[0] ?? process.env.DSH_TEST_NODE_MODULES ?? ''
if (!hostDir) throw new Error('Pass the node_modules directory containing react and react-dom (argv or DSH_TEST_NODE_MODULES)')
const nodeModules = resolve(hostDir)

// ── 无头浏览器:让本回归在 CI 里可判定 ──────────────────────────────────────
// 只驱动一个已经存在的浏览器(不装 Playwright/Puppeteer):GitHub runner 与常见桌面
// 环境都自带 Chrome/Edge,装一份浏览器驱动只会给这条回归增加几百 MB 依赖。
const BROWSER_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'msedge', 'microsoft-edge']
const BROWSER_PATHS = process.platform === 'win32'
  ? [join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe')]
  : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome', '/snap/bin/chromium']

function findBrowser() {
  const explicit = explicitBrowser || process.env.CM_TEST_BROWSER || ''
  if (explicit) {
    if (!existsSync(explicit)) throw new Error('--browser/CM_TEST_BROWSER 指向的文件不存在: ' + explicit)
    return explicit
  }
  for (const candidate of BROWSER_PATHS) if (candidate && existsSync(candidate)) return candidate
  for (const name of BROWSER_NAMES) {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      if (!dir) continue
      for (const file of [join(dir, name), join(dir, name + '.exe')]) if (existsSync(file)) return file
    }
  }
  return null
}

let browserProcess = null, browserProfile = null, reported = false
function cleanupBrowser() {
  try { browserProcess?.kill() } catch (error) { /* 已退出 */ }
  try { if (browserProfile !== null) rmSync(browserProfile, { recursive: true, force: true }) } catch (error) { /* 清理失败不影响结论 */ }
}
function launchBrowser(url) {
  let executable
  try { executable = findBrowser() } catch (error) { console.log('FAIL ' + error.message); process.exit(1) }
  if (executable === null) {
    console.log('FAIL no headless browser found: pass --browser=<exe> or set CM_TEST_BROWSER (tried PATH and common install paths)')
    process.exit(1)
  }
  // 独立的 user-data-dir:复用正在运行的桌面浏览器配置会直接被拒绝启动。
  browserProfile = mkdtempSync(join(tmpdir(), 'cm-dialog-titlebar-'))
  browserProcess = spawn(executable, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', '--user-data-dir=' + browserProfile, url], { stdio: 'ignore' })
  browserProcess.on('error', error => { console.log('FAIL browser launch failed: ' + error.message); cleanupBrowser(); process.exit(1) })
  browserProcess.on('exit', code => { if (!reported) console.log('browser exited before reporting (code ' + code + ')') })
}

// 拼接顺序片段(与 scripts/build.mjs 同口径),额外暴露内部组件供测量页渲染真实弹窗。
const source = readdirSync(resolve(root, 'src/client')).filter(n => n.endsWith('.js')).sort()
  .map(n => readFileSync(resolve(root, 'src/client', n), 'utf8')).join('')
  .replace('exports.apply = apply', 'exports.preview = { SessionStatisticsButton }; exports.apply = apply')

const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
let factory; window.__ModuleLoader__={load:m=>factory=m.factory};
${source}
const ui=factory(n=>n==='react'?React:{Tooltip:({children})=>children}).preview;
const config={locale:'zh',decimals:2,showTotalWithPlan:false};
// [关键] 明细内容必须足够高,弹窗才会被 max-height 顶到可用区上沿。
// 若这里只给一句短占位,弹窗只有 ~96px、垂直居中后根本够不到标题栏,
// 「与标题栏重叠」的断言就会**空过**(修复前也 PASS),失去回归价值。
const tall=new URLSearchParams(location.search).get('tall')!=='0';
const rows=tall?120:2;
const Tall=()=>React.createElement('div',null,...Array.from({length:rows},(_,i)=>React.createElement('p',{key:i},'费用明细占位行 '+(i+1))));
const props={sessionId:'synthetic',useCost:()=>({state:{config}}),api:{loadStatistics:async()=>Tall,reload(){}}};
// Wait for the initial effects too: the entry can exist before the component's
// session-reset effect runs. Clicking at that point can have its open state reset.
function App(){
  React.useEffect(()=>{window.fixtureReady=true},[]);
  return React.createElement(ui.SessionStatisticsButton,{...props,entryPosition:'dock'});
}
createRoot(document.getElementById('root')).render(React.createElement(App));`

const bundle = await build({
  stdin: { contents: entry, loader: 'js', resolveDir: root }, bundle: true, write: false,
  nodePaths: [nodeModules], format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
})

// 每个用例:同一弹窗在三种宿主环境 + 多种视口下的几何断言。
// 标题栏覆盖层高 40px,三枚窗口按钮各 46px 紧贴右上角(几何取自真实 DSH 窗口截图)。
const page = `<!doctype html><meta charset="utf-8"><title>Dialog vs titlebar regression</title>
<style>
  body{margin:0;font:14px system-ui}
  iframe{border:1px solid #ccc;display:block;margin:8px 0}
  #result{font-weight:600}
</style>
<h1>费用明细弹窗 · DSH 标题栏避让回归</h1>
<p id="result" role="status">Ready</p>
${[['dsh', 1280, 800, 1], ['dsh', 900, 600, 1], ['dsh', 520, 600, 1],
  // 短内容档:走「可用区居中」分支。只测高内容会让居中分支一次都不执行
  // (margin:auto 与 margin:16px 在顶满时同值,断言照样全绿)。
  ['dsh', 1280, 800, 0], ['dsh', 900, 600, 0], ['dsh', 520, 600, 0],
  ['fullscreen', 1280, 800, 1], ['fullscreen', 1280, 800, 0], ['web', 1280, 800, 1], ['web', 1280, 800, 0],
  // 旧宿主(DSH ≤0.1.7):没有 --dsh-frame-chrome-top,Windows 下也没有 top-clearance
  // (它只为 darwin 定义,见下面 frameVars),回退链落到 preload 注入的 40px。
  // 不覆盖这一档,修复会在 CI 矩阵覆盖的旧宿主上静默失效而测试仍全绿。
  ['legacy', 1280, 800, 1], ['legacy', 900, 600, 1], ['legacy', 1280, 800, 0],
  // 旧宿主 + 全屏:回退链只能命中不随全屏变化的 40px,必须由样式表 [data-fullscreen] 归零。
  ['legacy-fullscreen', 1280, 800, 1], ['legacy-fullscreen', 1280, 800, 0],
  // macOS:不设 data-windows-titlebar,红绿灯区由 --dsh-frame-top-clearance: 48px 表达。
  ['darwin', 1280, 800, 1], ['darwin', 900, 600, 1], ['darwin', 1280, 800, 0]]
  .map(([env, w, h, tall]) => `<iframe title="${env}|${w}x${h}|t${tall}" width="${w}" height="${h}" src="/case?env=${env}&tall=${tall}"></iframe>`).join('')}
<script>
const frames=[...document.querySelectorAll('iframe')];
// 轮询等待,且**每次都重新取 contentDocument**:iframe 尚未加载完时 contentDocument
// 是初始 about:blank(它的 readyState 也是 'complete'),若只取一次就会永远查到那个
// 过期文档。这里每 tick 重取,超时才失败。
const waitFor=(fn,timeout=8000)=>{const deadline=Date.now()+timeout;return new Promise((res,rej)=>{
  const tick=()=>{let v=null;try{v=fn()}catch{}if(v)return res(v);if(Date.now()>deadline)return rej(Error('timeout waiting for element'));setTimeout(tick,50)};
  tick();
})};
let checks=0, currentCase='bootstrap'; const failures=[];
// 失败不立即抛出:收集全部失败项后一次性报告,避免第一条失败掩盖后面。
const record=(ok,msg)=>{checks++;if(!ok)failures.push(msg)};
const report=tag=>{try{fetch('/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tag,failures,checks})})}catch(e){}};
(async()=>{
  try{
    for(const frame of frames){
      currentCase=frame.title;
      // 标题形如 <env>|<w>x<h>|t<0|1>;env 本身含 '-' (legacy-fullscreen),
      // 所以用 '|' 分隔,不能按 '-' 拆。
      const parts=frame.title.split('|'), env=parts[0], tall=parts[2]==='t1';
      // 所有断言统一带上档位前缀:省掉 24 处手工拼接,漏拼也不会定位不到档位。
      const check=(ok,msg)=>record(ok,frame.title+' '+msg);
      const entry=await waitFor(()=>frame.contentWindow?.fixtureReady&&frame.contentDocument?.querySelector('.cm-stat-entry'));
      const doc=frame.contentDocument, win=frame.contentWindow, root=doc.documentElement;
      const hasTitlebar=root.hasAttribute('data-windows-titlebar');
      const isFullscreen=root.hasAttribute('data-fullscreen');
      const isDarwin=env==='darwin';
      // 有效顶部避让高度 = 平台 chrome 实际占用的高度(也就是弹窗必须让开的量):
      //   Windows 桌面版非全屏 -> 40px(标题栏覆盖层)
      //   macOS               -> 48px(红绿灯区;不设 data-windows-titlebar)
      //   全屏 / 纯 Web        -> 0
      const titlebar=(isDarwin?48:(hasTitlebar&&!isFullscreen)?40:0);
      // 不再断言 !!entry / !!dialog:waitFor 只在回调返回真值时 resolve、超时即 reject,
      // 能走到这里就说明元素必然存在,那两条断言恒真(零判别力)。
      entry.click();
      const dialog=await waitFor(()=>doc.querySelector('dialog[open]'));
      const r=dialog.getBoundingClientRect();
      // titlebar===0 的档位(全屏/纯 Web)重叠量恒为 0,该断言在那些档没有判别力 ——
      // 「不留空隙」由下面的 expectedTop 断言守住,这里显式标注,不假装它在守全屏档。
      const overlap=Math.max(0,Math.min(r.bottom,titlebar)-Math.max(r.top,0));
      check(titlebar===0||overlap===0,'dialog must not overlap the titlebar (got '+overlap.toFixed(1)+'px)');
      // 关闭按钮必须在标题栏下方且不越界 —— 否则用户点不到它。
      const close=dialog.querySelector('.cm-stat-dialog-head > .cm-btn');
      check(!!close,'close button present');
      const cr=close.getBoundingClientRect();
      check(cr.top>=titlebar-0.5,'close button stays below the titlebar');
      check(cr.right<=win.innerWidth+0.5,'close button stays inside the viewport');
      // 窄窗口不得横向溢出。
      check(r.width<=win.innerWidth+0.5,'dialog must not overflow horizontally (w='+r.width.toFixed(1)+' vw='+win.innerWidth+')');
      check(r.left>=-0.5,'dialog left edge inside viewport');
      // 垂直定位:必须在标题栏**下方**的可用区域里居中(而不是整个视口居中),
      // 且不得越过视口底部。内容不高时 top = 标题栏 + (可用高-弹窗高)/2;
      // 内容被 max-height 约束时 top = 标题栏 + 16。
      const available=win.innerHeight-titlebar;
      // 分支由 fixture 决定,不用渲染高度反推:弹窗高度恰好等于 max-height 上限时
      // (tall 档正是如此),r.height>=available-32 会因亚像素舍入翻转(实测 747.62
      // vs 748),把顶满误判成居中,于是 6 个 tall 档全挂。改为直接按 tall 取期望值,
      // 再用独立断言确认两档各自确实落在目标分支上。
      const expectedTop=tall ? titlebar+16 : titlebar+(available-r.height)/2;
      check(Math.abs(r.top-expectedTop)<=1.5,'dialog centered below the titlebar (got '+r.top.toFixed(1)+', expected '+expectedTop.toFixed(1)+')');
      // 高内容档必须真的被 max-height 顶满(高度贴住上限),短内容档必须没被顶满。
      // 这两条保证「顶满」与「可用区居中」两条布局分支都真的被执行到。
      if(tall) check(Math.abs(r.height-(available-32))<=1.5,'tall dialog fills the height cap (height='+r.height.toFixed(1)+', cap='+(available-32)+')');
      else check(r.height<available-32-1,'short dialog stays below the height cap (height='+r.height.toFixed(1)+', cap='+(available-32)+')');
      // 高度上限必须真的生效(样式已移到 .cm-stat-dialog 规则,宿主变量非法时若不生效,
      // 弹窗会被内容撑到视口外且无法滚动)。max-height:none 即为失效。
      const cs=getComputedStyle(dialog);
      check(cs.maxHeight!=='none','dialog keeps a height cap (max-height='+cs.maxHeight+')');
      check(r.bottom<=win.innerHeight+0.5,'dialog must not overflow the viewport bottom (bottom='+r.bottom.toFixed(1)+' vh='+win.innerHeight+')');
      // 内容超高时必须真的可滚动:断言「确实溢出且滚动范围 > 0」,而不是断言
      // overflow==='auto' —— 裸 <dialog> 的 UA 默认值就是 auto,那条断言恒真(空断言)。
      // 改为断言「高内容确实溢出且可滚动」/「短内容不被裁剪」。
      const body=dialog.querySelector('.cm-stat-dialog-body');
      if(tall){
        check(body.scrollHeight>body.clientHeight,'body content really overflows');
        body.scrollTop=body.scrollHeight;
        await new Promise(resolve=>win.requestAnimationFrame(resolve));
        const after=close.getBoundingClientRect();
        check(body.scrollTop>0,'body scrolls to the bottom');
        check(Math.abs(after.top-cr.top)<1,'close button remains fixed after scrolling');
        check(doc.elementFromPoint(after.x+after.width/2,after.y+after.height/2)===close,'close is clickable after scrolling');
      }else{
        check(body.scrollHeight<=body.clientHeight+1,'short dialog content is not clipped');
      }
      check(parseFloat(win.getComputedStyle(dialog,'::backdrop').top)===titlebar,'backdrop dims content uniformly without dimming only part of the native titlebar');
      // 环境特定断言。宿主变量一律经 cssVar 读,省掉 10 处 getComputedStyle(...).trim() 拼接。
      const cssVar=n=>win.getComputedStyle(root).getPropertyValue(n).trim();
      if(env==='fullscreen') check(cssVar('--dsh-frame-chrome-top')==='0px','chrome-top is 0 in fullscreen');
      if(env==='web'){
        check(!hasTitlebar,'plain web has no windows-titlebar marker');
        check(!cssVar('--dsh-frame-chrome-top'),'plain web has no chrome-top');
        check(!cssVar('--dsh-frame-top-clearance'),'plain web has no top-clearance');
        check(!cssVar('--dsh-windows-titlebar-height'),'plain web has no preload titlebar height');
      }
      // 旧宿主没有 chrome-top、也没有 Windows 版 top-clearance:必须靠
      // --dsh-windows-titlebar-height 兜住,否则修复静默失效(这正是本档位要守的回归)。
      // legacy 与 legacy-fullscreen 共用前两条(后者是前者的子集),只有 top-clearance 那条是 legacy 独有。
      if(env.indexOf('legacy')===0){
        check(!cssVar('--dsh-frame-chrome-top'),'legacy host has no chrome-top');
        check(cssVar('--dsh-windows-titlebar-height')==='40px','legacy host exposes titlebar height');
        if(env==='legacy') check(!cssVar('--dsh-frame-top-clearance'),'legacy host has no windows top-clearance');
      }
      if(env==='darwin') check(cssVar('--dsh-frame-top-clearance')==='48px','darwin exposes 48px top clearance');
      // 关闭走 React 状态更新,慢机器上固定 sleep 会假失败:这里保留条件轮询
      // (waitFor 只在回调返回真值时 resolve),既等到真的关闭,又不引入固定等待。
      close.click();
      check(await waitFor(()=>!doc.querySelector('dialog[open]'),3000),'dialog closes');
    }
    const tag=failures.length===0?'PASS '+checks+' assertions':'FAIL '+failures.length+'/'+checks+'\\n'+failures.join('\\n');
    document.getElementById('result').textContent=tag;
    document.title='RESULT:'+tag;
    report(tag);
  }catch(e){const tag='FAIL '+checks+' '+currentCase+' '+e.message;document.getElementById('result').textContent=tag;document.title='RESULT:'+tag;report(tag);}
})();
</script>`

const server = createServer((request, response) => {
  if (request.url === '/entry.js') {
    response.setHeader('content-type', 'text/javascript; charset=utf-8')
    response.end(bundle.outputFiles[0].text)
    return
  }
  // 页面把断言结果回传到这里:进程据此决定退出码,从而能被 CI 判定。
  if (request.url === '/report') {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      let parsed = {}
      try { parsed = JSON.parse(body) } catch (error) { parsed = { tag: 'FAIL unparsable report' } }
      const tag = String(parsed.tag || 'FAIL no tag')
      reported = true
      console.log(tag)
      if (tag.startsWith('FAIL')) for (const item of parsed.failures || []) console.log('  - ' + item)
      response.end('ok')
      server.close()
      cleanupBrowser()
      process.exit(tag.startsWith('FAIL') ? 1 : 0)
    })
    return
  }
  response.setHeader('content-type', 'text/html; charset=utf-8')
  if (!request.url.startsWith('/case')) { response.end(page); return }
  const requestedEnv = new URL(request.url, 'http://127.0.0.1').searchParams.get('env') ?? 'dsh'
  // Select a constant scenario. Never interpolate the request parameter into HTML
  // or JavaScript: JSON.stringify alone does not escape a closing script tag.
  const environments = { dsh: 'dsh', fullscreen: 'fullscreen', web: 'web', legacy: 'legacy', 'legacy-fullscreen': 'legacy-fullscreen', darwin: 'darwin' }
  const env = Object.hasOwn(environments, requestedEnv) ? environments[requestedEnv] : null
  if (env === null) {
    response.statusCode = 400
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end('Unknown test environment')
    return
  }
  const isLegacy = env.indexOf('legacy') === 0
  const isFullscreenEnv = env === 'fullscreen' || env === 'legacy-fullscreen'
  // [真实] 逐字复刻 app.asar /lib/preload-app.cjs 的标记注入与 dsh-client-ui-layout 的变量定义。
  // darwin 不设 data-windows-titlebar(macOS 用 hiddenInset,红绿灯由系统画)。
  // legacy(DSH ≤0.1.7)**没有** chrome-top,且 top-clearance 只为 darwin 定义 ——
  // Windows 下唯一的高度信号是 preload 注入的 --dsh-windows-titlebar-height
  // (实测 0.1.7-rc.2 的 client.js:top-clearance 仅出现于 html[data-platform=darwin])。
  const preload = env === 'web' || env === 'darwin' ? '' : `
    root.dataset.windowsTitlebar='';
    root.style.setProperty('--dsh-windows-titlebar-height','40px');
    ${isFullscreenEnv ? "root.dataset.fullscreen='true';" : ''}`
  const isDarwin = env === 'darwin'
  // 旧宿主(≤0.1.7)与 macOS 都只有 darwin 那条 top-clearance(旧宿主在 Windows 下没有它,
  // 于是回退链落到 preload 的 40px —— 这正是旧宿主档要守的回归)。
  const frameVars = isLegacy || isDarwin
    ? 'html[data-platform=darwin]{--dsh-frame-top-clearance:48px}'
    // DSH ≥0.2.0:Windows 定义 chrome-top(全屏归 0);darwin 仍只有 top-clearance
    : `html[data-windows-titlebar]{--dsh-frame-top-clearance:var(--dsh-windows-titlebar-height);--dsh-frame-chrome-top:var(--dsh-windows-titlebar-height)}
html[data-windows-titlebar][data-fullscreen]{--dsh-frame-chrome-top:0px}`
  // 标题栏覆盖层:darwin 用 48px 红绿灯区,其余用 preload 注入的高度。
  // 全屏档**不画**这条覆盖层:真实宿主全屏时原生按钮已隐藏,若 fixture 一边画着 40px
  // 覆盖层、一边期望 titlebar=0,就是自相矛盾(此前的问题)。全屏档改由 expectedTop=16
  // 这条断言守住「不留空隙」。
  const captionHeight = isDarwin ? '48px' : 'var(--dsh-windows-titlebar-height)'
  const caption = env === 'web' || isFullscreenEnv ? '' : `<div id="caption" aria-hidden="true"><i>–</i><i>□</i><i>×</i></div>`
  // 纯 Web 环境**没有** preload,因此 --dsh-windows-titlebar-height 必须不存在
  // (真实 DSH 里它只由 Windows preload 注入)。若在 :root 里无条件定义它,
  // 四级回退的最后一档就会被误命中,测出的行为与真实纯 Web 不符。
  const titlebarHeightVar = env === 'web' ? '' : '--dsh-windows-titlebar-height:40px;'
  response.end(`<!doctype html><meta charset="utf-8"><style>
:root{${titlebarHeightVar}
  --dsw-alias-border-l1:#e0e5ed;--dsw-alias-border-l3:#e9eaed;--dsw-alias-label-primary:#0f1115;
  --dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#858a94;--dsw-alias-bg-base:#fff;
  --dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#f0f3f7;--dsw-alias-interactive-bg-hover:#eff0f3;
  --dsw-alias-state-business-primary:#4d6bfe;--dsw-alias-brand-primary:#4d6bfe}
${frameVars}
/* 真实 DSH 产品页面【没有】全局 box-sizing 重置:此处刻意不写,保持 <dialog> 为 content-box */
html,body{height:100%;margin:0;font:14px system-ui}
#caption{position:fixed;inset:0 0 auto;height:${captionHeight};background:#2b2f36;z-index:2147483647;display:flex;justify-content:flex-end}
#caption i{width:46px;height:100%;display:grid;place-items:center;color:#fff;font-style:normal}
#root{padding:24px}
</style>
${caption}
<div id="root"></div>
<script>
(function(){const root=document.documentElement;${isDarwin ? "root.dataset.platform='darwin';" : ''}${preload}})();
</script>
<script src="/entry.js"></script>`)
})
server.listen(0, '127.0.0.1', async () => {
  const url = 'http://127.0.0.1:' + server.address().port
  console.log(url)
  try {
    for (const env of ['</script><script>globalThis.injected=true</script>', '__proto__', 'constructor', '']) {
      const response = await fetch(url + '/case?env=' + encodeURIComponent(env))
      if (response.status !== 400 || (await response.text()) !== 'Unknown test environment') throw new Error('unsafe environment accepted')
    }
    console.log('[ok] fixture rejects script injection and unknown environments without reflecting input')
  } catch (error) { console.log('FAIL ' + error.message); process.exit(1) }
  if (waitForBrowser) {
    console.log('--wait: 启动无头浏览器执行断言,按页面回报的退出码结束。')
    launchBrowser(url)
    return
  }
  console.log('打开上面的地址核对;页面回报结果后进程会按退出码结束。')
})
// 超时保护:页面没能回报结果(例如浏览器没打开)时以非零退出,避免 CI 无限挂起。
const timeoutMs = Number((args.find(a => a.startsWith('--timeout=')) || '').split('=')[1] || (waitForBrowser ? 180000 : 120000))
setTimeout(() => { console.log('FAIL timeout: no report within ' + timeoutMs + 'ms'); cleanupBrowser(); process.exit(1) }, timeoutMs).unref()
