import { OBJECTS } from './model';
import type { Role } from './model';

export interface Interpretation {
  source: 'semantic' | 'lexical';
  confidence: 'confident' | 'tentative';
  matches: { key: string; name: string; role: Role; reason: string; supporting: boolean }[];
}

export function validateInterpretation(value: unknown): value is Interpretation {
  if (!value || typeof value !== 'object') return false;
  const v = value as Interpretation;
  return ['semantic','lexical'].includes(v.source) && ['confident','tentative'].includes(v.confidence)
    && Array.isArray(v.matches) && v.matches.length <= 6
    && v.matches.every(m => m && OBJECTS.some(o => o.key === m.key) && typeof m.reason === 'string' && m.reason.length <= 300
      && typeof m.name === 'string' && typeof m.supporting === 'boolean' && ['main','background'].includes(m.role))
    && new Set(v.matches.map(m => m.key)).size === v.matches.length;
}

export async function interpretIdea(prompt: string, signal: AbortSignal): Promise<Interpretation> {
  const response = await fetch('/api/interpret', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }), signal,
  });
  if (!response.ok) throw new Error('Смысловой анализ недоступен. Повторите попытку или используйте подбор по знакомым словам.');
  const data: unknown = await response.json();
  if (!validateInterpretation(data)) throw new Error('Получен некорректный подбор. Холст сохранён. Попробуйте ещё раз.');
  return data;
}
