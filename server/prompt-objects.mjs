export function excludedObjects(prompt) {
  const text = prompt.toLowerCase().replaceAll('ё','е');
  const names = { book: /книг/, phone: /телефон/, puzzle: /пазл/, coin: /монет/, headphones: /наушник/, lamp: /ламп/, flowers: /цвет(?:ы|ов|ами)/, folder: /папк/, pen: /ручк/, wallet: /кошел/ };
  const excluded = new Set();
  for (const match of text.matchAll(/(?:^|\s)(?:без|никаких|не нужны|не используй|не добавляй)\s+([^,.!?;]+)/g)) {
    const clause = match[1].split(/\s+(?:но|зато)\s+/)[0];
    for (const [key, pattern] of Object.entries(names)) if (pattern.test(clause)) excluded.add(key);
  }
  if (/не про (?:деньги|финансы)/.test(text)) { excluded.add('coin'); excluded.add('wallet'); }
  return excluded;
}

export function namedObjects(prompt) {
  const words = prompt.toLowerCase().replaceAll('ё','е').split(/[^a-zа-я]+/);
  const forms = {
    book: ['книга','книги','книгу','книгой','book'], phone: ['телефон','телефона','телефоном','phone'],
    puzzle: ['пазл','пазлы','пазлов','пазлами','puzzle'], coin: ['монета','монеты','монету','монетой','coin'],
    headphones: ['наушники','наушников','наушниках','наушниками','headphones'], lamp: ['лампа','лампы','лампу','лампой','lamp'],
    flowers: ['цветы','цветов','цветами','букет','flowers'], folder: ['папка','папки','папку','папкой','folder'],
    pen: ['ручка','ручки','ручку','ручкой','pen'], wallet: ['кошелек','кошелька','кошельком','кошельке','кошельки','wallet'],
  };
  const keys = new Map(Object.entries(forms).flatMap(([key, names]) => names.map(name => [name, key])));
  return [...new Set(words.map(word => keys.get(word)).filter(Boolean))];
}
