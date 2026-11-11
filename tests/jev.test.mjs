import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevInterpreter } from '../server/jev.mjs';
import { createInterpretProvider } from '../server/providers.mjs';

function responseFor(body,{choice='concept_0',confidence=.9,fits=.98}={}) {
  const probabilities=Object.fromEntries(Object.keys(body.questions.theme.criteria).map(key=>[key,key===choice?.9:key==='none'&&choice!=='none'?.1:0]));
  if(choice==='none')probabilities.none=1;
  return {answers:{theme:{type:'choice',choice,confidence,probabilities},fits:{type:'noul',noul:fits}}};
}
test('Jev requests a closed decision and maps it only to original source objects',async()=>{
  let calls=0;
  const analyzer=createJevInterpreter({apiKey:'test-key',request:async(url,options)=>{
    calls++;assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(options.headers.Authorization,'Bearer test-key');
    const body=JSON.parse(options.body);assert.equal(body.state.idea,'Учиться каждый день');
    assert.equal(body.questions.theme.type,'choice');assert.ok(body.questions.theme.criteria.none);
    return new Response(JSON.stringify(responseFor(body)));
  }});
  const result=await analyzer.interpret('Учиться каждый день');
  assert.equal(result.confidence,'confident');assert.equal(result.matches[0].key,'book');
  assert.ok(!JSON.stringify(result).includes('test-key'));
  result.matches[0].key='changed';
  assert.equal((await analyzer.interpret('Учиться каждый день')).matches[0].key,'book');assert.equal(calls,1);
});
test('Jev abstains on weak relevance and asks for review when uncertain',async()=>{
  for(const config of [{fits:.2},{confidence:.3},{choice:'none'}]) {
    const analyzer=createJevInterpreter({apiKey:'test',request:async(_url,options)=>new Response(JSON.stringify(responseFor(JSON.parse(options.body),config)))});
    const result=await analyzer.interpret('Замысел');assert.equal(result.confidence,'tentative');
    if(config.fits||config.choice)assert.equal(result.matches.length,0);
  }
});
test('Jev rejects unknown choices and contradictory probability distributions',async()=>{
  for(const corrupt of [data=>{data.answers.theme.choice='new-image';},data=>{data.answers.theme.confidence=NaN;},data=>{data.answers.theme.probabilities.none=.99;}]) {
    const analyzer=createJevInterpreter({apiKey:'test',request:async(_url,options)=>{const data=responseFor(JSON.parse(options.body));corrupt(data);return new Response(JSON.stringify(data));}});
    await assert.rejects(analyzer.interpret('Замысел'),/некорректный/);
  }
});
test('API mode does not call the local model and requires a server key',async()=>{
  const provider=createInterpretProvider({INTERPRET_PROVIDER:'jev'});
  await assert.rejects(provider.interpret('Идея'),/TYPESAFE_API_KEY/);
  assert.throws(()=>createInterpretProvider({INTERPRET_PROVIDER:'unknown'}));
});
test('Jev transport is time-bounded and failed calls are not cached',async()=>{
  let calls=0;
  const analyzer=createJevInterpreter({apiKey:'test',timeoutMs:30,request:async(_url,options)=>{
    calls++;
    if(calls===1)return new Response('',{status:503});
    return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}));
  }});
  await assert.rejects(analyzer.interpret('Замысел'));
  const keepAlive=setTimeout(()=>{},100);
  try {await assert.rejects(analyzer.interpret('Замысел'),/timeout/);} finally {clearTimeout(keepAlive);}
  assert.equal(calls,2);
});
