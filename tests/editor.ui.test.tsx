import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { loadAsset } from '../src/assets';
import { OBJECTS } from '../src/model';

beforeAll(async()=>{await Promise.all(OBJECTS.flatMap(o=>(['L','S'] as const).flatMap(d=>(['main','background'] as const).map(r=>loadAsset(o.key,d,r)))));});

beforeEach(()=>{localStorage.clear();vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const canvas=()=>screen.getByRole('region',{name:'Редактор иллюстрации'}).querySelector('.artboard svg')!;
const sceneTransform=()=>[...canvas().querySelectorAll('.canvas-object')].map(n=>n.getAttribute('transform'));
const thumbnailSVG=(name: string)=>decodeURIComponent(screen.getByRole('button',{name,exact:true}).querySelector('img')!.getAttribute('src')!);

it('uses the physical shortcut keys in Cyrillic and leaves focused text fields alone',async()=>{
  const user=userEvent.setup();render(<App/>);
  const card=screen.getByRole('button',{name:'Добавить Книга'});
  await user.click(card);
  const count=canvas().querySelectorAll('.canvas-object').length;
  const undo={code:'KeyZ',key:'я',ctrlKey:true};
  const duplicate={code:'KeyD',key:'в',ctrlKey:true};
  const field=screen.getByRole('textbox',{name:'О чём ваша иллюстрация?'});
  await user.click(field);
  expect(fireEvent.keyDown(field,undo)).toBe(true);
  expect(fireEvent.keyDown(field,duplicate)).toBe(true);
  expect(canvas().querySelectorAll('.canvas-object')).toHaveLength(count);

  expect(fireEvent.keyDown(card,duplicate)).toBe(false);
  expect(canvas().querySelectorAll('.canvas-object')).toHaveLength(count+1);
  expect(fireEvent.keyDown(card,undo)).toBe(false);
  expect(canvas().querySelectorAll('.canvas-object')).toHaveLength(count);
  fireEvent.keyDown(card,{...undo,key:'Я',shiftKey:true});
  expect(canvas().querySelectorAll('.canvas-object')).toHaveLength(count+1);
});

describe('source library controls',()=>{
  it('recolors the catalog and layer thumbnails with the active palette',async()=>{
    const user=userEvent.setup();render(<App/>);
    expect(thumbnailSVG('Добавить Пазлы')).toContain('/L/main/puzzle.svg');
    await user.click(screen.getByLabelText('Выбрать палитру'));
    await user.click(screen.getByRole('button',{name:'Палитра Мятная свежесть'}));
    expect(thumbnailSVG('Добавить Пазлы')).toContain('#FFD4F2');
    await user.click(screen.getByText('Слои (3)'));
    expect(thumbnailSVG('Книга')).toContain('#FFD4F2');
    await user.click(screen.getByRole('button',{name:'Фоновые',exact:true}));
    expect(thumbnailSVG('Добавить Пазлы — фоновый')).toContain('#5ABEBE');
    expect(thumbnailSVG('Добавить Пазлы — фоновый')).not.toContain('#FFD4F2');
    await user.click(screen.getByRole('button',{name:'Отменить действие'}));
    expect(thumbnailSVG('Добавить Пазлы — фоновый')).toContain('/L/background/puzzle.svg');
  });
  it('adds a genuine background source and can switch it to main',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(screen.getByRole('button',{name:'Фоновые',exact:true}));
    const card=screen.getByRole('button',{name:'Добавить Книга — фоновый'});
    expect(card.querySelector('img')?.getAttribute('src')).toContain('/L/background/book.svg');
    await user.click(card);
    await waitFor(()=>expect(canvas().querySelectorAll('.canvas-object').length).toBe(4));
    const source=canvas().querySelector('.canvas-object svg');
    expect(source?.getAttribute('viewBox')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Фоновый',exact:true}).className).toContain('active');
    await user.click(screen.getByRole('button',{name:'Главный',exact:true}));
    expect(screen.getByRole('button',{name:'Главный',exact:true}).className).toContain('active');
  });
  it('switches original S/L sources in the catalog and on the canvas',async()=>{
    const user=userEvent.setup();render(<App/>);
    const before=canvas().querySelector('.canvas-object svg')?.getAttribute('viewBox');
    await user.click(screen.getByRole('button',{name:/S Малый набор/}));
    expect(screen.getByRole('button',{name:'Добавить Книга'}).querySelector('img')?.getAttribute('src')).toContain('/S/main/book.svg');
    await waitFor(()=>expect(canvas().querySelector('.canvas-object svg')?.getAttribute('viewBox')).not.toBe(before));
    await user.click(screen.getByRole('button',{name:'Отменить действие'}));
    expect(canvas().querySelector('.canvas-object svg')?.getAttribute('viewBox')).toBe(before);
  });
  it('switches the canvas texture and preserves transparent mode through undo',async()=>{
    const user=userEvent.setup();render(<App/>);
    const background=screen.getByRole('combobox',{name:'Фон иллюстрации'});
    expect(canvas().querySelector('#scene-decoration')).toBeTruthy();
    await user.selectOptions(background,'plain');
    expect(canvas().querySelector('#scene-decoration')).toBeNull();
    expect(canvas().querySelector('rect')?.getAttribute('fill')).toBe('#D7CDF5');
    await user.selectOptions(background,'transparent');
    expect(canvas().firstElementChild?.tagName.toLowerCase()).toBe('g');
    await user.click(screen.getByRole('button',{name:'Отменить действие'}));
    expect((background as HTMLSelectElement).value).toBe('plain');
    expect(screen.queryByRole('slider')).toBeNull();
  });
  it('includes selected background objects in composition by names',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(screen.getByRole('button',{name:'Из объектов',exact:true}));
    await user.click(screen.getByRole('button',{name:'Фоновые',exact:true}));
    await user.click(screen.getByRole('button',{name:'Выбрать Книга — фоновый'}));
    expect((screen.getByRole('textbox',{name:'Какие объекты собрать?'}) as HTMLTextAreaElement).value).toContain('Книга (фон)');
    await user.click(screen.getByRole('button',{name:/Собрать композицию/}));
    await waitFor(()=>expect(canvas().querySelectorAll('.canvas-object').length).toBe(4));
    await waitFor(()=>{
      const saved=JSON.parse(localStorage.getItem('ochen-studio-v2')!);
      expect(saved?.layers.filter((l:{key:string;role:string})=>l.key==='book').map((l:{role:string})=>l.role)).toEqual(['background','main']);
    });
  });
  it('keeps the chosen background pattern when changing palette and restores it with undo',async()=>{
    const user=userEvent.setup();render(<App/>);
    const select=screen.getByRole('combobox',{name:'Фон иллюстрации'});
    await user.selectOptions(select,'corners');
    const paths=()=>[...canvas().querySelectorAll('#scene-decoration path')].map(p=>p.getAttribute('d'));
    const before=paths();
    await user.click(screen.getByLabelText('Выбрать палитру'));
    await user.click(screen.getByRole('button',{name:'Палитра Мятная свежесть'}));
    expect((select as HTMLSelectElement).value).toBe('corners');
    expect(paths()).toEqual(before);
    await user.selectOptions(select,'circles');
    expect(paths()).not.toEqual(before);
    await user.click(screen.getByRole('button',{name:'Отменить действие'}));
    expect((select as HTMLSelectElement).value).toBe('corners');
    expect(paths()).toEqual(before);
  });
});

it('opens the exact inspiration preset, including palette, format and detail',async()=>{
  const user=userEvent.setup();render(<App/>);
  const card=screen.getByRole('button',{name:/Командная работа Большие идеи/});
  expect((card.querySelector('.idea-card-preview') as HTMLElement).style.aspectRatio).toBe('1000 / 1000');
  await user.click(card);
  expect((screen.getByLabelText('Формат иллюстрации') as HTMLSelectElement).value).toBe('1000x1000');
  expect(canvas().querySelector('rect')?.getAttribute('fill')).toBe('#FDD7B9');
  expect(canvas().getAttribute('viewBox')).toBe('0 0 1000 1000');
  expect(screen.getByRole('button',{name:'Выбрать Лампа'}).querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 473 565');
});

it('keeps the inspector container when an object is selected and deselected',async()=>{
  const user=userEvent.setup();render(<App/>);
  const inspector=screen.getByRole('region',{name:'Настройки выбранного объекта'});
  await user.click(screen.getByText('Слои (3)'));
  await user.click(screen.getByRole('button',{name:'Книга'}));
  expect(screen.getByRole('region',{name:'Настройки выбранного объекта'})).toBe(inspector);
  expect(screen.getByRole('spinbutton',{name:'Поворот объекта'})).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Снять выделение'}));
  expect(screen.getByRole('region',{name:'Настройки выбранного объекта'})).toBe(inspector);
  expect(screen.queryByRole('spinbutton',{name:'Поворот объекта'})).toBeNull();
});

it('preserves a negative rotation when the input is cleared or exceeds its bounds',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByText('Слои (3)'));
  await user.click(screen.getByRole('button',{name:'Книга'}));
  const rotation=screen.getByRole<HTMLInputElement>('spinbutton',{name:'Поворот объекта'});
  await user.clear(rotation);
  await user.type(rotation,'-35');
  const book=screen.getByRole('button',{name:'Выбрать Книга'});
  expect(book.getAttribute('transform')).toContain('rotate(-35)');
  await user.clear(rotation);
  expect(book.getAttribute('transform')).toContain('rotate(-35)');
  await user.paste('181');
  await user.tab();
  expect(rotation.value).toBe('-35');
  expect(book.getAttribute('transform')).toContain('rotate(-35)');
});

