import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, Copy, Download, Grid2X2, Layers, Lightbulb, LoaderCircle, Minus, MousePointer2, Scan, Plus, Redo2, Search, SlidersHorizontal, Sparkles, Trash2, Undo2, Upload, X } from 'lucide-react';
import { adaptScene, arrangeChoices, exampleScene, EXAMPLES, EXAMPLE_FORMATS, SAVINGS_EXAMPLE, matchesSavingsExample, fitScene, insertLayer, placeNewLayer, matchObjects, migrateSceneScale, newScene, OBJECTS, PALETTES, parseObjectNames, parsePalette, scaleScene, uid, validateScene, type Detail, type Layer, type Layout, type Scene, type Role } from './model';
import { MAX_SCENE_SCALE, MIN_SCENE_SCALE } from './layout';
import { artwork, download, exportSVG, geometry } from './svg';
import { assetReady, getAssetURL, loadAsset } from './assets';
import { useSceneAssets } from './useSceneAssets';
import { backgroundArtwork, backgroundPattern } from './backgrounds';
import { PalettePicker } from './components/PalettePicker';
import { IdeaCard } from './components/IdeaCard';
import { Dialog } from './components/Dialog';
import { Artboard } from './components/Artboard';
import { Hint } from './components/Hint';
import { interpretIdea, type Interpretation } from './interpret';

