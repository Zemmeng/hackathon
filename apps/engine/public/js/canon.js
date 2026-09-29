// canon.js —— 键排好序的 JSON（同一个对象不管字段顺序怎么写输出都一样）；引擎里做缓存键用，和 api 的 cardkey.js 同一写法
export function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  return JSON.stringify(x ?? null);
}
