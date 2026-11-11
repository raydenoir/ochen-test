const test = require('node:test');
const { before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'design/library/manifest.json'), 'utf8'));
const assets = Object.fromEntries(manifest.assets.map(a => [
  '../design/library/' + a.path, fs.readFileSync(path.join(root, 'design/library', a.path), 'utf8')
]));
const backgroundSources=Object.fromEntries(manifest.backgrounds.map(a=>['../design/library/'+a.path,fs.readFileSync(path.join(root,'design/library',a.path),'utf8')]));
const loaders=Object.fromEntries(Object.entries(assets).map(([key,raw])=>[key,async()=>raw]));
const urls=Object.fromEntries(Object.keys(assets).map(key=>[key,key]));
const modules = new Map();
function load(file) {
  if(modules.has(file)) return modules.get(file);
  let source=fs.readFileSync(path.join(root,file),'utf8');
  source=source.replace(/import\.meta\.glob\([^;\n]+\)/g, match=>match.includes('backgrounds/')?'__backgroundSources':match.includes('?raw')?'__loaders':'__urls');
  source=source.replaceAll('import.meta.env.SSR','true');
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};modules.set(file,exports);
  const context={exports,__backgroundSources:backgroundSources,__loaders:loaders,__urls:urls,crypto:{randomUUID},setTimeout,Map,console,
    require: name=>{const target=path.posix.join(path.posix.dirname(file),name);return target.endsWith('.json')?JSON.parse(fs.readFileSync(path.join(root,target),'utf8')):load(target.endsWith('.mjs')?target:target+'.ts');}};
  vm.runInNewContext(output,context,{filename:file});
  return context.exports;
}
const model=load('src/model.ts'), svg=load('src/svg.ts');
const layout=load('src/layout.ts');
const assetStore=load('src/assets.ts');
const viewport=load('src/viewport.ts');
const backgrounds=load('src/backgrounds.ts');
before(async()=>{await Promise.all(manifest.assets.map(a=>assetStore.loadAsset(a.key,a.size,a.role)));});
const layer=(key,role='main')=>({id:randomUUID(),key,role,x:.5,y:.5,size:1,rotation:0});
const paths=text=>[...text.matchAll(/\bd="([^"]*)"/g)].map(m=>m[1]);
const paints=text=>[...text.matchAll(/(?:fill|stroke|stop-color)="(#[\da-f]{6}|white)"/gi)].map(m=>m[1].toUpperCase());

test('all 40 source variants keep geometry and native relative scale across formats',()=>{
  for(const detail of ['L','S']) for(const [width,height] of [[1200,800],[1000,1000],[1200,630],[800,1200],[900,1600]]) {
    const scene={...model.newScene(),width,height,detail};
    const scales=[];
    for(const a of manifest.assets.filter(a=>a.size===detail)) {
      const l=layer(a.key,a.role),original=svg.getAsset(l.key,detail,l.role);
      const rendered=svg.artwork(l,detail,model.PALETTES[0]);
      assert.deepEqual(paths(rendered),paths(original.raw));
      assert.equal(rendered.match(/viewBox="[^"]+"/)[0],original.raw.match(/viewBox="[^"]+"/)[0]);
      const g=svg.geometry(l,scene);
      assert.ok(Math.abs(g.width/g.height-original.width/original.height)<1e-9);
      scales.push(g.scale);
    }
    assert.ok(scales.every(s=>Math.abs(s-scales[0])<1e-9),`Every ${detail} object must have exactly the same scale`);
  }
});

test('every palette changes only paints and preserves monochrome role restrictions',()=>{
  for(const p of model.PALETTES) for(const a of manifest.assets) {
    const l=layer(a.key,a.role), original=svg.getAsset(l.key,a.size,l.role).raw;
    const rendered=svg.artwork(l,a.size,p);
    assert.deepEqual(paths(rendered),paths(original));
    const allowed=new Set([...p.background,...(a.role==='main'?p.objects:['#FFFFFF'])].map(c=>c.toUpperCase()));
    for(const color of paints(rendered)) assert.ok(allowed.has(color==='WHITE'?'#FFFFFF':color),`${a.key}/${a.role}: ${color}`);
  }
});