it('opens explanatory hints from the keyboard and dismisses them with Escape',async()=>{
  const user=userEvent.setup();render(<App/>);
  const hint=screen.getByRole('button',{name:'О пропорциях объектов'});
  await user.click(hint);
  expect(screen.getByRole('tooltip').textContent).toContain('сохраняя пропорции');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('tooltip')).toBeNull();
});

describe('help dialog',()=>{
  it('keeps keyboard focus inside and restores focus on Escape',async()=>{
    const user=userEvent.setup();render(<App/>);
    const trigger=screen.getByRole('button',{name:/Как это работает/});
    await user.click(trigger);
    const close=screen.getByRole('button',{name:'Закрыть справку'});
    const sample=screen.getByRole('button',{name:'Скачать образец'});
    expect(document.activeElement).toBe(close);
    expect(document.querySelector<HTMLElement>('.app-shell')?.inert).toBe(true);
    await user.tab({shift:true});expect(document.activeElement).toBe(sample);
    await user.tab();expect(document.activeElement).toBe(close);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(trigger);
    expect(document.querySelector<HTMLElement>('.app-shell')?.inert).toBe(false);
  });
  it('closes with the close button and restores page scrolling',async()=>{
    const user=userEvent.setup();render(<App/>);
    const overflow=document.body.style.overflow;
    await user.click(screen.getByRole('button',{name:/Как это работает/}));
    expect(document.body.style.overflow).toBe('hidden');
    await user.click(screen.getByRole('button',{name:'Закрыть справку'}));
    expect(document.body.style.overflow).toBe(overflow);
  });
  it('does not apply editor shortcuts behind the dialog',async()=>{
    const user=userEvent.setup();render(<App/>);
    await user.click(screen.getByText('Слои (3)'));
    await user.click(screen.getByRole('button',{name:'Книга'}));
    await user.click(screen.getByRole('button',{name:/Как это работает/}));
    await user.keyboard('{Delete}');
    expect(canvas().querySelectorAll('.canvas-object').length).toBe(3);
  });
});

