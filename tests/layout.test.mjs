import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

test('inspiration headings never inherit editor-sized minimum heights',async()=>{
  for(const file of ['src/style.css','src/workspace.css']) {
    const root=postcss.parse(await readFile(new URL('../'+file,import.meta.url),'utf8'));
    root.walkRules(rule=>{
      if(!rule.selector.includes('.examples-heading'))return;
      rule.walkDecls('min-height',decl=>{
        if(decl.value.endsWith('px'))assert.ok(parseFloat(decl.value)<=96,`${file}: ${rule.selector} forces a large blank area`);
      });
    });
  }
});
