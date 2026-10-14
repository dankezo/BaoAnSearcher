import test from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT } from 'jose'
import { requireUser } from '../api-lib/auth.js'

test('API allowlist trusts signed account email, never editable user metadata',async()=>{
  const settings={SUPABASE_URL:'https://auth-fixture.supabase.co',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_JWT_SECRET:'fixture-secret-for-auth-allowlist-test',AUTH_MODE:'local'}
  const previous=Object.fromEntries(Object.keys(settings).map(key=>[key,process.env[key]]))
  Object.assign(process.env,settings)
  const token=claims=>new SignJWT(claims).setProtectedHeader({alg:'HS256'}).setIssuer(settings.SUPABASE_URL+'/auth/v1').setAudience('authenticated').setSubject('qa-fixture').setExpirationTime('2m').sign(new TextEncoder().encode(settings.SUPABASE_JWT_SECRET))
  try{
    const forged=await token({user_metadata:{email:'admin@baoanpharma.com'}})
    await assert.rejects(()=>requireUser({headers:{authorization:'Bearer '+forged}}),error=>error.status===403)
    const valid=await token({email:'sales@baoanpharma.com',user_metadata:{email:'different@example.com'}})
    assert.equal((await requireUser({headers:{authorization:'Bearer '+valid}})).user.email,'sales@baoanpharma.com')
  }finally{
    for(const [key,value] of Object.entries(previous))value===undefined?delete process.env[key]:process.env[key]=value
  }
})