const result=(confidence='confident')=>({source:'semantic',confidence,matches:[{key:'phone',name:'Телефон',role:'main',reason:'Связь на расстоянии.',supporting:false}]});
describe('idea interpretation',()=>{
  it('uses a confident semantic result and explains the selected image',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(result())));
    const user=userEvent.setup();render(<App/>);
    const idea=screen.getByRole('textbox',{name:'О чём ваша иллюстрация?'});
    await user.clear(idea);await user.type(idea,'Быть рядом за тысячу километров');
    await user.click(screen.getByRole('button',{name:/Собрать композицию/}));
    await waitFor(()=>expect(canvas().querySelectorAll('.canvas-object').length).toBe(1));
    expect(screen.getByRole('region',{name:'Почему выбраны эти объекты'}).textContent).toContain('Связь на расстоянии.');
  });
  it('keeps the current scene until a tentative interpretation is accepted',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(result('tentative'))));
    const user=userEvent.setup();render(<App/>);const before=sceneTransform();
    await user.click(screen.getByRole('button',{name:/Собрать композицию/}));
    await screen.findByRole('button',{name:'Собрать с этими образами'});
    expect(sceneTransform()).toEqual(before);
    await user.click(screen.getByRole('button',{name:'Собрать с этими образами'}));
    expect(canvas().querySelectorAll('.canvas-object').length).toBe(1);
  });
  it('does not overwrite edits made while analysis was pending',async()=>{
    let resolve!:(value:Response)=>void;
    vi.mocked(fetch).mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const user=userEvent.setup();render(<App/>);
    await user.click(screen.getByRole('button',{name:/Собрать композицию/}));
    await user.click(screen.getByLabelText('Выбрать палитру'));
    await user.click(screen.getByRole('button',{name:'Палитра Тёплый персик'}));
    await act(async()=>{resolve(new Response(JSON.stringify(result())));});
    await screen.findByRole('button',{name:'Собрать с этими образами'});
    expect(canvas().querySelectorAll('.canvas-object').length).toBe(3);
    expect(screen.getByRole('alert').textContent).toContain('вы изменили холст');
  });
  it('ignores a late answer after the prompt has changed',async()=>{
    let resolve!:(value:Response)=>void;
    vi.mocked(fetch).mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const user=userEvent.setup();render(<App/>);const before=sceneTransform();
    await user.click(screen.getByRole('button',{name:/Собрать композицию/}));
    await user.type(screen.getByRole('textbox',{name:'О чём ваша иллюстрация?'}),' другой замысел');
    await act(async()=>{resolve(new Response(JSON.stringify(result())));});
    await waitFor(()=>expect((screen.getByRole('button',{name:/Собрать композицию/}) as HTMLButtonElement).disabled).toBe(false));
    expect(sceneTransform()).toEqual(before);
  });
  it('rejects unknown objects in server responses and preserves the canvas',async()=>{
    const data=result();data.matches[0].key='new-generated-image';
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(data)));
    const user=userEvent.setup();render(<App/>);const before=sceneTransform();
    await user.click(screen.getByRole('button',{name:/Собрать композицию/}));
    await screen.findByRole('alert');expect(sceneTransform()).toEqual(before);
    expect(screen.getByRole('alert').textContent).toContain('некорректный подбор');
  });
});

