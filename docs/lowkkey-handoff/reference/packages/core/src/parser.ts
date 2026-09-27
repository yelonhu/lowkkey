import type { DateOrigin, Exercise, LocalDate, Unit, WeighInCondition } from '@lowkkey/protocol';
import { addDays, convert } from './util.ts';

/**
 * 规则解析器：覆盖大部分日常输入，确定、可测、不猜。
 * 解析不了的片段原样返回 unparsed，交给模型（服务端）或提示用户。
 * 有歧义时返回 Ambiguity，由闸门 G1 转成「需要确认」——规则解析器从不替用户选。
 */

export type ParsedWeight = { type: 'weight'; kg: number; raw: { value: number; unit: Unit }; condition: WeighInCondition; span: string };
export type ParsedSet = { type: 'set'; exerciseId: string; load: number; unit: Unit; reps: number; rir: number | null; span: string };
export type ParsedWaist = { type: 'waist'; cm: number; span: string };
export type ParsedItem = ParsedWeight | ParsedSet | ParsedWaist;

export type Ambiguity = {
  field: 'rir';
  value: number;
  question: string;
  context: string;
  highlight: string;
  options: { id: string; label: string; hint: string; targets: number[] }[];
};

export type ParseResult = {
  date: LocalDate;
  dateOrigin: DateOrigin;
  items: ParsedItem[];
  ambiguities: Ambiguity[];
  unparsed: string[];
};

export type ParseContext = {
  today: LocalDate;
  exercises: Exercise[];
  /** 训练中：没有写动作名的组记到当前动作。 */
  currentExerciseId?: string;
};

const UNIT_RE = '(lbs?|磅|kg|公斤)';
const unitOf = (u: string | undefined): Unit | null => (!u ? null : /^(kg|公斤)$/i.test(u) ? 'kg' : 'lb');
const num = (s: string) => Number.parseFloat(s);

