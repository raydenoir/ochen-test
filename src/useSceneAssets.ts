import { useEffect, useState } from 'react';
import { loadSceneAssets, sceneAssetsReady } from './assets';
import type { Scene } from './model';

export function useSceneAssets(scene: Scene) {
  const signature = [...new Set(scene.layers.map(l => `${l.detail ?? scene.detail}/${l.key}/${l.role}`))].sort().join(',');
  const [, redraw] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ signature: string; message: string } | null>(null);
  const ready = sceneAssetsReady(scene);
  useEffect(() => {
    if (sceneAssetsReady(scene)) return;
    let active = true;
    setFailure(null);
    const refresh = () => { if (active) redraw(v => v + 1); };
    loadSceneAssets(scene, refresh).then(refresh)
      .catch(() => { if (active) setFailure({ signature, message: 'Не удалось загрузить исходные объекты. Композиция сохранена — попробуйте ещё раз.' }); });
    return () => { active = false; };
    // Coordinates, palette and layer IDs do not change the required source files.
  }, [signature, attempt]);
  return { ready, error: !ready && failure?.signature === signature ? failure.message : '', retry: () => setAttempt(v => v + 1) };
}