test('duplicate SVG objects get distinct IDs and self-contained vector export',()=>{
  const s=model.newScene();
  s.layers=[layer('phone'),layer('phone'),layer('book')];
  s.title='Название <со смыслом> & "кавычками"';
  const text=svg.exportSVG(s);
  const ids=[...text.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(!/<image\b|<script\b|foreignObject|(?:href|src)="https?:/i.test(text));
  assert.ok(text.includes('&lt;со смыслом&gt; &amp; &quot;кавычками&quot;'));
  for(const ref of text.matchAll(/url\(#([^)]*)\)/g)) assert.ok(ids.includes(ref[1]),`Missing local SVG definition ${ref[1]}`);
});

test('both background types in S/L keep source paths and use background paints only',()=>{
  for(const source of manifest.backgrounds.filter(a=>a.key!=='confetti-mint')) {
    const family=source.key.replace('confetti-','');
    for(const palette of [model.PALETTES.find(p=>p.key===family),{...model.PALETTES[0],key:'custom',background:['#112233','#445566','#778899','#101010']}]) {
      const scene={...model.newScene(),detail:source.size,palette:{...palette,key:family},backgroundPattern:family==='peach'?'corners':'circles'};
      const text=backgrounds.backgroundArtwork(scene);
      const raw=backgroundSources['../design/library/'+source.path];
      assert.deepEqual(paths(text),paths(raw));
      const allowed=new Set([...palette.background,'#FFFFFF']);
      for(const color of paints(text))assert.ok(allowed.has(color==='WHITE'?'#FFFFFF':color),`${source.path}: ${color}`);
      assert.ok(text.includes(raw.match(/viewBox="[^"]+"/)[0]));
      assert.match(svg.exportSVG(scene),/id="scene-decoration"/);
      assert.equal(backgrounds.backgroundArtwork({...scene,background:false}),'');
      assert.equal(backgrounds.backgroundArtwork({...scene,backgroundTexture:false}),'');
    }
  }
});

test('background decorations stay anchored and undistorted in every format independently of palette',()=>{
  for(const pattern of ['circles','corners']) for(const detail of ['S','L']) for(const [width,height] of [[1000,1000],[1200,800],[1200,630],[800,1200],[900,1600]]) {
    const native=detail==='S'?500:1000;
    const frames=backgrounds.decorationFrames(width,height,native,native,pattern);
    for(const f of frames) {
      assert.ok(f.x>=0&&f.y>=0&&f.x+f.width<=width+1e-6&&f.y+f.height<=height+1e-6);
      assert.ok(Math.abs(f.width/f.crop.width-f.height/f.crop.height)<1e-9,'No axis stretching');
    }
    assert.equal(frames[0].y,0);
    assert.ok(Math.abs(frames.at(-1).x+frames.at(-1).width-width)<1e-6);
    assert.ok(Math.abs(frames.at(-1).y+frames.at(-1).height-height)<1e-6);
    if(pattern==='circles')assert.equal(frames[1].y+frames[1].height,height,'Lower circle remains on the lower edge');
    const geometry=model.PALETTES.map(palette=>paths(backgrounds.backgroundArtwork({...model.newScene(),detail,width,height,palette,backgroundPattern:pattern})));
    for(const actual of geometry)assert.deepEqual(actual,geometry[0],'Palette must not choose the pattern');
  }
  const scene=model.newScene();scene.backgroundPattern='unknown';assert.equal(model.validateScene(scene),false);
});

test('import rejects independent scaling, invalid palettes and unknown source objects',()=>{
  const s=model.newScene();assert.ok(model.validateScene(s));
  s.layers[0].size=.8;assert.equal(model.validateScene(s),false);
  s.layers=s.layers.map(l=>({...l,size:.8}));assert.ok(model.validateScene(s));
  s.layers[0].key='generated-object';assert.equal(model.validateScene(s),false);
  assert.throws(()=>model.parsePalette('{"background":["red"],"objects":[]}'));
});

test('unknown metaphors do not silently create unrelated imagery',()=>{
  assert.equal(model.matchObjects('космический пингвин на марсе').length,0);
  assert.ok(model.matchObjects('командная работа').some(o=>o.key==='puzzle'));
  assert.ok(model.matchObjects('новая идея').some(o=>o.key==='lamp'));
});

test('component names preserve order and duplicates and report every unknown entry',()=>{
  const result=model.parseObjectNames(' Книга, ЛАМПА; кошелёк\nbook, книга, космический пингвин ');
  assert.equal(JSON.stringify(result.keys),JSON.stringify(['book','lamp','wallet','book','book']));
  assert.equal(JSON.stringify(result.unknown),JSON.stringify(['космический пингвин']));
  assert.equal(result.tooMany,false);
  assert.equal(model.parseObjectNames(' , ;\n').keys.length,0);
  assert.equal(model.parseObjectNames('идея, работа, деньги').keys.length,0,'Associations must not substitute explicit names');
  for(const object of model.OBJECTS) {
    assert.equal(model.parseObjectNames(object.name).keys[0],object.key);
    assert.equal(model.parseObjectNames(object.key).keys[0],object.key);
  }
  const seven=model.parseObjectNames(Array(7).fill('монета').join(', '));
  assert.equal(seven.tooMany,true);
  assert.equal(seven.keys.length,7,'Never silently truncate the requested list');
});

test('rearranging edited layers preserves identities, stacking, roles, rotations and common scale',()=>{
  const scene=model.newScene();
  scene.layers=[{...layer('phone','background'),rotation:37,size:.7}, {...layer('phone'),rotation:-23,size:.7}, {...layer('book'),size:.7}];
  const before=JSON.stringify(scene.layers);
  for(const layout of ['balanced','diagonal','editorial']) for(const variant of [0,1,2]) {
    const result=model.rearrange(scene.layers,layout,variant);
    result.forEach((l,i)=>{
      const {x,y,...properties}=l;
      const {x:oldX,y:oldY,...original}=scene.layers[i];
      assert.deepEqual(properties,original);
      assert.ok(Number.isFinite(x)&&Number.isFinite(y));
    });
    assert.ok(model.validateScene({...scene,layout,layers:result}));
    assert.ok(svg.exportSVG({...scene,layers:result}).includes('rotate(37)'));
  }
  assert.equal(JSON.stringify(scene.layers),before,'History snapshots must not be mutated');
  const first=model.rearrange(scene.layers,'balanced');
  const next=model.rearrange(first,'balanced',1);
  assert.notEqual(next[0].x,first[0].x);
  assert.equal(model.rearrange([],'balanced',1).length,0);
});

function assertInside(layers,format,margin=.04) {
  const pad=Math.min(format.width,format.height)*margin;
  for(const l of layers) {
    // Independent corner transform also checks the envelope calculation.
    const g=svg.geometry(l,format), angle=l.rotation*Math.PI/180;
    for(const dx of [-g.width/2,g.width/2]) for(const dy of [-g.height/2,g.height/2]) {
      const x=l.x*format.width+dx*Math.cos(angle)-dy*Math.sin(angle);
      const y=l.y*format.height+dx*Math.sin(angle)+dy*Math.cos(angle);
      assert.ok(x>=pad-1e-6&&x<=format.width-pad+1e-6,`${l.key}: corner x=${x}`);
      assert.ok(y>=pad-1e-6&&y<=format.height-pad+1e-6,`${l.key}: corner y=${y}`);
    }
  }
}

test('automatic layouts keep every source object inside safe margins in all supported formats',()=>{
  const sets=[...model.OBJECTS.map(o=>[o.key]),
    ['book','lamp','pen'], ['coin','book','flowers'], ['puzzle','lamp','phone'],
    ['book','book','lamp','headphones','folder','coin'],Array(6).fill('book')];
  for(const detail of ['L','S']) for(const [width,height] of [[1200,800],[1000,1000],[1200,630],[800,1200],[900,1600]]) {
    const format={width,height,detail};
    for(const scheme of ['balanced','diagonal','editorial']) for(const keys of sets) for(const variant of [0,1]) {
      const layers=model.arrange(keys,scheme,variant,format);
      assertInside(layers,format);
      assert.equal(layers.length,keys.length);
      assert.equal(JSON.stringify(layers.map(l=>l.key)),JSON.stringify(keys),'Stacking must follow the input list');
      if(scheme==='editorial') for(const l of layers) {
        const b=layout.layerBounds(l,format);
        if(width>=height) assert.ok(b.x-b.width/2>=width*.3-1e-6);
        else assert.ok(b.y-b.height/2>=height*.3-1e-6);
      }
    }
  }
});

test('rotated copies and monochrome objects keep their properties and remain on canvas',()=>{
  for(const detail of ['L','S']) for(const [width,height] of [[1200,800],[1000,1000],[1200,630],[800,1200],[900,1600]]) {
    const format={width,height,detail};
    const originals=model.OBJECTS.map((o,i)=>({...layer(o.key,i%2?'main':'background'),rotation:i*37-180,size:.8}));
    const snapshot=JSON.stringify(originals);
    for(const scheme of ['balanced','diagonal','editorial']) {
      const result=model.rearrange(originals,scheme,3,format);
      assertInside(result,format);
      result.forEach((l,i)=>assert.equal(JSON.stringify({...l,x:0,y:0}),JSON.stringify({...originals[i],x:0,y:0})));
    }
    assert.equal(JSON.stringify(originals),snapshot);
  }
});

test('impossible manual scale is reported rather than shrinking individual objects or clipping',()=>{
  const layers=[{...layer('book'),size:1.5,rotation:45}];
  const before=JSON.stringify(layers);
  assert.throws(()=>model.rearrange(layers,'balanced',0,{width:1000,height:1000,detail:'L'}),/Подогнать/);
  assert.equal(JSON.stringify(layers),before);
});

test('small accents are not hidden by the primary object in standard three-object scenes',()=>{
  for(const example of model.EXAMPLES) {
    const format={width:1200,height:800,detail:'L'};
    const layers=model.arrange([...example.keys],'balanced',0,format);
    const boxes=layers.map(l=>layout.layerBounds(l,format));
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
      const a=boxes[i],b=boxes[j];
      const x=Math.max(0,(a.width+b.width)/2-Math.abs(a.x-b.x));
      const y=Math.max(0,(a.height+b.height)/2-Math.abs(a.y-b.y));
      const small=Math.min(a.width*a.height,b.width*b.height)<Math.max(...boxes.map(b=>b.width*b.height))*.35;
      assert.ok(x*y/Math.min(a.width*a.height,b.width*b.height)<(small?.2:.45),'Small accents stay visible; large irregular envelopes may overlap');
    }
  }
});

test('format preserves relative placement and detail preserves positions, with no history for an unchanged setting',()=>{
  const original=model.newScene();
  original.layers=original.layers.map((l,i)=>({...l,x:.3+i*.2,y:.35+i*.13,role:i%2?'background':'main',rotation:i*19-30,size:1.15}));
  const snapshot=JSON.stringify(original);
  assert.equal(model.adaptScene(original,{detail:original.detail}),original);
  const small=model.adaptScene(original,{detail:'S'});
  assert.equal(small.layers,original.layers);
  for (const [width,height] of [[1200,800],[1000,1000],[1200,630],[800,1200],[900,1600]]) {
    const next=model.adaptScene(small,{width,height});
    assert.equal(next.width,width);assert.equal(next.height,height);assert.equal(next.detail,'S');
    assert.ok(model.validateScene(next));
    assert.equal(next.layers,original.layers);
  }
  assert.equal(JSON.stringify(original),snapshot);
});

test('the format round trip keeps S/L geometry and explicit scale, even when the middle format crops a layer',()=>{
  const original={...model.newScene(),detail:'L',layers:[
    {...layer('lamp','background'),detail:'L',x:.4,size:1.8},
    {...layer('wallet'),x:.9,y:.52,size:1.8},
    {...layer('coin'),x:.58,y:.7,size:1.8,rotation:12},
  ]};
  const small=model.adaptScene(original,{detail:'S'});
  const portrait=model.adaptScene(small,{width:800,height:1200});
  assert.equal(portrait.layers,original.layers);
  assert.ok(layout.compositionBounds(portrait.layers,portrait).right>portrait.width);
  assert.match(svg.exportSVG(portrait),/clip-path="url\(#canvas-clip\)"/);
  const fitted=model.fitScene(portrait);
  assertInside(fitted.layers,fitted);
  const restored=model.adaptScene(model.adaptScene(portrait,{width:1200,height:800}),{detail:'L'});
  assert.deepEqual({...restored},original);
  assert.equal(svg.exportSVG(restored),svg.exportSVG(original));
});

test('insertion after a single coin and duplication near an edge keep the whole group visible',()=>{
  const scene=model.newScene();
  scene.layers=model.arrange(['coin'],'balanced',0,scene);
  const book={...layer('book'),size:scene.layers[0].size};
  const next=model.placeNewLayer(scene,book);
  assertInside(next.layers,next);
  assert.ok(next.layers[0].size<scene.layers[0].size);
  const foreground=next.layers[1];
  const copy={...foreground,id:'copy',rotation:22,x:.99,y:.92};
  const duplicated=model.insertLayer(next,copy);
  assertInside(duplicated.layers,duplicated);
  assert.equal(duplicated.layers[2].rotation,22);
  assert.equal(new Set(duplicated.layers.map(l=>l.size)).size,1);
});

test('published example projects reproduce their SVG exports using original vector sources',()=>{
  const names=['education-album','team-square','savings-square'];
  for(const name of names) {
    const scene=JSON.parse(fs.readFileSync(path.join(root,'examples',name+'.json'),'utf8'));
    const text=fs.readFileSync(path.join(root,'examples',name+'.svg'),'utf8');
    assert.ok(model.validateScene(scene),name);
    assertInside(scene.layers.filter(l=>scene.layout!=='cropped'||l.role==='main'),scene);
    assert.equal(text,svg.exportSVG(scene)+'\n');
    assert.ok(!/<image\b|<script\b|foreignObject|(?:href|src)="https?:/i.test(text));
    const expected=[...paths(backgrounds.backgroundArtwork(scene)),...scene.layers.flatMap(l=>paths(svg.getAsset(l.key,l.detail??scene.detail,l.role).raw))];
    assert.deepEqual(paths(text),expected,'Example must contain the untouched source paths');
  }
});

test('fitting uses a common scale and makes isolated small objects usable on the canvas',()=>{
  for(const detail of ['S','L']) {
    const format={width:1200,height:800,detail};
    const coin=model.arrange(['coin'],'balanced',0,format);
    assert.ok(svg.geometry(coin[0],format).width>format.height*.5);
    for(const keys of [['book','lamp','pen'],['coin','wallet'],Array(6).fill('book')]) {
      const layers=model.arrange(keys,'balanced',0,format);
      assertInside(layers,format);
      assert.ok(layers.every(l=>l.size===layers[0].size));
      assert.ok(model.validateScene({...model.newScene(),...format,layers}));
    }
  }
});

test('global scaling transforms the entire group, preserves rotations and stays undoable',()=>{
  const scene=model.newScene(), before=JSON.stringify(scene);
  const next=model.scaleScene(scene,.6);
  assertInside(next.layers,next);
  assert.ok(model.validateScene(next));
  assert.equal(JSON.stringify(scene),before);
  const factor=.6/scene.layers[0].size;
  next.layers.forEach((l,i)=>{
    assert.equal(l.size,.6);assert.equal(l.id,scene.layers[i].id);assert.equal(l.role,scene.layers[i].role);assert.equal(l.rotation,scene.layers[i].rotation);
    if(i) {
      assert.ok(Math.abs((l.x-next.layers[0].x)-(scene.layers[i].x-scene.layers[0].x)*factor)<1e-9);
      assert.ok(Math.abs((l.y-next.layers[0].y)-(scene.layers[i].y-scene.layers[0].y)*factor)<1e-9);
    }
  });
  const expanded=model.scaleScene(scene,6);
  assert.ok(model.validateScene(expanded));
  assert.match(svg.exportSVG(expanded),/clip-path="url\(#canvas-clip\)"/);
  assert.equal(model.scaleScene(scene,scene.layers[0].size),scene);
  const remote={...scene,layers:scene.layers.map(l=>({...l,size:1,x:2.5}))};
  assert.throws(()=>model.scaleScene(remote,2),/Подогнать/);
  assert.throws(()=>model.scaleScene(scene,NaN));
  assert.throws(()=>model.scaleScene(scene,.1));
});

test('cropped example keeps original paths and makes the whole group visible with fit',()=>{
  const scene=model.exampleScene(2);
  const [lamp,wallet]=scene.layers;
  const b=layout.layerBounds(lamp,scene);
  assert.ok(b.y-b.height/2<0 && b.y+b.height/2>0);
  assertInside(scene.layers.filter(l=>l.role==='main'),scene);
  const svgText=svg.exportSVG(scene);
  assert.match(svgText,/clip-path="url\(#canvas-clip\)"/);
  assert.match(svg.artwork(wallet,scene.detail,scene.palette),/fill="#F9ECB0"/);
  assert.match(svg.artwork(lamp,scene.detail,scene.palette),/fill="#AA9BF0"/);
  assert.deepEqual(paths(svg.artwork(lamp,scene.detail,scene.palette)),paths(svg.getAsset('lamp','L','background').raw));
  const fitted=model.fitScene(scene);
  assert.equal(fitted.layout,'balanced');
  assertInside(fitted.layers,fitted);
  assert.deepEqual(fitted.layers.map(l=>l.id),scene.layers.map(l=>l.id));
});

test('on-demand SVG loading deduplicates requests and permits retry after failure',async()=>{
  const key='../design/library/assets/L/main/book.svg';
  let calls=0;
  const store=assetStore.createAssetStore({[key]:async()=>{calls++;if(calls===1)throw Error('offline');return assets[key];}});
  assert.throws(()=>store.getAsset('book','L','main'),/загружается/);
  const a=store.loadAsset('book','L','main'),b=store.loadAsset('book','L','main');
  assert.equal(a,b,'A duplicate layer should share the same download');
  await assert.rejects(a);assert.equal(calls,1);
  await store.loadAsset('book','L','main');
  assert.equal(store.getAsset('book','L','main').raw,assets[key]);
  await store.loadAsset('book','L','main');assert.equal(calls,2,'Loaded sources stay cached');
  const invalid=assetStore.createAssetStore({[key]:async()=>'<svg viewBox="0 0 10 10"/>'});
  await assert.rejects(invalid.loadAsset('book','L','main'),/Размеры/);
});

test('browser source loading checks HTTP errors before caching and retries the URL',async()=>{
  const key='../design/library/assets/L/main/book.svg';
  let calls=0;
  const transport=async url=>{assert.equal(url,'/assets/book.svg');calls++;return {ok:calls>1,text:async()=>assets[key]};};
  const store=assetStore.createAssetStore(assetStore.createURLLoaders({[key]:'/assets/book.svg'},transport));
  await assert.rejects(store.loadAsset('book','L','main'));
  await store.loadAsset('book','L','main');
  assert.equal(calls,2);assert.equal(store.getAsset('book','L','main').raw,assets[key]);
});

test('a foreground lamp base stays clear of the book in automatic compositions',()=>{
  for(const detail of ['L','S']) for(const [width,height] of [[1200,800],[1000,1000],[1200,630],[800,1200],[900,1600]]) {
    const format={width,height,detail};
    for(const scheme of ['balanced','diagonal','editorial']) for(const variant of [0,1,2,3]) {
      const layers=model.arrange(['book','lamp','pen'],scheme,variant,format);
      const book=layers.find(l=>l.key==='book'),lamp=layers.find(l=>l.key==='lamp');
      const b=svg.geometry(book,format),g=svg.geometry(lamp,format);
      const bookLeft=book.x*width-b.width/2,bookRight=book.x*width+b.width/2;
      const bookTop=book.y*height-b.height/2,bookBottom=book.y*height+b.height/2;
      const footLeft=lamp.x*width-g.width/2,footRight=lamp.x*width+g.width/2;
      const footTop=lamp.y*height+g.height/6,footBottom=lamp.y*height+g.height/2;
      const gap=Math.min(width,height)*.016;
      const clear=footLeft>=bookRight+gap-1e-6||footRight<=bookLeft-gap+1e-6||footTop>=bookBottom+gap-1e-6||footBottom<=bookTop-gap+1e-6;
      assert.ok(clear,`${detail} ${width}x${height} ${scheme}/${variant}: lamp base touches book`);
    }
  }
});

test('viewport fitting keeps every canvas format fully visible at one display scale',()=>{
  for(const [availableWidth,availableHeight] of [[1120,550],[680,410],[420,340],[300,260]]) {
    for(const [width,height] of [[1200,800],[1000,1000],[1200,630],[800,1200],[900,1600]]) {
      const size=viewport.fitArtboard(availableWidth,availableHeight,width,height);
      assert.ok(size.width<=availableWidth+1e-8&&size.height<=availableHeight+1e-8);
      assert.ok(Math.abs(size.width/size.height-width/height)<1e-9);
    }
  }
});


test('mixed S and L layers retain native ratios, their own artwork and a shared scale',()=>{
  const scene={...model.newScene(),detail:'S',layers:[{...layer('lamp','background'),detail:'L'},layer('wallet')]};
  const [lamp,wallet]=scene.layers;
  const big=svg.getAsset('lamp','L','background'), small=svg.getAsset('wallet','S','main');
  const g1=svg.geometry(lamp,scene), g2=svg.geometry(wallet,scene);
  assert.ok(Math.abs(g1.width/g2.width-big.width/small.width)<1e-9);
  assert.ok(Math.abs(g1.scale-g2.scale)<1e-9);
  assert.ok(model.validateScene(JSON.parse(JSON.stringify(scene))));
  assert.ok(!model.validateScene({...scene,layers:[{...lamp,detail:'XL'},wallet]}));
  assert.deepEqual(paths(svg.artwork(lamp,scene.detail,scene.palette)),paths(big.raw));
  assert.deepEqual(paths(svg.artwork(wallet,scene.detail,scene.palette)),paths(small.raw));
  assert.match(svg.exportSVG(scene),/viewBox="0 0 946 1129"/);
});

test('the team lamp is behind the main objects and has a visible gap from the phone',()=>{
  const scene=model.exampleScene(1);
  const [backdrop,...foreground]=scene.layers;
  assert.equal(backdrop.key,'lamp');
  assert.equal(backdrop.role,'background');
  assert.ok(foreground.every(l=>l.role==='main'&&l.y>backdrop.y));
  const lamp=layout.layerBounds(backdrop,scene);
  const phone=layout.layerBounds(foreground.find(l=>l.key==='phone'),scene);
  const gap=Math.max(Math.abs(lamp.x-phone.x)-(lamp.width+phone.width)/2,
    Math.abs(lamp.y-phone.y)-(lamp.height+phone.height)/2);
  assert.ok(gap>=Math.min(scene.width,scene.height)*.01);
});


test('default S/L only changes inherited sources, with the same common scale',()=>{
  const lamp={...layer('lamp','background'),detail:'L'};
  const wallet=layer('wallet'), coin={...layer('coin'),detail:'S'};
  const large={...model.newScene(),detail:'L',layers:[lamp,wallet,coin]};
  const small=model.adaptScene(large,{detail:'S'});
  assert.equal(small.layers,large.layers);
  for (const fixed of [lamp,coin]) assert.deepEqual(svg.geometry(fixed,small),svg.geometry(fixed,large));
  assert.ok(svg.geometry(wallet,small).width<svg.geometry(wallet,large).width);
  const fromSmall=svg.geometry({...lamp,detail:'S'},small);
  const fromLarge=svg.geometry({...lamp,detail:'S'},large);
  assert.deepEqual(fromSmall,fromLarge);
  assert.equal(svg.geometry(lamp,small).width/fromSmall.width,2);
  const back=model.adaptScene(small,{detail:'L'});
  assert.deepEqual(back.layers.map(l=>svg.geometry(l,back)),large.layers.map(l=>svg.geometry(l,large)));
});

test('old S compositions preserve their framing at the former maximum, exactly once',()=>{
  const old={...model.newScene(),detail:'S',layers:[
    {...layer('lamp','background'),detail:'L',size:6},
    {...layer('coin'),size:6},
  ]};
  delete old.scaleVersion;
  assert.ok(model.validateScene(old));
  const updated=model.migrateSceneScale(old);
  assert.ok(model.validateScene(updated));
  updated.layers.forEach((l,i)=>{
    assert.equal(l.size,12);
    assert.deepEqual({...l,size:6},old.layers[i]);
    const oldWidth=svg.getAsset(l.key,l.detail??old.detail,l.role).width*Math.min(old.width,old.height)/2300*6*2;
    assert.equal(svg.geometry(l,updated).width,oldWidth);
  });
  const reopened=JSON.parse(JSON.stringify(updated));
  assert.equal(model.migrateSceneScale(reopened),reopened);
  const rounded={...old,layers:[old.layers[0],{...old.layers[1],size:5.999991}]};
  assert.ok(model.validateScene(rounded));
  assert.ok(model.validateScene(model.migrateSceneScale(rounded)));
  const large={...old,detail:'L'};
  assert.equal(model.migrateSceneScale(large).layers,large.layers);
});