it('builds exact names with a background, keeps edits during validation, and restores the whole scene',async()=>{
  const user=userEvent.setup();
  const app=render(<App/>);
  const start=sceneTransform();
  await user.click(screen.getByRole('button',{name:'Из объектов',exact:true}));
  const field=screen.getByRole('textbox',{name:'Какие объекты собрать?'});
  const build=screen.getByRole('button',{name:'Собрать композицию'});
  async function enter(names:string) {
    await user.clear(field);
    await user.paste(names);
    await user.click(build);
  }
  await enter('Кошелёк, монета, лампа (фон)');
  const layers=()=>[...canvas().querySelectorAll('.canvas-object')].map(node=>node.getAttribute('aria-label'));
  expect(layers()).toEqual(['Выбрать Лампа','Выбрать Кошелёк','Выбрать Монета']);
  const made=sceneTransform();
  await enter('Кашелёк, монета');
  expect(screen.getByRole('alert').textContent).toContain('Кашелёк');
  expect(sceneTransform()).toEqual(made);
  await enter(Array(7).fill('монета').join(', '));
  expect(screen.getByRole('alert').textContent).toContain('до 6');
  expect(sceneTransform()).toEqual(made);
  await user.click(screen.getByRole('button',{name:'Отменить действие'}));
  expect(sceneTransform()).toEqual(start);
  await user.click(screen.getByRole('button',{name:'Повторить действие'}));
  expect(sceneTransform()).toEqual(made);
  await waitFor(()=>expect(JSON.parse(localStorage.getItem('ochen-studio-v2')!).title).toContain('Кошелёк'));
  app.unmount();
  render(<App/>);
  expect(sceneTransform()).toEqual(made);
});

