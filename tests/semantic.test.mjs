import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJevInterpreter } from '../server/jev.mjs';
import { createInterpreter, createLocalEncoder, excludedObjects, namedObjects, cosine, MODEL, MODEL_REVISION } from '../server/semantic.mjs';
import { semanticMiddleware } from '../server/semantic-plugin.mjs';

test('semantic search abstains when no source concept has enough evidence',async()=>{
  const analyzer=createInterpreter(async texts=>texts.map(text=>text==='unknown'?[0,1]:[1,0]));
  assert.deepEqual((await analyzer.interpret('unknown')).matches,[]);
  await assert.rejects(analyzer.interpret(''));
  await assert.rejects(analyzer.interpret('a'.repeat(201)));
  assert.equal(cosine([0,0],[1,0]),0);
});

test('explicit exclusions apply to both semantic images and supporting companions',async()=>{
  assert.deepEqual([...excludedObjects('Про развитие без монет и кошелька, но с книгой')],['coin','wallet']);
  assert.ok(!excludedObjects('Без монет, но с цветами').has('flowers'));
  const analyzer=createInterpreter(async texts=>texts.map(()=>[1,0]));
  const result=await analyzer.interpret('Обучение без ручки и лампы');
  assert.ok(result.matches.every(m=>!['pen','lamp'].includes(m.key)));
  assert.equal(new Set(result.matches.map(m=>m.key)).size,result.matches.length);
});

test('literal object names do not confuse an idiom about hands with a pen',()=>{
  assert.deepEqual(namedObjects('Одной рукой узла не завязать'),[]);
  assert.deepEqual(namedObjects('Книга и ручка'),['book','pen']);
  assert.deepEqual(namedObjects('Кошелёк и монета'),['wallet','coin']);
});

test('cached interpretations reuse embeddings; failed initialization can be retried',async()=>{
  let calls=0;
  const analyzer=createInterpreter(async texts=>{calls++;if(calls===1)throw Error('load failed');return texts.map(()=>[1,0]);});
  await assert.rejects(analyzer.interpret('Учиться'));
  const result=await analyzer.interpret('Учиться');
  const count=calls;
  assert.deepEqual(await analyzer.interpret('Учиться'),result);
  assert.equal(calls,count);
});

test('only a missing model snapshot allows network requests during initialization', async t => {
  const { env } = await import('@huggingface/transformers');
  const cache = await mkdtemp(join(tmpdir(), 'smysl-model-test-'));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const requested = [];
  t.mock.method(env, 'fetch', async url => {
    requested.push(new URL(url).hostname);
    return new Response(null, { status: 404 });
  });

  await assert.rejects(createLocalEncoder(cache)(['Знания открывают двери']));
  assert.ok(requested.length > 0);
  assert.ok(requested.every(host => host === 'huggingface.co'));

  const snapshot = join(cache, MODEL, MODEL_REVISION);
  await mkdir(join(snapshot, 'onnx'), { recursive: true });
  for (const filename of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
    await writeFile(join(snapshot, filename), 'invalid model fixture');
  }
  requested.length = 0;
  await assert.rejects(createLocalEncoder(cache)(['Знания открывают двери']), SyntaxError);
  assert.deepEqual(requested, []);
});

test('HTTP interpretation validates requests and does not expose model failures',async()=>{
  const middleware=semanticMiddleware(async prompt=>{if(prompt==='failure')throw Error('private-path');return {prompt};});
  const server=http.createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/interpret`;
  try {
    assert.equal((await fetch(url)).status,405);
    assert.equal((await fetch(url,{method:'POST',body:'bad-json'})).status,400);
    assert.equal((await fetch(url,{method:'POST',body:JSON.stringify({prompt:'x'.repeat(201)})})).status,400);
    assert.equal((await fetch(url,{method:'POST',body:'x'.repeat(5000)})).status,413);
    assert.equal((await fetch(url,{method:'POST',headers:{origin:'https://other.example'},body:'{}'})).status,403);
    const response=await fetch(url,{method:'POST',body:JSON.stringify({prompt:'failure'})});
    assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private-path'));
    assert.deepEqual(await (await fetch(url,{method:'POST',body:JSON.stringify({prompt:'Учиться'})})).json(),{prompt:'Учиться'});
    for (let i=0;i<18;i++) assert.equal((await fetch(url,{method:'POST',body:JSON.stringify({prompt:'Учиться'})})).status,200);
    assert.equal((await fetch(url,{method:'POST',headers:{'X-Forwarded-For':'203.0.113.10'},body:JSON.stringify({prompt:'Учиться'})})).status,429);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('a trusted HTTPS proxy preserves the per-visitor API limit',async()=>{
  const middleware=semanticMiddleware(async prompt=>({prompt}),{trustedProxyIps:'127.0.0.1, 127.0.0.2'});
  const server=http.createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const host=`127.0.0.1:${server.address().port}`;
  const request=(forwarded,origin=`https://${host}`)=>fetch(`http://${host}/api/interpret`,{
    method:'POST',headers:{origin,'X-Forwarded-For':forwarded},body:JSON.stringify({prompt:'Учиться'}),
  });
  try {
    for (let i=0;i<20;i++) assert.equal((await request(`192.0.2.${i+1}, 203.0.113.10, 127.0.0.2`)).status,200);
    assert.equal((await request('192.0.2.99, 203.0.113.10, 127.0.0.2')).status,429);
    assert.equal((await request('203.0.113.11, 127.0.0.2')).status,200);
    assert.equal((await request('203.0.113.11','https://other.example')).status,403);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('both providers keep every explicitly named object in request order', async () => {
  const prompt = 'Нужна книга, монета и наушники, без лампы';
  const local = createInterpreter(() => assert.fail('Literal requests do not need embeddings'));
  const jev = createJevInterpreter({ request: () => assert.fail('Literal requests do not need the API') });
  for (const analyzer of [local, jev]) {
    const result = await analyzer.interpret(prompt);
    assert.equal(result.confidence, 'confident');
    assert.deepEqual(result.matches.map(match => match.key), ['book', 'coin', 'headphones']);
    assert.ok(result.matches.every(match => !match.supporting));
  }
});
