// 零依赖迷你断言：ok / eq / throws / sec / done
// 通过的断言不打印，只打印失败和分节标题；done() 的最后一行「N passed, M failed」给 test.sh 解析
// 用法：import { ok, eq, sec, done } from "./mini.mjs"; await sec("分节", async () => { ok(x, "说明") }); done();

let pass = 0;
let fail = 0;

export function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
}

// 用 JSON 比较，对象 / 数组也能直接比；失败时把两边都打出来
export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(a === b, `${msg}\n      实际：${a}\n      期望：${b}`);
}

// fn 必须抛错；给了 pattern 就再检查错误消息
export function throws(fn, pattern, msg) {
  try {
    fn();
  } catch (e) {
    if (pattern && !pattern.test(String(e?.message ?? e))) {
      return ok(false, `${msg}（抛了，但消息不对：${e?.message ?? e}）`);
    }
    return ok(true, msg);
  }
  ok(false, `${msg}（没有抛错）`);
}

// 分节：打印标题；给了 fn 就执行它，里面抛出的异常记 1 个失败而不是让整个文件崩掉
export async function sec(name, fn) {
  console.log(`— ${name}`);
  if (!fn) return;
  try {
    await fn();
  } catch (e) {
    fail++;
    console.log(`  ✗ 本节抛出异常：${e?.stack ?? e}`);
  }
}

// macOS 上 stdout 接管道时是异步写：等最后一行真正写出去再 exit，否则 `| tail -1` 可能拿不到计数行
export function done() {
  process.stdout.write(`${pass} passed, ${fail} failed\n`, () => process.exit(fail ? 1 : 0));
}