it('preserves manual edits on detail and portrait changes and keeps inactive selections out of history',async()=>{
  const user=userEvent.setup();
  render(<App/>);
  const original=sceneTransform();
  await user.click(screen.getByRole('button',{name:/L Крупный набор/}));
  expect((screen.getByRole('button',{name:'Отменить действие'}) as HTMLButtonElement).disabled).toBe(true);
  await user.tab();
  const book=screen.getByRole('button',{name:'Выбрать Книга'});
  act(()=>book.focus());
  await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
  const moved=sceneTransform();
  expect(moved).not.toEqual(original);
  await user.click(screen.getByRole('button',{name:/S Малый набор/}));
  expect(sceneTransform()).toEqual(moved);
  await user.selectOptions(screen.getByRole('combobox',{name:'Формат иллюстрации'}),'800x1200');
  expect(canvas().getAttribute('viewBox')).toBe('0 0 800 1200');
  await user.click(screen.getByRole('button',{name:'Отменить действие'}));
  expect(sceneTransform()).toEqual(moved);
  await user.click(screen.getByRole('button',{name:'Повторить действие'}));
  expect(canvas().getAttribute('viewBox')).toBe('0 0 800 1200');
  await user.selectOptions(screen.getByRole('combobox',{name:'Формат иллюстрации'}),'1200x800');
  expect(sceneTransform()).toEqual(moved);
});

it('changes one common scale with the composition controls and can undo it',async()=>{
  const user=userEvent.setup();
  render(<App/>);
  const widths=()=>[...canvas().querySelectorAll('.canvas-object > rect')].map(rect=>Number(rect.getAttribute('width')));
  const initial=widths();
  const positions=sceneTransform();
  await user.click(screen.getByRole('button',{name:'Увеличить композицию'}));
  const larger=widths();
  expect(larger).toHaveLength(initial.length);
  expect(larger.every((width,index)=>Math.abs(width/initial[index]-1.1)<1e-9)).toBe(true);
  await user.click(screen.getByRole('button',{name:'Уменьшить композицию'}));
  widths().forEach((width,index)=>expect(width).toBeCloseTo(initial[index],8));
  await user.click(screen.getByRole('button',{name:'Отменить действие'}));
  expect(widths()).toEqual(larger);
  await user.click(screen.getByRole('button',{name:'Отменить действие'}));
  expect(widths()).toEqual(initial);
  expect(sceneTransform()).toEqual(positions);
});

it('assembles the named preset with the shown frame and fits cropped backgrounds on request',async()=>{
  const user=userEvent.setup();
  render(<App/>);
  await user.click(screen.getByRole('button',{name:/Сбережения Деньги на чёрный день/}));
  const layout=screen.getByRole('combobox',{name:'Раскладка'}) as HTMLSelectElement;
  expect(layout.value).toBe('cropped');
  expect(canvas().getAttribute('viewBox')).toBe('0 0 1000 1000');
  const cropped=sceneTransform();
  await user.click(screen.getByRole('button',{name:'Подогнать'}));
  expect(layout.value).toBe('balanced');
  expect(sceneTransform()).not.toEqual(cropped);
  await user.click(screen.getByRole('button',{name:'Отменить действие'}));
  expect(layout.value).toBe('cropped');
  expect(sceneTransform()).toEqual(cropped);
});

it('cancels a pending interpretation, ignores its late result and lets the user retry',async()=>{
  let finish!:(value:Response)=>void;
  const transport=vi.mocked(fetch);
  transport.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  transport.mockResolvedValueOnce(new Response(JSON.stringify(result())));
  const user=userEvent.setup();
  render(<App/>);
  const before=sceneTransform();
  const build=screen.getByRole('button',{name:'Собрать композицию'});
  await user.click(build);
  await user.click(screen.getByRole('button',{name:'Отменить подбор'}));
  const options=transport.mock.calls[0][1];
  expect(options?.signal?.aborted).toBe(true);
  await act(async()=>finish(new Response(JSON.stringify(result()))));
  expect(sceneTransform()).toEqual(before);
  await user.click(build);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Выбрать Телефон'})).toBeTruthy());
});

