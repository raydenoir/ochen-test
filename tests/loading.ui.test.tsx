import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assetReady, loadAsset, loadSceneAssets, sceneAssetsReady } from '../src/assets';
import App from '../src/App';

vi.mock('../src/assets',async original=>{
  const actual=await original<typeof import('../src/assets')>();
  return {...actual,assetReady:vi.fn(),loadSceneAssets:vi.fn(),sceneAssetsReady:vi.fn()};
});
beforeAll(async()=>{await Promise.all(['book','lamp','pen','coin'].flatMap(key=>(['L','S'] as const).map(detail=>loadAsset(key,detail,'main'))));});
beforeEach(()=>{localStorage.clear();vi.mocked(loadSceneAssets).mockReset();vi.mocked(sceneAssetsReady).mockReset();});
afterEach(cleanup);

it('retains edits while vector sources are loading and enables export only when ready',async()=>{
  let ready=false,finish!:()=>void;
  vi.mocked(assetReady).mockImplementation(()=>ready);
  vi.mocked(sceneAssetsReady).mockImplementation(()=>ready);
  vi.mocked(loadSceneAssets).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const user=userEvent.setup();render(<App/>);
  expect(screen.getByText('Загружаем векторные объекты…')).toBeTruthy();
  expect((screen.getByRole('button',{name:/Скачать SVG/}) as HTMLButtonElement).disabled).toBe(true);
  const background=screen.getByRole('combobox',{name:'Фон иллюстрации'});
  await user.selectOptions(background,'transparent');
  await act(async()=>{ready=true;finish();});
  expect((background as HTMLSelectElement).value).toBe('transparent');
  expect(document.querySelector('#scene-decoration')).toBeNull();
  expect((screen.getByRole('button',{name:/Скачать SVG/}) as HTMLButtonElement).disabled).toBe(false);
  expect(document.querySelectorAll('.canvas-object').length).toBe(3);
});

it('offers retry without losing the composition when a source fails to load',async()=>{
  let ready=false;
  vi.mocked(assetReady).mockImplementation(()=>ready);
  vi.mocked(sceneAssetsReady).mockImplementation(()=>ready);
  vi.mocked(loadSceneAssets).mockRejectedValueOnce(Error('network')).mockImplementation(async()=>{ready=true;});
  const user=userEvent.setup();render(<App/>);
  await screen.findByText(/Не удалось загрузить исходные объекты/);
  await user.click(screen.getByRole('button',{name:'Повторить загрузку'}));
  await waitFor(()=>expect(document.querySelectorAll('.canvas-object').length).toBe(3));
  expect(vi.mocked(loadSceneAssets).mock.calls.length).toBe(2);
});

it('ignores completion of an obsolete detail request',async()=>{
  const ready=new Set<string>();
  const pending=new Map<string,()=>void>();
  vi.mocked(assetReady).mockImplementation((_key,detail)=>ready.has(detail));
  vi.mocked(sceneAssetsReady).mockImplementation(scene=>ready.has(scene.detail));
  vi.mocked(loadSceneAssets).mockImplementation(scene=>new Promise(resolve=>{pending.set(scene.detail,resolve);}));
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:/S Малый набор/}));
  await act(async()=>{ready.add('L');pending.get('L')!();});
  expect(document.querySelectorAll('.canvas-object').length).toBe(0);
  await act(async()=>{ready.add('S');pending.get('S')!();});
  expect(document.querySelectorAll('.canvas-object').length).toBe(3);
});

it('keeps ready layers visible while an added layer is loading',async()=>{
  let finish!:()=>void;
  let coinReady=false;
  vi.mocked(assetReady).mockImplementation(key=>key!=='coin'||coinReady);
  vi.mocked(sceneAssetsReady).mockImplementation(scene=>scene.layers.every(l=>l.key!=='coin'||coinReady));
  vi.mocked(loadSceneAssets).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'Добавить Монета'}));
  expect(document.querySelectorAll('.canvas-object').length).toBe(3);
  expect((screen.getByRole('button',{name:/Скачать SVG/}) as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>{coinReady=true;finish();});
  expect(document.querySelectorAll('.canvas-object').length).toBe(4);
  expect((screen.getByRole('button',{name:/Скачать SVG/}) as HTMLButtonElement).disabled).toBe(false);
});
