import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cachedQuery,resetQueryCache} from '../src/queryCache.js'
test('an old in-flight search cannot overwrite results after a manual source refresh',async()=>{
 resetQueryCache();let finishOld,finishNew
 const old=cachedQuery('refresh-fixture',()=>new Promise(resolve=>finishOld=resolve));await Promise.resolve()
 resetQueryCache()
 const fresh=cachedQuery('refresh-fixture',()=>new Promise(resolve=>finishNew=resolve));await Promise.resolve()
 finishOld('yesterday');assert.equal(await old,'yesterday')
 assert.equal(cachedQuery('refresh-fixture',()=>{throw new Error('must share new flight')}),fresh)
 finishNew('today');assert.equal(await fresh,'today')
 assert.equal(await cachedQuery('refresh-fixture',()=>{throw new Error('must retain today')}),'today')
 resetQueryCache()
})