function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[＊✕✖]/g, '*')
    .replace(/[．]/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDate(text: string, today: LocalDate): { date: LocalDate; origin: DateOrigin; rest: string } {
  const rel: [RegExp, number][] = [
    [/前天/, -2],
    [/昨天|昨日|昨晚/, -1],
    [/今天|今日|今早|今晨|今晚/, 0],
  ];
  const md = text.match(/(\d{1,2})\s*(?:月|\/)\s*(\d{1,2})\s*(?:日|号)?/);
  if (md) {
    const y = Number(today.slice(0, 4));
    let d = `${y}-${md[1]!.padStart(2, '0')}-${md[2]!.padStart(2, '0')}`;
    if (d > addDays(today, 1)) d = `${y - 1}${d.slice(4)}`;
    return { date: d, origin: 'explicit', rest: text.replace(md[0], ' ') };
  }
  for (const [re, off] of rel) {
    if (re.test(text)) return { date: addDays(today, off), origin: off === 0 ? 'device' : 'explicit', rest: text };
  }
  return { date: today, origin: 'device', rest: text };
}

function findExercise(clause: string, exercises: Exercise[]): { ex: Exercise; name: string } | null {
  const lc = clause.toLowerCase();
  let best: { ex: Exercise; name: string; at: number } | null = null;
  for (const ex of exercises) {
    for (const name of [ex.name, ...ex.aliases]) {
      if (!name) continue;
      const at = lc.indexOf(name.toLowerCase());
      if (at < 0) continue;
      if (!best || at < best.at || (at === best.at && name.length > best.name.length)) best = { ex, name, at };
    }
  }
  return best ? { ex: best.ex, name: best.name } : null;
}

const FILLER = /(今天|今日|今早|今晨|昨天|前天|做了|推了|拉了|蹲了|练了|组|个|次|下|了|的|和|还有|然后|接着|单边|每边|左右|大概|差不多|感觉|rir|lb|lbs|kg|磅|公斤|[+＋、:：\-~到*×x\s\d.])/gi;

export function parse(input: string, ctx: ParseContext): ParseResult {
  const text = normalize(input);
  const { date, origin, rest } = extractDate(text, ctx.today);
  const items: ParsedItem[] = [];
  const unparsed: string[] = [];
  const refs: { load: number; unit: Unit | null; rir: number; span: string }[] = [];
  const condition: WeighInCondition = /大号|排便|拉完|上完厕所|厕所后/.test(text) ? 'post_bm' : /空腹|起床|晨起|排尿后/.test(text) ? 'fasted' : 'unspecified';

  let carryEx: Exercise | null = ctx.currentExerciseId ? ctx.exercises.find((e) => e.id === ctx.currentExerciseId) ?? null : null;

  for (const rawClause of rest.split(/[，,。；;\n]+/)) {
    let clause = rawClause.trim();
    if (!clause) continue;
    let consumed = clause;

    // 「125那组rir0」：对同一句话里已解析组的引用
    const refRe = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT_RE}?\\s*(?:的)?那[一]?组\\s*(?:的)?\\s*rir\\s*(\\d)`, 'gi');
    for (const m of clause.matchAll(refRe)) {
      refs.push({ load: num(m[1]!), unit: unitOf(m[2]), rir: Number(m[3]), span: m[0].replace(/\s+/g, '') });
      consumed = consumed.replace(m[0], ' ');
    }
    clause = consumed;

    // 腰围
    const waist = clause.match(/腰围\s*(\d{2,3}(?:\.\d+)?)\s*(?:cm|厘米)?/i);
    if (waist) {
      items.push({ type: 'waist', cm: num(waist[1]!), span: waist[0] });
      consumed = consumed.replace(waist[0], ' ');
    }

    // 组
    const found = findExercise(clause, ctx.exercises);
    const setRe = new RegExp(
      `(\\d+(?:\\.\\d+)?)\\s*${UNIT_RE}?\\s*(?:单边|每边)?\\s*(?:[*×xX]\\s*(\\d+)(?:\\s*[*×xX]\\s*(\\d+)\\s*组?)?|(\\d+)\\s*(?:个|次|下))`,
      'gi',
    );
    const matches = [...clause.matchAll(setRe)].filter((m) => m[3] || m[5]);
    if (matches.length > 0) {
      const ex = found?.ex ?? carryEx;
      if (!ex) {
        unparsed.push(rawClause.trim());
        continue;
      }
      carryEx = ex;
      let lastUnit: Unit | null = null;
      matches.forEach((m, i) => {
        const explicit = unitOf(m[2]);
        const unit = explicit ?? lastUnit ?? ex.unit;
        lastUnit = unit;
        const reps = Number(m[3] ?? m[5]);
        const times = m[4] ? Math.min(Number(m[4]), 10) : 1;
        const tailEnd = i + 1 < matches.length ? matches[i + 1]!.index : clause.length;
        const tail = clause.slice(m.index! + m[0].length, tailEnd);
        const rirM = tail.match(/rir\s*(\d)(?:\s*[-~到]\s*\d)?/i);
        for (let k = 0; k < times; k++) {
          items.push({ type: 'set', exerciseId: ex.id, load: num(m[1]!), unit, reps, rir: rirM ? Number(rirM[1]) : null, span: m[0].trim() });
        }
        consumed = consumed.replace(m[0], ' ');
        if (rirM) consumed = consumed.replace(rirM[0], ' ');
      });
      if (found) consumed = consumed.replace(new RegExp(found.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
    } else {
      // 体重：有关键词，或一个像体重的数字
      const kw = /(体重|称重|晨重|称了|早上|weigh|bw)/i.test(clause);
      const w = clause.match(new RegExp(`(\\d{2,3}(?:\\.\\d+)?)\\s*${UNIT_RE}?`, 'i'));
      if (w && (kw || unitOf(w[2]))) {
        const value = num(w[1]!);
        const unit: Unit = unitOf(w[2]) ?? (value >= 100 ? 'lb' : 'kg');
        const kg = convert(value, unit, 'kg');
        if (kg >= 30 && kg <= 250) {
          items.push({ type: 'weight', kg: Math.round(kg * 100) / 100, raw: { value, unit }, condition, span: w[0] });
          consumed = consumed.replace(w[0], ' ').replace(/(体重|称重|晨重|称了|早上|weigh|bw)/i, ' ');
        }
      }
    }

    const leftover = consumed.replace(/大号|排便|拉完|上完厕所|厕所后|空腹|起床|晨起|排尿后|之后|以后|过/g, '').replace(FILLER, '').trim();
    if (leftover.length >= 2) unparsed.push(rawClause.trim());
  }

  // 解析引用
  const ambiguities: Ambiguity[] = [];
  for (const r of refs) {
    const hits = items
      .map((it, i) => ({ it, i }))
      .filter((x): x is { it: ParsedSet; i: number } => x.it.type === 'set' && Math.abs(convert(r.load, r.unit ?? x.it.unit, x.it.unit) - x.it.load) < 0.01);
    if (hits.length === 1) {
      hits[0]!.it.rir = r.rir;
    } else if (hits.length > 1) {
      const order = (idx: number) => {
        const s = items[idx] as ParsedSet;
        return items.slice(0, idx + 1).filter((x) => x.type === 'set' && x.exerciseId === s.exerciseId).length;
      };
      const unit = hits[0]!.it.unit;
      ambiguities.push({
        field: 'rir',
        value: r.rir,
        question: `RIR ${r.rir} 指的是哪一组？`,
        context: `有 ${hits.length} 组 ${r.load} ${unit}。`,
        highlight: r.span,
        options: [
          ...hits.map((h) => ({ id: `s${h.i}`, label: `${h.it.load} × ${h.it.reps}`, hint: `第 ${order(h.i)} 组`, targets: [h.i] })),
          { id: 'all', label: hits.length === 2 ? '两组都是' : '都是', hint: hits.map((h) => `第 ${order(h.i)}`).join('、') + ' 组', targets: hits.map((h) => h.i) },
        ],
      });
    } else {
      unparsed.push(r.span);
    }
  }

  return { date, dateOrigin: origin, items, ambiguities, unparsed };
}
