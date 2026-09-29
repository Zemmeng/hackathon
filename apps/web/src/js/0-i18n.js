'use strict';
/* ============================================================
   Language: English / 简体中文. L(en, zh) picks the active string.
   Static markup carries its Chinese text in data-zh / data-zh-* attributes.
   ============================================================ */
const LANG={cur:'en'};
const L=(en,zh)=>LANG.cur==='zh'?zh:en;
function applyLangDom(){
  document.documentElement.lang=LANG.cur==='zh'?'zh-CN':'en';
  document.querySelectorAll('[data-zh]').forEach(el=>{if(el.dataset.en==null)el.dataset.en=el.textContent;el.textContent=LANG.cur==='zh'?el.dataset.zh:el.dataset.en;});
  for(const attr of['aria-label','data-tip','title']){
    const key='zh'+attr.replace(/(^|-)(\w)/g,(m,a,c)=>c.toUpperCase());
    document.querySelectorAll(`[data-zh-${attr}]`).forEach(el=>{const enKey='en'+key.slice(2);if(el.dataset[enKey]==null)el.dataset[enKey]=el.getAttribute(attr)||'';el.setAttribute(attr,LANG.cur==='zh'?el.dataset[key]:el.dataset[enKey]);});
  }
}