it('opens saved projects and custom palettes and preserves the canvas after invalid files',async()=>{
  const user=userEvent.setup();
  const {container}=render(<App/>);
  const [palette,project]=container.querySelectorAll<HTMLInputElement>('input[type=file]');
  const json=(name:string, value:string)=>new File([value],name,{type:'application/json'});
  const saved=await waitFor(()=>{
    const raw=localStorage.getItem('ochen-studio-v2');
    expect(raw).toBeTruthy();
    return JSON.parse(raw!);
  });
  const initial=sceneTransform();
  await user.upload(project,json('invalid.json',JSON.stringify({...saved,palette:{...saved.palette,name:{}}})));
  await screen.findByText('Этот файл не похож на проект «Смысл».');
  expect(sceneTransform()).toEqual(initial);
  await user.upload(project,json('project.json',JSON.stringify({...saved,title:'Открытый проект',width:800,height:1200})));
  await screen.findByText('Проект открыт');
  expect(canvas().getAttribute('aria-label')).toBe('Открытый проект');
  expect(canvas().getAttribute('viewBox')).toBe('0 0 800 1200');
  const projectLayers=sceneTransform();
  const custom={name:'Своя схема',background:['#123456','#567890','#345678','#222222'],objects:saved.palette.objects};
  await user.upload(palette,json('palette.json',JSON.stringify(custom)));
  await screen.findByText('Палитра загружена и применена');
  expect(canvas().querySelector('rect')?.getAttribute('fill')).toBe('#123456');
  await user.upload(palette,json('broken.json','{'));
  await screen.findByText('Файл палитры должен быть в формате JSON.');
  expect(canvas().querySelector('rect')?.getAttribute('fill')).toBe('#123456');
  expect(sceneTransform()).toEqual(projectLayers);
});


it('opens the palette above the scroll panel and restores focus when dismissed',async()=>{
  const user=userEvent.setup();
  render(<App/>);
  const trigger=screen.getByRole('button',{name:'Выбрать палитру'});
  await user.click(trigger);
  const menu=screen.getByRole('group',{name:'Палитры'});
  expect(menu.closest('.settings-scroll')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('group',{name:'Палитры'})).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('uses the same savings composition for the exact typed idea and the example',async()=>{
  const user=userEvent.setup();
  render(<App/>);
  const card=screen.getByRole('button',{name:/Сбережения Деньги на чёрный день/});
  await user.click(card);
  const fromCard=canvas().innerHTML;
  await user.click(screen.getByRole('button',{name:'Отменить действие'}));
  const field=screen.getByRole('textbox',{name:'О чём ваша иллюстрация?'});
  await user.clear(field);
  await user.paste('Деньги на черный день!');
  await user.click(screen.getByRole('button',{name:'Собрать композицию'}));
  expect(canvas().innerHTML).toBe(fromCard);
  expect(fetch).not.toHaveBeenCalled();
});

it('can change just the background lamp to L in an S scene and still use its actions',async()=>{
  const user=userEvent.setup();
  render(<App/>);
  await user.click(screen.getByRole('button',{name:/S Малый набор/}));
  await user.click(screen.getByRole('button',{name:'Фоновые',exact:true}));
  await user.click(screen.getByRole('button',{name:'Добавить Лампа — фоновый'}));
  const layers=()=>[...canvas().querySelectorAll('.canvas-object')];
  const previous=layers().slice(1).map(node=>node.innerHTML);
  const small=layers()[0].querySelector('svg')?.getAttribute('viewBox');
  const layerWidth=()=>Number(layers()[0].querySelector('rect')?.getAttribute('width'));
  const smallWidth=layerWidth();
  const detail=screen.getByRole('combobox',{name:'Набор объекта'});
  await user.selectOptions(detail,'L');
  expect(layers()[0].querySelector('svg')?.getAttribute('viewBox')).not.toBe(small);
  expect(layers().slice(1).map(node=>node.innerHTML)).toEqual(previous);
  const largeWidth=layerWidth();
  expect(largeWidth).toBeCloseTo(2*smallWidth);
  const inheritedWidth=()=>Number(layers()[1].querySelector('rect')?.getAttribute('width'));
  const inheritedSmall=inheritedWidth();
  await user.click(screen.getByRole('button',{name:/L Крупный набор/}));
  expect(layerWidth()).toBe(largeWidth);
  expect(inheritedWidth()).toBeGreaterThan(inheritedSmall);
  await user.selectOptions(detail,'S');
  expect(layerWidth()).toBe(smallWidth);
  await user.click(screen.getByRole('button',{name:/S Малый набор/}));
  expect(layerWidth()).toBe(smallWidth);
  expect(inheritedWidth()).toBe(inheritedSmall);
  await user.selectOptions(detail,'L');
  const inspector=screen.getByRole('region',{name:'Настройки выбранного объекта'});
  expect(inspector.querySelector('.object-actions')).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Дублировать объект'}));
  expect(layers().length).toBe(5);
  expect(layers()[1].querySelector('svg')?.getAttribute('viewBox')).toBe(layers()[0].querySelector('svg')?.getAttribute('viewBox'));
});
