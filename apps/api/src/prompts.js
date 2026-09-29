// prompts.js —— 解析 prompts.md、把场景卡填进提问模板。提示词本身只在 ../prompts.md 里。
// 用法：const P = parsePrompts(mdText); renderPersona(P, 'commuter', card, ['r1', 'stay', 'r2']) → { system, user }

const DIR = { N: 'north', S: 'south', E: 'east', W: 'west' };
const NEEDED = ['system', 'user', 'group.commuter', 'group.local', 'group.tourist', 'group.delivery', 'advisor.system', 'advisor.user'];

export function parsePrompts(md) {
  if (typeof md !== 'string' || !md) throw new Error('prompts.md is empty');
  const v = /^prompt_v:\s*(\S+)\s*$/m.exec(md);
  if (!v) throw new Error('prompts.md has no "prompt_v:" line');
  const sections = {};
  const re = /^##[ \t]+([A-Za-z0-9_.-]+)[ \t]*$([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(md))) {
    const block = /```text\n([\s\S]*?)\n```/.exec(m[2]);
    if (block) sections[m[1]] = block[1].trim();
  }
  for (const k of NEEDED) if (!sections[k]) throw new Error(`prompts.md is missing section "## ${k}"`);
  return { version: v[1], ...sections };
}

export function fill(tpl, vars) {
  const out = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`prompt placeholder {{${k}}} has no value`);
    return String(vars[k]);
  });
  return out;
}

function signLine(s) {
  const where = `${Math.round(s.m)} m before the works`;
  if (s.kind === 'vms') {
    const frames = (s.frames || []).map(f => `<sign>${f.join(' / ')}</sign>`);
    const read = Number.isFinite(s.read_s) ? `, about ${Math.round(s.read_s)} s to read` : '';
    const fr = frames.length > 1 ? `${frames.length} alternating frames: ${frames.join(' then ')}` : frames[0] || '<sign></sign>';
    return `- ${where}: electronic message sign${read}: ${fr}`;
  }
  const what = s.kind === 'arrow' ? 'arrow board' : 'static sign';
  return `- ${where}: ${what}: <sign>${s.text ?? ''}</sign>`;
}

// order = 路线 id 的顺序（每次提问打乱，防选项位置偏差）；用路名，不用 A/B
export function renderPersona(P, type, card, order) {
  const byId = new Map((card.routes || []).map(r => [r.id, r]));
  const ids = order && order.length ? order : [...byId.keys()];
  const signs = [...(card.signs || [])].sort((a, b) => b.m - a.m);
  const routes = ids.map(id => {
    const r = byId.get(id);
    const tag = r.id === 'stay' ? ' (the usual route, through the roadworks)' : '';
    const truck = r.truck === false ? ' (closed to trucks)' : '';
    return `- ${r.name}${tag}${truck}: usually ${Math.round(r.usual_min)} min`;
  });
  const q = Number(card.queue_m) || 0;
  const user = fill(P.user, {
    group: P['group.' + type],
    dir: DIR[card.trip?.dir] || 'ahead',
    on: card.trip?.on ?? '',
    to: card.trip?.to ?? '',
    kmh: Math.round(card.trip?.kmh ?? 40),
    signs: signs.length ? signs.map(signLine).join('\n') : '- (no signs)',
    routes: routes.join('\n'),
    queue: q > 0 ? `You can see a queue of about ${Math.round(q)} m ahead.` : 'No queue is visible yet.',
  });
  return { system: P.system, user };
}

export function renderAdvisor(P, summary) {
  return { system: P['advisor.system'], user: fill(P['advisor.user'], { summary: JSON.stringify(summary, null, 1) }) };
}

// 大模型要回的 JSON（结构化输出用）
export const PERSONA_SCHEMA = {
  type: 'object',
  properties: {
    notice: { type: 'number' },
    understand: { type: 'number' },
    routes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { route: { type: 'string' }, share: { type: 'number' } },
        required: ['route', 'share'],
        additionalProperties: false,
      },
    },
    why: { type: 'string' },
  },
  required: ['notice', 'understand', 'routes', 'why'],
  additionalProperties: false,
};

export const ADVISOR_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['text', 'move', 'shift'] },
          worksite: { type: 'string' },
          equipment: { type: ['string', 'null'] },
          frames: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          at_m: { type: 'number' },
          days: { type: 'integer' },
          why: { type: 'string' },
        },
        required: ['kind', 'worksite', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
};
