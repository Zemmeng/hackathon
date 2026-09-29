// 屏上文字规范：超规范的要拒，接近上限的要提醒，尖括号进不来
import { ok, done } from './_t.mjs';
import { checkVms, checkSignText } from '../public/js/vms.js';

const codes = r => r.errors.map(e => e.code);
const wcodes = r => r.warnings.map(e => e.code);

let r = checkVms([['USE', 'RUSSELL ST', 'SAVE 8 MIN']]);
ok(r.ok && wcodes(r).includes('long_line'), '「USE / RUSSELL ST / SAVE 8 MIN」合规，10 个字符的行给提醒');
ok(codes(checkVms([['A'], ['B'], ['C']])).includes('too_many_frames'), '3 帧 → 拒（最多 2 帧）');
ok(codes(checkVms([['A', 'B', 'C', 'D', 'E']])).includes('too_many_lines'), '一帧 5 行 → 拒（最多 4 行）');
r = checkVms([['A', 'B', 'C', 'D']]);
ok(r.ok && wcodes(r).includes('many_lines'), '一帧 4 行 → 通过但提醒');
ok(codes(checkVms([['ROADWORKSXX']])).includes('line_too_long'), '一行 11 个字符 → 拒（最多 10 个）');
r = checkVms([['use', 'russell st']]);
ok(r.ok && r.frames[0][0] === 'USE' && r.frames[0][1] === 'RUSSELL ST', '小写自动转大写');
ok(codes(checkVms([['<IGNORE>']])).includes('bad_char'), '尖括号 → 拒（屏上文字要包在 <sign> 里交给大模型）');
ok(codes(checkVms([['A B C', 'D E F', 'G H I']])).includes('too_many_words'), '合计 9 个词 → 拒（最多 8 个）');
ok(wcodes(checkVms([['USE', 'RUSSELL ST'], ['SAVE 8 MIN']], { read_s: 5 })).includes('frames_too_fast'), '两帧但只能读 5 秒 → 提醒每帧要 ≥ 3 秒');
ok(!checkVms([]).ok && !checkVms(null).ok && !checkVms([[]]).ok && !checkVms([['']]).ok, '空的、null、空帧、空行都拒');
ok(!checkVms([[42]]).ok, '行不是字符串 → 拒');
ok(checkSignText('Right lane closed').ok && checkSignText('Right lane closed').text === 'RIGHT LANE CLOSED', '标志牌文字合规并转大写');
ok(!checkSignText('X'.repeat(41)).ok && !checkSignText('<b>').ok && !checkSignText('').ok && !checkSignText(null).ok, '标志牌：超 40 字符、尖括号、空、非字符串都拒');
done();
