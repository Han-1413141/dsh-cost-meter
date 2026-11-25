import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DEFAULT_PROVIDER_PRICE_TABLE,providerPriceEntryFor,upgradeProviderPriceCatalog20261028} from '../lib/pricing.js'
import {PROVIDER_PRICES_BEFORE_2026_10_28} from '../lib/provider-prices.js'
import {SUBSCRIPTION_CATALOG} from '../lib/subscription-catalog.js'
import {parseKimiCodingUsage} from '../lib/coding-plans.js'
import {planProviderIdOf,billingClassOf,enabledPlanSetOf} from '../lib/plan-billing.js'
import {Ledger,sanitizeConfig} from '../lib/store.js'
import {stateSchema} from '../lib/typert.host.js'
const before={...PROVIDER_PRICES_BEFORE_2026_10_28,minimax:{models:{}},moonshot:{models:{'kimi-k3':{input:3,cachedInput:.3,output:15,billingMode:'flat'}}}}
const config=sanitizeConfig({})
const quote=(p,m,currency='USD')=>providerPriceEntryFor(p,m,{...config.prices,currency})
for(const [p,m,input,read,output] of [
 ['moonshot','kimi-k3.1-pro',2,.2,10],['moonshot','kimi-k3.1-pro-highspeed',4,.2,20],
 ['kimi-code','k3.1-pro',2,.2,10],['kimi-code','k3.1-pro-highspeed',4,.2,20],
 ['minimax','MiniMax-M3.1-Flash',.15,.015,.6],['minimax','MiniMax-M3.1-Flash-Preview',.15,.015,.6],
 ['tencent','hy4-preview',.834,.042,2.501],['alibaba','qwen3.8-flash',.15,.016,.47],
 ['openrouter','moonshotai/kimi-k3.1-pro',2,.2,10],['openrouter','nvidia/nemotron-3.5-super-vl:free',0,0,0],['opencode-go','kimi-k3.1-pro',2,.2,10],
 ['opencode-go-plus','minimax-m3.1-flash',.15,.015,.6],['opencode-zen','muse-wonder-1.0',4,.2,20],
 ['opencode-go','gemini-4-argon',2,.1,10],['opencode-zen','beam-free',0,0,0],
]){const row=quote(p,m);assert.equal(row.priced,true,p+':'+m);assert.deepEqual([row.entry.cacheMiss,row.entry.cacheHit,row.entry.output],[input,read,output])}
assert.deepEqual([quote('moonshot','kimi-k3.1-pro','CNY').entry.cacheMiss,quote('moonshot','kimi-k3.1-pro-highspeed','CNY').entry.output],[13,136])
assert.equal(quote('moonshot','kimi-for-coding').priced,false)
assert.equal(quote('custom-relay','beam-free').priced,false)
const goOnly = structuredClone(config.prices)
delete goOnly.providers['opencode-zen'].models['kimi-k3.1-pro']
assert.equal(providerPriceEntryFor('opencode-zen','kimi-k3.1-pro',goOnly).priced,false,'Go listing cannot establish a Zen rate')
assert.equal(quote('opencode-zen','kimi-k3.1-pro').entry.cacheMiss,2,'new Zen listing has its own published rate')
assert.equal(quote('opencode-zen','gpt-6.1-sol').entry.cacheHit,.1)
const old={prices:{providers:structuredClone(before)}}
const custom={input:9,output:90,notes:'manual'}
old.prices.providers.moonshot.models['kimi-k3']=custom
delete old.prices.providers.minimax.models['minimax-m2.7']
upgradeProviderPriceCatalog20261028(old)
assert.deepEqual(old.prices.providers.moonshot.models['kimi-k3'],custom)
assert.equal(old.prices.providers.minimax.models['minimax-m2.7'],undefined)
assert.ok(old.prices.providers.moonshot.models['kimi-k3.1-pro'])
stateSchema.shape.config.parse(sanitizeConfig(old))
assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/provider-pricing.json',import.meta.url))).providers,DEFAULT_PROVIDER_PRICE_TABLE)
assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/subscription-catalog.json',import.meta.url))),SUBSCRIPTION_CATALOG)
for(const p of ['minimax-m-plan','tencent-hy-token-plan','kimi-coding-plan'])assert.ok(planProviderIdOf(p))
for(const p of ['minimax-m-plan','kimi-coding-plan']){assert.equal(billingClassOf(p,'m',config.planBilling,new Set()),'plan');assert.equal(billingClassOf(p,'m',{models:{[p+':m']:'api'}},new Set()),'api')}
for(const p of ['minimax-m-plan','kimi-coding-plan'])assert.equal(billingClassOf(p,'m',config.planBilling,enabledPlanSetOf(sanitizeConfig({codingPlans:{[planProviderIdOf(p)]:{enabled:true}}}))), 'plan')
const five={reset_time:'2026-10-28T18:00:00Z',used_ratio:.35}
const monthly={resetTime:'2026-11-20T00:00:00Z',usedRatio:.12}
const current=parseKimiCodingUsage({code:0,data:{kind:'ok',quota:{usages:{limit_5h:five,limitMonthTotal:monthly}}}})
assert.equal(current['5h'].percent,35);assert.equal(current.monthly.percent,12);assert.equal(current.weekly,undefined)
const legacy=parseKimiCodingUsage({usage:{used:'85',limit:'100',resetTime:five.reset_time},limits:[{window:{duration:300,timeUnit:'TIME_UNIT_MINUTE'},detail:{limit:'100',used:'8',resetTime:five.reset_time}}],usages:{limit_5h:{used_ratio:0},limit_7d:{used_ratio:0}}})
assert.equal(legacy.weekly.percent,85);assert.equal(legacy['5h'].percent,8)
assert.equal(parseKimiCodingUsage({usages:{limit5h:{usedRatio:null},limitMonthTotal:{usedRatio:true}}}),null)
const dir=mkdtempSync(join(tmpdir(),'cm-catalog-1028-')),path=join(dir,'ledger.json')
try{
 const ledger=new Ledger(sanitizeConfig({prices:{providers:before}}),{},path,['provider-catalog-2026-10-03','provider-catalog-2026-10-15','stepfun-catalog-2026-10-16'])
 ledger.scheduleWrite();ledger.flush();ledger.close()
 const first=Ledger.load(path);assert.ok(first.config.prices.providers.moonshot.models['kimi-k3.1-pro'])
 delete first.config.prices.providers.moonshot.models['kimi-k3.1-pro'];first.scheduleWrite();first.flush();first.close()
 const second=Ledger.load(path);assert.equal(second.config.prices.providers.moonshot.models['kimi-k3.1-pro'],undefined);second.close()
}finally{rmSync(dir,{recursive:true,force:true})}
console.log('[ok] October 28 catalog, source-specific prices, published CNY quotes, account quota shapes and one-time migration')
