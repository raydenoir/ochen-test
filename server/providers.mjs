import { createInterpreter, createLocalEncoder, interpreter } from './semantic.mjs';
import { createJevInterpreter } from './jev.mjs';

export function createInterpretProvider(config = process.env) {
  const provider = config.INTERPRET_PROVIDER || (config.TYPESAFE_API_KEY ? 'jev' : 'local');
  if (provider === 'local') {
    return config.MODEL_CACHE_DIR ? createInterpreter(createLocalEncoder(config.MODEL_CACHE_DIR)) : interpreter;
  }
  if (provider === 'jev') return createJevInterpreter({ apiKey: config.TYPESAFE_API_KEY, model: config.TYPESAFE_MODEL || 'jev-latest' });
  throw new Error('INTERPRET_PROVIDER должен быть jev или local.');
}
