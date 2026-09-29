// T28：raw.links 每条多给 extra_min —— 这一段比「同一小时不施工」多出的车·分钟（可 < 0）。
// 页面画「变慢的路段」要按它筛，不按 v·delay_s/60（delay_s 是和自由流比的）：否则 Flinders / King St 早高峰本来就有的
// 排队，会在每个方案里都被当成施工的涟漪画出来。真路网 + 演示方案（Lonsdale 西行 08:00 封 1 道），读屏走引擎规则，不联网
import { readFileSync, existsSync } from 'node:fs';
import { ok, t, done } from './_t.mjs';
import { connect, PATHS } from '../public/js/backend.js';

const APPS = new URL('../../', import.meta.url); // apps/
const file = p => new URL('.' + p, APPS);
if (!existsSync(file(PATHS.network))) { ok(false, '找不到 apps/roads/public/cbd/network.json'); done(); }
const fakeFetch = async url => (existsSync(file(url)) ? { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file(url), 'utf8')) } : { ok: false, status: 404 });
const noImporter = async url => { throw new Error('404 ' + url); };

await t('raw.links.extra_min（Lonsdale 西行 08:00 封 1 道）', async () => {
  const be = await connect({ fetch: fakeFetch, importer: noImporter });
  const plan = be.demo('lonsdale');
  const s = await be.run(plan);
  const L = s.raw.links, net = be.engine.net, name = id => (net.links.get(id) || {}).name || '';

  ok(L.length > 0 && L.every(l => typeof l.extra_min === 'number' && Number.isFinite(l.extra_min)), `raw.links ${L.length} 条都有数值型的 extra_min`);
  ok(L.every(l => ['id', 'v', 'cap', 'delay_s', 'queue_m'].every(k => k in l)), '原来的字段一个没少（delay_s 别处还在用）');

  const works = new Set(plan.worksites[0].links), w = L.filter(l => works.has(l.id));
  ok(w.length > 0 && w.every(l => l.extra_min > 0), `施工路段本身 extra_min > 0（${w.map(l => l.extra_min).join(', ')} 车·分钟）`);

  // 反向：早高峰本来就排队的 Flinders / King St —— 按自由流比很大，按「同一小时不施工」比几乎没变
  const bg = L.filter(l => /^(Flinders|King) (Street|St)$/i.test(name(l.id)) && (l.v || 0) * (l.delay_s || 0) / 60 >= 60);
  ok(bg.length > 0, `Flinders / King St 有 ${bg.length} 段按「和自由流比」算的延误很大（v·delay_s/60 ≥ 60 车·分钟，最大 ${Math.round(Math.max(0, ...bg.map(l => l.v * l.delay_s / 60)))}）`);
  ok(bg.every(l => l.extra_min < 2), `反向：这些段的 extra_min 都 < 2（最大 ${Math.max(...bg.map(l => l.extra_min))}）—— 不是施工造成的，页面不该画成涟漪`);

  ok(L.some(l => l.extra_min < 0), `有路段 extra_min < 0（车绕走了，最小 ${Math.min(...L.map(l => l.extra_min))}），照实给、不截成 0`);
  const byId = new Map(L.map(l => [l.id, l]));
  ok(s.raw.hot.length > 0 && s.raw.hot.every(h => byId.has(h.id) && Math.abs(byId.get(h.id).extra_min - h.extra_min) <= 0.5),
    `hot（最堵路段）的 extra_min 和 raw.links 的是同一个数（hot 取整，links 留一位小数）`);
});

done();