const STORAGE='ochen-studio-v2';
const ideaGridStyle = {
  '--idea-columns': EXAMPLE_FORMATS.map(({width,height}) => `minmax(0, ${width / height}fr)`).join(' '),
} as CSSProperties;
function restoreScene(scene: Scene): Scene {
  return { ...migrateSceneScale(scene), backgroundTexture: scene.backgroundTexture ?? true, backgroundPattern: backgroundPattern(scene) };
}
function initial(): Scene {
  try { const v=JSON.parse(localStorage.getItem(STORAGE)||'null'); if(validateScene(v)) return restoreScene(v); } catch { /* Invalid or unavailable storage starts a fresh scene. */ }
  return newScene();
}
const Thumb = memo(function Thumb({ objectKey, detail, role, palette, color }: {
  objectKey: string;
  detail: Detail;
  role: Role;
  palette: Scene['palette'];
  color?: Layer['color'];
}) {
  const [, refresh] = useState(0);
  const original = PALETTES[0];
  const recolor = color !== undefined
    || palette.background.some((value, index) => value !== original.background[index])
    || (role === 'main' && palette.objects.some((value, index) => value !== original.objects[index]));
  const ready = assetReady(objectKey, detail, role);
  useEffect(() => {
    if (!recolor || ready) return;
    let active = true;
    void loadAsset(objectKey, detail, role).then(() => {
      if (active) refresh(value => value + 1);
    }, () => { /* Keep the source thumbnail if recoloring cannot load its SVG. */ });
    return () => { active = false; };
  }, [objectKey, detail, role, recolor, ready]);

  const src = recolor && ready
    ? 'data:image/svg+xml,' + encodeURIComponent(artwork({ key: objectKey, id: 'thumb', role, color }, detail, palette))
    : getAssetURL(objectKey, detail, role);
  return <img draggable={false} alt="" loading="lazy" decoding="async" src={src} />;
});
export default function App() {
  const [scene,setScene]=useState<Scene>(initial);
  const assets=useSceneAssets(scene);
  const [past,setPast]=useState<Scene[]>([]),[future,setFuture]=useState<Scene[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [mode,setMode]=useState<'idea'|'objects'>('idea');
  const [prompt,setPrompt]=useState(scene.prompt);
  const [query,setQuery]=useState('');
  const [libraryRole,setLibraryRole]=useState<Role>('main');
  const [objectNames,setObjectNames]=useState('Книга, лампа, ручка');
  const namedObjects=parseObjectNames(objectNames);
  const picked=namedObjects.keys;
  const isPicked=(key:string)=>namedObjects.entries.some(entry=>entry.key===key&&entry.role===libraryRole);
  const layout:Layout=scene.layout;
  const [toast,setToast]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [interpretation,setInterpretation]=useState<Interpretation|null>(null);
  const [waitingApproval,setWaitingApproval]=useState(false);
  const analysisRequest=useRef<AbortController|null>(null);
  const editVersion=useRef(0);
  const [saveStatus,setSaveStatus]=useState('Сохранено на устройстве');
  const [mobilePanel,setMobilePanel]=useState<'create'|'settings'>('create');
  const [showHelp,setShowHelp]=useState(false);
  const [customPalettes,setCustomPalettes]=useState<typeof PALETTES>([]);
  const svgRef=useRef<SVGSVGElement>(null);
  const sceneRef=useRef(scene);sceneRef.current=scene;
  const drag=useRef<{id:string;pointerId:number;startX:number;startY:number;x:number;y:number;before:Scene;moved:boolean}|null>(null);
  const paletteInput=useRef<HTMLInputElement>(null), projectInput=useRef<HTMLInputElement>(null);
  const compositionScale = scene.layers[0]?.size;
  const current=scene.layers.find(l=>l.id===selected);
  const colorChoice = current?.key === 'lamp' && current.role === 'background' ? ['Тёмная тень', 'Светлая тень']
    : current?.key === 'wallet' && current.role === 'main' ? ['Исходная', 'Первый цвет палитры'] : null;
  const currentName=OBJECTS.find(o=>o.key===current?.key)?.name;
  const notify=(text:string)=>setToast(text);
  function selectLayer(id:string) {
    setSelected(id);
  }
  function openMobilePanel(panel: typeof mobilePanel) {
    setMobilePanel(panel);
    if (window.matchMedia('(max-width: 760px)').matches) {
      requestAnimationFrame(() => document.getElementById(`${panel}-panel`)?.scrollIntoView({ block: 'start' }));
    }
  }
  function revealCanvas() {
    const editor = document.getElementById('illustration-editor');
    if (!editor) return;
    const { top, bottom } = editor.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) editor.scrollIntoView({ block: 'start' });
  }
  function commit(next:Scene,before=sceneRef.current) {
    if (next === before) return;
    editVersion.current++;
    setPast(p=>[...p.slice(-49),before]);setFuture([]);setScene(next);
  }
  function update(patch:Partial<Scene>) {
    const source = sceneRef.current;
    if (Object.entries(patch).some(([key, value]) => source[key as keyof Scene] !== value)) commit({...source,...patch});
  }
  function adapt(patch:Parameters<typeof adaptScene>[1]) {
    try {
      const source = sceneRef.current;
      const next = adaptScene(source,patch);
      if (next === source) return;
      commit(next);
      if (next.layers[0]?.size !== source.layers[0]?.size) notify('Общий масштаб подогнан. Можно отменить.');
    } catch(e) { notify(e instanceof Error?e.message:'Не удалось изменить расположение. Сцена сохранена.'); }
  }
  function adjustScale(factor: number) {
    const source = sceneRef.current;
    if (!source.layers.length) return;
    const size = Math.max(MIN_SCENE_SCALE, Math.min(MAX_SCENE_SCALE, source.layers[0].size * factor));
    try { commit(scaleScene(source, size)); }
    catch (e) { notify(e instanceof Error ? e.message : 'Не удалось изменить масштаб.'); }
  }
  function changeLayer(patch:Partial<Layer>) {
    if(!current || !Object.entries(patch).some(([key, value]) => current[key as keyof Layer] !== value))return;update({layers:sceneRef.current.layers.map(l=>l.id===selected?{...l,...patch}:l)});
  }
  function undo() {
    if(!past.length)return;
    editVersion.current++;setInterpretation(null);setWaitingApproval(false);
    const previous=past[past.length-1];setFuture(f=>[sceneRef.current,...f]);setPast(p=>p.slice(0,-1));setScene(previous);setSelected(null);
  }
  function redo() {
    if(!future.length)return;
    editVersion.current++;setInterpretation(null);setWaitingApproval(false);
    setPast(p=>[...p,sceneRef.current]);setScene(future[0]);setFuture(f=>f.slice(1));setSelected(null);
  }
  function remove() { if(current){ update({layers:sceneRef.current.layers.filter(l=>l.id!==selected)});setSelected(null);notify('Объект удалён. Можно отменить.');} }
  function duplicate() {
    if(!current)return;
    if(scene.layers.length>=60){notify('На холсте уже 60 объектов. Удалите лишние.');return;}
    const copy={...current,id:uid(),x:current.x+.035,y:current.y+.035};
    try {
      const next = insertLayer(scene, copy, scene.layers.indexOf(current) + 1);
      commit(next);setSelected(copy.id);notify(next.layers[0].size < current.size ? 'Копия добавлена, общий масштаб подогнан. Можно отменить.' : 'Копия добавлена');
    } catch(e) { notify(e instanceof Error ? e.message : 'Не удалось добавить копию.'); }
  }
  function reorder(direction:number) {
    const layers=[...scene.layers],index=layers.findIndex(l=>l.id===selected),next=index+direction;
    if(index<0||next<0||next>=layers.length)return;
    [layers[index],layers[next]]=[layers[next],layers[index]];update({layers});
  }
  function add(key:string) {
    if(scene.layers.length>=60){notify('На холсте уже 60 объектов. Удалите лишние.');return;}
    const layer:Layer={id:uid(),key,role:libraryRole,x:.5,y:.5,size:scene.layers[0]?.size??1,rotation:0};
    try {
      const next = placeNewLayer(scene, layer);
      commit(next);setSelected(layer.id);notify(next.layers[0].size < layer.size ? 'Объект добавлен, общий масштаб подогнан. Можно отменить.' : 'Объект на холсте');
    } catch(e) { notify(e instanceof Error ? e.message : 'Не удалось добавить объект.'); }
  }
  function cancelAnalysis() {
    analysisRequest.current?.abort();analysisRequest.current=null;
    setBusy(false);setInterpretation(null);setWaitingApproval(false);setError('');
  }
  function toggleObject(key:typeof OBJECTS[number]['key']) {
    const name=OBJECTS.find(o=>o.key===key)!.name+(libraryRole==='background'?' (фон)':'');
    if(!isPicked(key)&&namedObjects.entries.length>=6){setError('В списке уже 6 названий. Удалите одно, чтобы добавить другое.');return;}
    setObjectNames(isPicked(key)?namedObjects.entries.filter(e=>e.key!==key||e.role!==libraryRole).map(e=>e.input).join(', '):[...namedObjects.entries.map(e=>e.input),name].join(', '));
    setError('');
  }
  function openExample(index: number) {
    cancelAnalysis();
    const next = exampleScene(index);
    commit(next);
    setPrompt(next.prompt);
    setObjectNames(next.layers.map(l => OBJECTS.find(o => o.key === l.key)!.name + (l.role === 'background' ? ' (фон)' : '')).join(', '));
    setMode('idea');
    setSelected(null);
    notify('Открыли готовую композицию. Можно изменить её или отменить сборку.');
    revealCanvas();
  }
  function compose(keys:string[],title?:string,analysis?:Interpretation) {
    const source=sceneRef.current;
    const choices=keys.map((key,index)=>({key,role:analysis?.matches.find(m=>m.key===key)?.role??(mode==='objects'?namedObjects.entries[index]?.role:'main')??'main'}));
    choices.sort((a,b)=>Number(b.role==='background')-Number(a.role==='background'));
    const layers=arrangeChoices(choices,source.layout,0,source);
    const name=title??(mode==='objects'?keys.map(key=>OBJECTS.find(o=>o.key===key)!.name).join(', '):prompt.trim()||'Новая композиция');
    commit({...source,title:name,prompt:title??(mode==='objects'?objectNames:prompt),layers});
    setSelected(null);setWaitingApproval(false);notify('Композиция готова. Можно подвигать объекты и добавить свои штрихи.');
    revealCanvas();
  }
  function useLexical() {
    const matches=matchObjects(prompt).slice(0,6);
    if(!matches.length){setError('По знакомым словам тоже ничего не нашлось. Укажите названия объектов или попробуйте другой замысел.');return;}
    const result:Interpretation={source:'lexical',confidence:'tentative',matches:matches.map(m=>({...m,role:'main',reason:'Совпадение со знакомыми словами и ассоциациями.',supporting:false}))};
    setInterpretation(result);setWaitingApproval(true);setError('');
  }
  async function generate(keysOverride?:string[],titleOverride?:string) {
    if(busy)return;
    setError('');setWaitingApproval(false);
    if(keysOverride||mode==='objects') {
      if(!keysOverride&&namedObjects.unknown.length){setError(`Не найдены: ${namedObjects.unknown.join(', ')}. Исправьте названия или замените их объектами из библиотеки. Холст пока не изменён.`);return;}
      if(!keysOverride&&namedObjects.tooMany){setError('Для новой композиции укажите до 6 объектов. Остальные можно добавить на холст по одному.');return;}
      const keys=keysOverride??picked;
      if(!keys.length){setError('Введите хотя бы одно название или выберите объект в библиотеке.');return;}
      try {compose(keys,titleOverride);setInterpretation(null);} catch(e){setError(e instanceof Error?e.message:'Не удалось собрать композицию.');}
      return;
    }
    if(!prompt.trim()){setError('Расскажите, о чём должна быть иллюстрация.');return;}
    if (matchesSavingsExample(prompt)) {
      openExample(SAVINGS_EXAMPLE);
      return;
    }
    const request=new AbortController();analysisRequest.current=request;
    const version=editVersion.current;
    const timeout=setTimeout(()=>request.abort(),120000);
    setBusy(true);setInterpretation(null);
    try {
      const result=await interpretIdea(prompt,request.signal);
      if(analysisRequest.current!==request)return;
      setInterpretation(result);
      if(!result.matches.length){setError('В этой библиотеке не нашлось уверенного образа для замысла. Попробуйте уточнить мысль или укажите названия объектов. Холст сохранён.');return;}
      if(result.confidence==='tentative'||version!==editVersion.current){
        setWaitingApproval(true);
        if(version!==editVersion.current)setError('Пока шёл подбор, вы изменили холст. Посмотрите предложенные образы и решите, собирать ли новую сцену.');
      } else compose(result.matches.map(m=>m.key),undefined,result);
    } catch(e) {
      if(analysisRequest.current===request)setError(request.signal.aborted?'Подбор занял слишком много времени. Холст сохранён; можно повторить попытку.':e instanceof Error?e.message:'Не удалось подобрать образы. Холст сохранён.');
    } finally {
      clearTimeout(timeout);
      if(analysisRequest.current===request){analysisRequest.current=null;setBusy(false);}
    }
  }
  useEffect(()=>()=>{analysisRequest.current?.abort();},[]);
  useEffect(()=>{
    setSaveStatus('Сохраняю…');
    const t=setTimeout(()=>{
      try {localStorage.setItem(STORAGE,JSON.stringify(scene));setSaveStatus('Сохранено на устройстве');}
      catch {setSaveStatus('Автосохранение недоступно');}
    },400);return()=>clearTimeout(t);
  },[scene]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4000);return()=>clearTimeout(t);},[toast]);
  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      if (showHelp || e.defaultPrevented || e.isComposing) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable], .palette-options, .palette-picker[aria-expanded=true]')) return;
      if(e.key==='Escape'){setSelected(null);setShowHelp(false);}
      const command = (e.ctrlKey || e.metaKey) && !e.altKey;
      const key = e.key.toLowerCase();
      if (command && (e.code === 'KeyZ' || key === 'z')) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (command && !e.shiftKey && (e.code === 'KeyD' || key === 'd')) {
        e.preventDefault();
        duplicate();
        return;
      }
      if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}
      if(current&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
        e.preventDefault();const step=e.shiftKey?10:1;
        changeLayer({x:current.x+(['ArrowLeft','ArrowRight'].includes(e.key)?(e.key==='ArrowLeft'?-step:step)/scene.width:0),y:current.y+(['ArrowUp','ArrowDown'].includes(e.key)?(e.key==='ArrowUp'?-step:step)/scene.height:0)});
      }
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  });
  function point(e:ReactPointerEvent) {
    const svg=svgRef.current!,p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;
    return p.matrixTransform(svg.getScreenCTM()!.inverse());
  }
  function startDrag(e:ReactPointerEvent<SVGGElement>,l:Layer) {
    if(e.button!==0||drag.current)return;e.stopPropagation();selectLayer(l.id);
    editVersion.current++;
    const p=point(e);drag.current={id:l.id,pointerId:e.pointerId,startX:p.x,startY:p.y,x:l.x,y:l.y,before:scene,moved:false};e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveDrag(e:ReactPointerEvent) {
    const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;const p=point(e);
    if(Math.abs(p.x-d.startX)+Math.abs(p.y-d.startY)<2&&!d.moved)return;
    d.moved=true;setScene(s=>({...s,layers:s.layers.map(l=>l.id===d.id?{...l,x:Math.max(0,Math.min(1,d.x+(p.x-d.startX)/s.width)),y:Math.max(0,Math.min(1,d.y+(p.y-d.startY)/s.height))}:l)}));
  }
  function endDrag(e:ReactPointerEvent,cancel=false) {
    const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;
    if(cancel)setScene(d.before);else if(d.moved){editVersion.current++;setPast(p=>[...p.slice(-49),d.before]);setFuture([]);}
    drag.current=null;
  }
  async function importPalette(file?:File) {
    if(!file)return;try{if(file.size>100000)throw Error('Файл палитры слишком большой.');const p=parsePalette(await file.text());setCustomPalettes(old=>[...old,p]);update({palette:p});notify('Палитра загружена и применена');}catch(e){notify(e instanceof SyntaxError?'Файл палитры должен быть в формате JSON.':e instanceof Error?e.message:'Не удалось прочитать палитру');}
  }
  async function importProject(file?:File) {
    if(!file)return;try{if(file.size>300000)throw Error('Файл проекта слишком большой.');const data=JSON.parse(await file.text());if(!validateScene(data))throw Error('Этот файл не похож на проект «Смысл».');cancelAnalysis();commit(restoreScene(data));setPrompt(data.prompt);setSelected(null);notify('Проект открыт');}catch(e){notify(e instanceof SyntaxError?'Файл проекта должен быть в формате JSON.':e instanceof Error?e.message:'Не удалось открыть проект');}
  }
  const filtered=OBJECTS.filter(o=>(o.name+' '+o.tags).toLowerCase().replaceAll('ё','е').includes(query.toLowerCase().replaceAll('ё','е')));
  const formats=[{name:'Альбом',w:1200,h:800,label:'3:2'},{name:'Квадрат',w:1000,h:1000,label:'1:1'},{name:'Обложка',w:1200,h:630,label:'1.91:1'},{name:'Портрет',w:800,h:1200,label:'2:3'},{name:'История',w:900,h:1600,label:'9:16'}];
  const canvasBackground = !scene.background ? 'transparent' : scene.backgroundTexture ? backgroundPattern(scene) : 'plain';
  const backgroundSettings = useMemo(() => ({
    background: scene.background, backgroundTexture: scene.backgroundTexture,
    backgroundPattern: scene.backgroundPattern, palette: scene.palette, detail: scene.detail,
  }), [scene.background, scene.backgroundTexture, scene.backgroundPattern, scene.palette, scene.detail]);
  const decoration = useMemo(() => backgroundArtwork({...backgroundSettings,width:scene.width,height:scene.height}),
    [backgroundSettings,scene.width,scene.height]);
  const backgroundPreview = useMemo(() => backgroundArtwork({...backgroundSettings,width:100,height:100}, 'preview-decoration'),
    [backgroundSettings]);
  const hasArtwork = scene.layers.some(layer => assetReady(layer.key, layer.detail ?? scene.detail, layer.role));
  return <div className="app-shell">
    <header className="topbar">
      <a href="#" className="brand" onClick={e=>{e.preventDefault();setShowHelp(true);}} aria-label="Смысл — о мастерской"><span className="brand-icon"><Sparkles size={23} strokeWidth={1.7}/></span>смысл<span className="brand-dot">.</span></a>
      <div className="header-divider"/><span className="product-name">Мастерская иллюстраций</span>
      <div className="header-actions"><span className="save-state"><span className={saveStatus.startsWith('Сохранено')?'status-dot':'status-dot pending'}/>{saveStatus}</span><button className="quiet-button help-button" onClick={()=>setShowHelp(true)}>Как это работает <ArrowUpRight size={14}/></button><span className="avatar">С</span></div>
    </header>
    <div className="intro-row"><div><div className="eyebrow">ИЗ ИДЕИ — В ИЛЛЮСТРАЦИЮ</div><h1>Хорошие мысли заслуживают <em>картинки.</em></h1></div><div className="intro-note"><span className="tiny-star">✳</span><span>Соберите свой замысел<br/>из готовых векторных объектов.</span></div></div>
    <nav className="mobile-tabs" aria-label="Панели редактора"><button className={mobilePanel==='create'?'active':''} aria-pressed={mobilePanel==='create'} aria-controls="create-panel" onClick={()=>openMobilePanel('create')}>Идея и объекты</button><button className={mobilePanel==='settings'?'active':''} aria-pressed={mobilePanel==='settings'} aria-controls="settings-panel" onClick={()=>openMobilePanel('settings')}>Настройки и экспорт</button></nav>
    <main className="workspace">
      <aside id="create-panel" className={`create-panel ${mobilePanel==='create'?'mobile-visible':''}`}>
        <div className="create-scroll"><div className="panel-heading"><h2>С чего начнём?</h2><Lightbulb size={17}/></div>
        <div className="segmented" aria-label="Способ создания"><button className={mode==='idea'?'active':''} aria-pressed={mode==='idea'} onClick={()=>{cancelAnalysis();setMode('idea');}}>По замыслу</button><button className={mode==='objects'?'active':''} aria-pressed={mode==='objects'} onClick={()=>{cancelAnalysis();setMode('objects');}}>Из объектов</button></div>
        {mode==='idea'?<><label className="field-label" htmlFor="idea">О чём ваша иллюстрация?</label><textarea id="idea" aria-describedby={error?'compose-error':undefined} maxLength={200} value={prompt} onChange={e=>{cancelAnalysis();setPrompt(e.target.value);}} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')generate();}} placeholder="Например, большие идеи рождаются в команде"/><div className="input-note"><span>Ctrl / ⌘ + Enter</span><span>{prompt.length}/200</span></div></>:<div className="names-input"><label className="field-label" htmlFor="object-names">Какие объекты собрать?</label><textarea id="object-names" maxLength={500} value={objectNames} aria-describedby={`names-note names-result${error?' compose-error':''}`} aria-invalid={!!error} onChange={e=>{setObjectNames(e.target.value);setError('');}} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')generate();}} placeholder="Книга, лампа (фон), ручка"/><p id="names-note" className="names-note">До 6 названий через запятую. Для фонового объекта добавьте «(фон)».</p><div id="names-result" className="names-result" aria-live="polite">{namedObjects.entries.length>0&&<><span>Найдено: {picked.length} из {namedObjects.entries.length}</span>{namedObjects.unknown.length>0&&<p>Не найдены: {namedObjects.unknown.join(', ')}. Исправьте название или удалите его из списка.</p>}{namedObjects.tooMany&&<p>В списке больше 6 объектов. Сократите его перед сборкой.</p>}</>}</div></div>}
        <button className="generate-button" disabled={busy} onClick={()=>generate()}>{busy?<LoaderCircle className="spin" size={17}/>:<Sparkles size={17}/>} {busy?'Подбираем образы…':'Собрать композицию'}</button>
        {error&&<div className="inline-error" id="compose-error" role="alert">{error}</div>}
        {busy&&<div className="analysis-progress" role="status"><p>Ищем связь между вашим замыслом и образами библиотеки. </p><button onClick={cancelAnalysis}>Отменить подбор</button></div>}
        {mode==='idea'&&interpretation&&interpretation.matches.length>0&&<section className="interpretation" aria-label="Почему выбраны эти объекты"><details open={waitingApproval||undefined}><summary>{waitingApproval?'Проверить трактовку':'Почему эти образы'}</summary><p>{interpretation.source==='lexical'?'Подбор по знакомым словам. Проверьте, подходит ли он к вашей мысли.':waitingApproval?'Связь неочевидна. Проверьте образы перед сборкой.':'Основные образы и детали, которые поддерживают сюжет.'}</p><ul>{interpretation.matches.map(m=><li key={m.key}><strong>{m.name}{m.role==='background'?' · фоновый образ':''}</strong><span>{m.reason}</span></li>)}</ul>{waitingApproval&&<button className="accept-interpretation" onClick={()=>{try{compose(interpretation.matches.map(m=>m.key),undefined,interpretation);setError('');}catch(e){setError(e instanceof Error?e.message:'Не удалось собрать композицию.');}}}>Собрать с этими образами</button>}</details></section>}
        {mode==='idea'&&error&&!busy&&<button className="lexical-button" onClick={useLexical}>Подобрать по знакомым словам</button>}
        </div><div className="library-panel"><div className="library-heading"><h3>Библиотека объектов</h3><Grid2X2 size={15}/></div>
        <label className="search-box"><Search size={15}/><input aria-label="Найти объект" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти что-то своё"/>{query&&<button aria-label="Очистить поиск" onClick={()=>setQuery('')}><X size={13}/></button>}</label>
        <div className="library-roles" aria-label="Виды объектов">{([['main','Главные'],['background','Фоновые']] as const).map(([role,label])=><button key={role} aria-pressed={libraryRole===role} onClick={()=>setLibraryRole(role)}>{label}</button>)}</div>
        <div className="object-grid">{filtered.map(o=><button key={o.key} className={`object-card ${mode==='objects'&&isPicked(o.key)?'picked':''}`} onClick={()=>mode==='objects'?toggleObject(o.key):add(o.key)} title={mode==='objects'?'Изменить список названий':'Добавить на холст'} aria-label={`${mode==='objects'?'Выбрать':'Добавить'} ${o.name}${libraryRole==='background'?' — фоновый':''}`} aria-pressed={mode==='objects'?isPicked(o.key):undefined}><div className="object-image"><Thumb objectKey={o.key} detail={scene.detail} role={libraryRole} palette={scene.palette}/></div><span>{o.name}</span><span className="object-add">{mode==='objects'&&isPicked(o.key)?<Check size={12}/>:<Plus size={12}/>}</span></button>)}</div>
        {!filtered.length&&<p className="empty-search">Такого объекта пока нет.<button onClick={()=>setQuery('')}>Показать все объекты</button></p>}
        </div>
      </aside>
      <section id="illustration-editor" className="canvas-panel" aria-label="Редактор иллюстрации">
        <div className="canvas-toolbar"><div className="project-label"><span className="project-dot"/><span>{scene.title}</span></div><div className="history-buttons"><button aria-label="Отменить действие" title="Отменить · Ctrl+Z" disabled={!past.length} onClick={undo}><Undo2 size={17}/></button><button aria-label="Повторить действие" title="Повторить · Ctrl+Shift+Z" disabled={!future.length} onClick={redo}><Redo2 size={17}/></button><span/><button aria-label="Снять выделение" title="Снять выделение · Esc" onClick={()=>setSelected(null)}><Scan size={16}/></button></div></div>
        <div className={`canvas-area ${scene.height>scene.width?'portrait':''}`}>
          <div className="artboard-label"><span>ВАША КОМПОЗИЦИЯ</span><span>{scene.width} × {scene.height} px</span></div>
          <Artboard width={scene.width} height={scene.height} busy={busy}>
            <svg ref={svgRef} viewBox={`0 0 ${scene.width} ${scene.height}`} role="group" aria-label={scene.title} aria-busy={!assets.ready} onPointerDown={()=>setSelected(null)} onPointerMove={moveDrag} onPointerUp={e=>endDrag(e)} onPointerCancel={e=>endDrag(e,true)} onLostPointerCapture={e=>endDrag(e,true)}>
              {scene.background&&<rect width={scene.width} height={scene.height} fill={scene.palette.background[0]}/>}
              {scene.background&&scene.backgroundTexture&&<g dangerouslySetInnerHTML={{__html:decoration}}/>}
              {scene.layers.map(l=>{if(!assetReady(l.key,l.detail??scene.detail,l.role))return null;const g=geometry(l,scene),isSelected=l.id===selected;return <g key={l.id} className="canvas-object" transform={`translate(${l.x*scene.width} ${l.y*scene.height}) rotate(${l.rotation})`} onPointerDown={e=>startDrag(e,l)} tabIndex={0} role="button" aria-label={`Выбрать ${OBJECTS.find(o=>o.key===l.key)?.name}`} aria-pressed={isSelected} onFocus={()=>selectLayer(l.id)} onClick={()=>selectLayer(l.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectLayer(l.id);}}}>
                <rect x={-g.width/2} y={-g.height/2} width={g.width} height={g.height} fill="transparent"/>
                <g aria-hidden="true" pointerEvents="none" transform={`translate(${-g.width/2} ${-g.height/2}) scale(${g.scale})`} dangerouslySetInnerHTML={{__html:artwork(l,scene.detail,scene.palette)}}/>
                {isSelected&&<g className="selection" pointerEvents="none"><rect x={-g.width/2-6} y={-g.height/2-6} width={g.width+12} height={g.height+12}/></g>}
              </g>;})}
            </svg>
            {!assets.ready&&<div className={`asset-state ${hasArtwork ? 'asset-state-partial' : ''}`} role={assets.error?'alert':'status'}>{assets.error?<><p>{assets.error}</p><button onClick={assets.retry}>Повторить загрузку</button></>:<><LoaderCircle className="spin" size={24}/><p>Загружаем векторные объекты…</p></>}</div>}
            {!scene.layers.length&&<div className="empty-canvas"><Sparkles size={32}/><h3>Здесь появится ваша идея</h3><p>Опишите замысел или добавьте объект из библиотеки.</p></div>}
          </Artboard>
          <div className="canvas-caption"><span><MousePointer2 size={13}/>{selected?'Перетаскивайте объект или откройте настройки':'Нажмите на объект, чтобы настроить его'}</span></div>
        </div>
        <div className="canvas-bottom">
          <label className="layout-picker" htmlFor="layout">Раскладка<select id="layout" value={layout} onChange={e=>adapt({layout:e.target.value as Layout})}>
            <option value="balanced">Собранно</option><option value="diagonal">По диагонали</option><option value="editorial">Под заголовок</option><option value="cropped">Фон за краем</option>
          </select></label>
          <div className="composition-fit">
            <div className="composition-scale-control" role="group" aria-label="Масштаб композиции">
              <button type="button" aria-label="Уменьшить композицию" title="Уменьшить композицию" disabled={compositionScale === undefined || compositionScale <= MIN_SCENE_SCALE} onClick={() => adjustScale(1 / 1.1)}><Minus size={14}/></button>
              <output aria-label="Масштаб композиции">{compositionScale === undefined ? '—' : `${Math.round(compositionScale * 100)}%`}</output>
              <button type="button" aria-label="Увеличить композицию" title="Увеличить композицию" disabled={compositionScale === undefined || compositionScale >= MAX_SCENE_SCALE} onClick={() => adjustScale(1.1)}><Plus size={14}/></button>
            </div>
            <Hint label="О пропорциях объектов">Масштаб меняет размеры всей группы, сохраняя пропорции. «Подогнать» вписывает группу в холст с полями.</Hint><button className="fit-button" disabled={!scene.layers.length} onClick={()=>{try{const next=fitScene(sceneRef.current);if(next!==sceneRef.current){commit(next);notify('Композиция подогнана с сохранением пропорций. Можно отменить.');}else notify('Композиция уже помещается с полями.');}catch(e){notify(e instanceof Error?e.message:'Не удалось подогнать композицию.');}}}>Подогнать</button></div>
        </div>
      </section>
      <aside id="settings-panel" className={`settings-panel ${mobilePanel==='settings'?'mobile-visible':''}`}>
        <div className="settings-scroll"><div className="panel-heading"><h2>Последние штрихи</h2><SlidersHorizontal size={16}/></div>
        <label className="field-label" htmlFor="format">Формат иллюстрации</label><div className="select-wrap"><select id="format" value={`${scene.width}x${scene.height}`} onChange={e=>{const [width,height]=e.target.value.split('x').map(Number);adapt({width,height});}}>{!formats.some(f=>f.w===scene.width&&f.h===scene.height)&&<option value={`${scene.width}x${scene.height}`}>{scene.width} × {scene.height}</option>}{formats.map(f=><option key={f.name} value={`${f.w}x${f.h}`}>{f.name} · {f.label}</option>)}</select><ChevronDown size={14}/></div>
        <div className="field-label label-row">Набор по умолчанию<Hint label="О детализации S и L">Набор по умолчанию применяется к слоям с настройкой «Из сцены». Свой набор S или L можно выбрать в настройках слоя.</Hint></div><div className="detail-toggle">{(['S','L'] as const).map(d=><button className={scene.detail===d?'active':''} aria-pressed={scene.detail===d} key={d} onClick={()=>adapt({detail:d})}><b>{d}</b><span>{d==='L'?'Крупный набор':'Малый набор'}</span>{scene.detail===d&&<Check size={13}/>}</button>)}</div>
        <div className="field-label label-row">Цветовая история<button className="icon-button" aria-label="Загрузить палитру JSON" title="Загрузить палитру JSON" onClick={()=>paletteInput.current?.click()}><Upload size={14}/></button></div>
        <PalettePicker palette={scene.palette} options={[...PALETTES, ...customPalettes,
          ...(![...PALETTES, ...customPalettes].some(p => p.key === scene.palette.key) ? [scene.palette] : [])]}
          onChoose={palette => update({palette})}/>
        <div className="background-label"><label className="field-label" htmlFor="canvas-background">Фон иллюстрации</label><svg className="background-preview" aria-hidden="true" viewBox="0 0 100 100">{scene.background&&<rect width="100" height="100" fill={scene.palette.background[0]}/>}<g dangerouslySetInnerHTML={{__html:backgroundPreview}}/></svg></div><div className="select-wrap"><select id="canvas-background" value={canvasBackground} onChange={e=>update({background:e.target.value!=='transparent',backgroundTexture:['circles','corners'].includes(e.target.value),...(['circles','corners'].includes(e.target.value)?{backgroundPattern:e.target.value as 'circles'|'corners'}:{})})}><option value="circles">Лёгкие штрихи</option><option value="corners">Плоскость</option><option value="plain">Сплошной цвет</option><option value="transparent">Прозрачный</option></select><ChevronDown size={14}/></div>

        <div className="layer-controls"><div className="section-label"><Layers size={14}/> {currentName??'Объект'}<span>{scene.layers.length}</span></div><div className="object-inspector" role="region" aria-label="Настройки выбранного объекта">{current?<>
          <div className="object-actions"><button aria-label="Поднять слой" disabled={scene.layers.at(-1)?.id===selected} onClick={()=>reorder(1)} title="На слой выше"><ArrowUp size={16}/></button><button aria-label="Опустить слой" disabled={scene.layers[0]?.id===selected} onClick={()=>reorder(-1)} title="На слой ниже"><ArrowDown size={16}/></button><button aria-label="Дублировать объект" onClick={duplicate} title="Дублировать · Ctrl+D"><Copy size={16}/></button><button aria-label="Удалить объект" className="delete-button" onClick={remove} title="Удалить · Delete"><Trash2 size={16}/></button></div>
          <div className="transform-grid"><label>Поворот, °<input key={current.id} aria-label="Поворот объекта" type="number" min="-180" max="180" defaultValue={current.rotation}
            onChange={e=>{const angle=e.currentTarget.valueAsNumber;if(angle>=-180&&angle<=180)changeLayer({rotation:angle});}}
            onBlur={e=>{e.currentTarget.value=String(current.rotation);}}
            onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>
            <label>Набор объекта<select value={current.detail??''} onChange={e=>changeLayer({detail:(e.target.value || undefined) as Detail | undefined})}>
              <option value="">Из сцены · {scene.detail}</option><option value="S">S · Малый</option><option value="L">L · Крупный</option>
            </select></label></div>
          <div className="role-toggle"><button className={current.role==='main'?'active':''} aria-pressed={current.role==='main'} onClick={()=>changeLayer({role:'main'})}>Главный</button><button className={current.role==='background'?'active':''} aria-pressed={current.role==='background'} onClick={()=>changeLayer({role:'background'})}>Фоновый</button></div>
          {colorChoice && <label className="object-color">Окраска<select value={current.color??''} onChange={e=>changeLayer({color:e.target.value==='alternate'?'alternate':undefined})}>
            <option value="">{colorChoice[0]}</option><option value="alternate">{colorChoice[1]}</option>
          </select></label>}

        </>:<p className="muted-hint">Выберите объект на холсте — здесь появятся его настройки.</p>}</div>
        <details className="layers-disclosure"><summary>Слои ({scene.layers.length})</summary><div className="layer-list">{[...scene.layers].reverse().map(l=><button className={selected===l.id?'active':''} key={l.id} onClick={()=>selectLayer(l.id)}><span className="layer-mini"><Thumb objectKey={l.key} detail={l.detail??scene.detail} role={l.role} palette={scene.palette} color={l.color}/></span><span>{OBJECTS.find(o=>o.key===l.key)?.name}</span>{selected===l.id?<Check size={12}/>:<span className="layer-role">{l.role==='background'?'фон':''}</span>}</button>)}</div></details></div>

        </div><div className="export-area"><button className="export-button" disabled={!scene.layers.length||!assets.ready} onClick={()=>{try{download(exportSVG(scene),'smysl-illustration.svg','image/svg+xml');notify('SVG готов. Все объекты остаются векторными.');}catch{notify('Не удалось подготовить SVG. Попробуйте ещё раз.');}}}><Download size={16}/>Скачать SVG<ArrowUpRight size={15}/></button><div className="project-actions"><button onClick={()=>download(JSON.stringify(scene,null,2),'smysl-project.json','application/json')}>Сохранить проект</button><button onClick={()=>projectInput.current?.click()}>Открыть</button></div></div>
      </aside>
    </main>
    <section className="examples-section"><div className="examples-heading"><div><span className="eyebrow">НЕМНОГО ВДОХНОВЕНИЯ</span><h2>А если начать вот так?</h2></div><span>Готовые замыслы, которые можно сделать своими <ArrowDown size={14}/></span></div><div className="idea-grid" style={ideaGridStyle}>{EXAMPLES.map((example,i)=><IdeaCard key={example.title} index={i} disabled={busy} onChoose={openExample}/>)}</div></section>
    <footer><span className="footer-brand">смысл.</span><span>Мастерская сохраняет геометрию исходных объектов.</span><button onClick={()=>setShowHelp(true)}>О мастерской <ArrowUpRight size={12}/></button></footer>
    {toast&&<div className="toast" role="status"><Check size={15}/>{toast}<button onClick={()=>setToast('')} aria-label="Закрыть уведомление"><X size={14}/></button></div>}
    {showHelp&&<Dialog titleId="help-title" onClose={()=>setShowHelp(false)}><button className="modal-close" aria-label="Закрыть справку" onClick={()=>setShowHelp(false)}><X size={20}/></button><Sparkles size={30}/><h2 id="help-title">Как устроена мастерская</h2><p>Опишите идею или выберите знакомые объекты. Мастерская предложит композицию, а вы добавите последние штрихи.</p><ol><li>Выберите замысел и нажмите «Собрать».</li><li>Перетаскивайте объекты. Меняйте формат, детали и цвета.</li><li>Скачайте SVG или сохраните проект для продолжения.</li></ol><p className="help-note">Сервис сопоставляет замысел с образами библиотеки. При слабой связи мастерская предложит проверить трактовку или уточнить запрос. Сложные метафоры могут остаться нераспознанными. Новые картинки не генерируются — используются только объекты исходной библиотеки.</p><p className="help-note">Своя палитра: JSON с полями name, background и objects. В каждом массиве — 4 цвета #RRGGBB. <button onClick={()=>download(JSON.stringify(PALETTES[0],null,2),'palette-example.json','application/json')}>Скачать образец</button></p><div className="shortcuts"><span>Ctrl Z — отменить</span><span>Ctrl D — копия</span><span>Delete — удалить</span><span>Стрелки — сдвинуть</span></div></Dialog>}
    <input ref={paletteInput} type="file" accept=".json,application/json" hidden onChange={e=>{void importPalette(e.target.files?.[0]);e.target.value='';}}/><input ref={projectInput} type="file" accept=".json,application/json" hidden onChange={e=>{void importProject(e.target.files?.[0]);e.target.value='';}}/>
  </div>;
}
