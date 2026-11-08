import assert from 'node:assert/strict'
import {readFileSync,readdirSync} from 'node:fs'
import vm from 'node:vm'
import {DEFAULT_PROVIDER_PRICE_TABLE,providerPriceEntryFor,tierFor,buildPriceCatalog,upgradeProviderPriceCatalog20261105} from '../lib/pricing.js'
import {VERIFIED_PROVIDER_PRICES,PROVIDER_PRICES_BEFORE_2026_11_05} from '../lib/provider-prices.js'
import {defaultConfig} from '../lib/store.js'
// Mistral resells Z.ai / DeepSeek on api.mistral.ai at its own rates, so both IDs live in the
// `mistral` table rather than in `z-ai` or `deepseek`. USD per 1M tokens.
const MISTRAL='https://docs.mistral.ai/models/'
const rows=[
 ['zai-glm-5-3-flash',.15,.03,.5,MISTRAL+'zai-glm-5-3-flash'],
 ['deepseek-v4-1-flash-1017',.3,.007,1.2,MISTRAL+'deepseek-v4-flash-1017'],
]
const config=defaultConfig()
const before={...config.prices,providers:structuredClone(PROVIDER_PRICES_BEFORE_2026_11_05)}
const quote=(p,m,options,prices=config.prices)=>providerPriceEntryFor(p,m,prices,options)
const rates=row=>[row.entry.cacheMiss,row.entry.cacheHit,row.entry.output]
// DeepSeek's official windows, as the host builds them from a config.
const DEEPSEEK_PEAK={enabled:true,effectiveAtMs:Date.parse('2026-08-01T00:00:00Z'),windows:[{start:1,end:4},{start:6,end:10}],holidays:['2026-10-01']}
// 1. Catalog rows carry exactly the published Mistral rates.
for(const [id,input,read,output,sourceUrl] of rows){
 const raw=VERIFIED_PROVIDER_PRICES.mistral.models[id]
 assert.ok(raw,id)
 assert.deepEqual([raw.input,raw.cachedInput,raw.output],[input,read,output],id)
 assert.equal(raw.billingMode,'flat',id)
 assert.equal(raw.checkedAt,'2026-11-05')
 assert.equal(raw.sourceUrl,sourceUrl)
}
// 2. Regression for the vendor-prefix guard: `mistral` is a vendor prefix, so an unknown ID there
//    returns unpriced before the cross-vendor fallback; the data entries are what make these priced.
for(const [id,input,read,output] of rows){
 const row=quote('mistral',id,{mode:'exact'})
 assert.equal(row.priced,true,'mistral:'+id)
 assert.deepEqual(rates(row),[input,read,output],id)
 assert.equal(row.billingMode,'flat')
 assert.equal(quote('mistral',id,{mode:'exact'},before).priced,false,'unpriced before the 11-05 catalog: '+id)
}
// 3. Custom route keys are not vendor prefixes and fall through to the cross-vendor fallback, which
//    must pick Mistral's flat rate rather than another vendor's table.
for(const [id,input,read,output,sourceUrl] of rows){
 const vibe=quote('mistral-vibe',id,{mode:'auto'})
 assert.equal(vibe.priced,true,'mistral-vibe:'+id)
 assert.deepEqual(rates(vibe),[input,read,output],id)
 assert.equal(vibe.billingMode,'flat')
 assert.equal(vibe.entry.sourceUrl,sourceUrl,'resolved from the mistral table: '+id)
 // Anti-vacuity: on the pre-fix table the DeepSeek ID resolves to DeepSeek's own peak-aware rate,
 // so the new mistral row is what changes the resolution to Mistral's flat 0.30.
 const preFix=quote('mistral-vibe',id,{mode:'auto'},before)
 if(id==='deepseek-v4-1-flash-1017'){
  assert.equal(preFix.priced,true)
  assert.equal(preFix.billingMode,'deepseek-peak')
  assert.equal(preFix.entry.cacheMiss,.15)
  assert.notEqual(preFix.entry.cacheMiss,vibe.entry.cacheMiss)
 }else{
  assert.equal(preFix.priced,false)
  assert.equal(preFix.entry,null)
  assert.notDeepEqual(preFix.entry,vibe.entry)
 }
}
// 4. The restore list offers both rows under `mistral`.
const catalog=buildPriceCatalog()
for(const [id,input,read,output] of rows){
 const offered=Object.values(catalog.mistral??{}).find(models=>Object.hasOwn(models,id))
 assert.ok(offered,'restore list:'+id)
 assert.deepEqual([offered[id].input,offered[id].cachedInput,offered[id].output],[input,read,output])
}
// 5. Migration mounts the missing row while a customized sibling row keeps its manual rate.
const old=defaultConfig()
delete old.prices.providers.mistral.models['zai-glm-5-3-flash']
const custom={input:9,output:90,notes:'manual'}
old.prices.providers.mistral.models['zai-glm-5-3']=custom
upgradeProviderPriceCatalog20261105(old)
for(const [id,input,read,output] of rows){
 const mounted=old.prices.providers.mistral.models[id]
 assert.deepEqual([mounted.input,mounted.cachedInput,mounted.output],[input,read,output],'mounted: '+id)
}
assert.deepEqual(old.prices.providers.mistral.models['zai-glm-5-3'],custom)
const untouched=defaultConfig()
upgradeProviderPriceCatalog20261105(untouched)
assert.deepEqual(untouched.prices.providers.mistral.models,DEFAULT_PROVIDER_PRICE_TABLE.mistral.models)
assert.deepEqual(JSON.parse(readFileSync(new URL('../docs/provider-pricing.json',import.meta.url))).providers,DEFAULT_PROVIDER_PRICE_TABLE)
// 6. Fallback disambiguation: an Ollama Cloud date tag (`:1017`) must keep resolving to DeepSeek's
//    own peak-aware table even though the mistral row canon-collides with it.
const tagged='deepseek-v4.1-flash:1017'
const ollama=quote('ollama-cloud',tagged,{})
assert.equal(ollama.priced,true)
assert.equal(ollama.billingMode,'deepseek-peak','ollama-cloud keeps the DeepSeek peak calendar')
assert.deepEqual(rates(ollama),[.15,.003,.6],'DeepSeek off-peak rate, never mistral flat 0.3')
assert.equal(tierFor(ollama.entry,Date.parse('2026-10-20T07:00:00Z'),DEEPSEEK_PEAK).cacheMiss,.15)
assert.equal(tierFor(ollama.entry,Date.parse('2026-10-20T13:00:00Z'),DEEPSEEK_PEAK).cacheMiss,.3)
assert.notEqual(ollama.entry.cacheMiss,.3,'not mistral flat input')
// v1.9.16 semantics: without snapshot-tag matching the tag cannot resolve at all.
const frozen={...structuredClone(config.prices),snapshotTags:false}
assert.equal(quote('ollama-cloud',tagged,{},frozen).priced,false,'v1.9.16 matching stays unpriced')
assert.equal(quote('ollama-cloud',tagged,{},frozen).entry,null)
// A mistral-hosted route still gets Mistral's own rate for the same model family.
assert.equal(quote('mistral-vibe','deepseek-v4-1-flash-1017',{mode:'auto'}).entry.cacheMiss,.3)

// 7. A date suffix must not disable established aliases from unrelated vendors.
//    Exercise browser resolution as well as ledger resolution, using the actual source factory.
const dir=new URL('../src/client/',import.meta.url)
const source=readdirSync(dir).filter(n=>n.endsWith('.js')).sort().map(n=>readFileSync(new URL(n,dir),'utf8')).join('')
let factory
vm.runInNewContext(source.replace('exports.apply = apply','exports.catalogPricing = { resolveClientPrice, normalizeClientPrice }; exports.apply = apply'),{
 window:{__ModuleLoader__:{load:value=>{factory=value.factory}},localStorage:{getItem:()=>null}},navigator:{language:'en'},
})
const client=factory(()=>({})).catalogPricing
function checkBoth(provider,model,expected,mode='flat',prices=config.prices){
 const host=quote(provider,model,{mode:'auto'},prices)
 const front=client.resolveClientPrice(provider,model,{...config,prices})
 assert.equal(host.priced,expected!==null,'host: '+provider+':'+model)
 assert.equal(front.priced,host.priced,'browser priced: '+provider+':'+model)
 assert.equal(host.billingMode,mode,'host mode: '+provider+':'+model)
 assert.equal(front.billingMode,mode,'browser mode: '+provider+':'+model)
 if(expected){
  assert.deepEqual(rates(host),expected,'host rates: '+provider+':'+model)
  assert.deepEqual(rates({entry:client.normalizeClientPrice(front.entry)}),expected,'browser rates: '+provider+':'+model)
 }
}
for(const id of ['GPT-4-0613','gpt_4_0613','GPT-3.5-TURBO-0125','GROK-4.20-MULTI-AGENT-0309']){
 const previous=quote('custom',id,{mode:'auto'},before)
 assert.equal(previous.priced,true,'existing dated alias: '+id)
 checkBoth('custom',id,rates(previous))
}
// Mistral route aliases and explicit vendor namespaces retain Mistral's flat rates.
for(const provider of ['mistral-vibe','mistral-api']){
 for(const model of ['deepseek-v4-1-flash-1017','DeepSeek-V4-1-Flash-1017','deepseek-v4.1-flash-1017']){
  checkBoth(provider,model,[.3,.007,1.2])
 }
}
checkBoth('custom','mistral/deepseek-v4-1-flash-1017',[.3,.007,1.2])
checkBoth('custom','mistral:DeepSeek-V4-1-Flash-1017',[.3,.007,1.2])
checkBoth('ollama-cloud',tagged,[.15,.003,.6],'deepseek-peak')
checkBoth('ollama-cloud',tagged,null,'flat',frozen)
console.log('[ok] November 5 catalog: Mistral rates and aliases, existing dated aliases, host/browser parity, Ollama tag disambiguation, restore list and one-time migration')
