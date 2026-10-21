import { STRENGTH_EXERCISES } from '@lowkkey/protocol/catalog';
import type { Facts, Medal, TrainingSession, TrainingSet } from '@lowkkey/protocol';
import { addDays, monday, toLb, weekday } from './util.ts';
import { bodyweightOn, strictReps, weightRate } from './verifiers.ts';
import { planOn, scoredSessions, strengthSeries } from './derive.ts';

/**
 * The achievement catalog. The name is the fun: a story from European history (lifting is a
 * Western habit), a luxury house's origin, a gym-floor joke, or a Chinese line turned on itself.
 * `how` states the condition once; `lore` is the one-line story behind the name.
 */
export type Achievement = {
  id: string;
  name: string;
  how: string;
  lore: string;
  motif: string;
  unit?: string;
};

export const ACHIEVEMENTS: Achievement[] = [
  // 开始
  {
    id: 'first_session',
    name: '我来，我练，我记',
    how: '记下第一次训练',
    lore: '凯撒说「我来，我见，我征服」。你来，你练，AI 记。',
    motif: '1',
  },
  {
    id: 'first_plan',
    name: '从马具开始',
    how: '第一份训练计划',
    lore: '爱马仕 1837 年从一间马具作坊起家。好东西都从一副合身的鞍具开始。',
    motif: '鞍',
  },
  { id: 'sessions_10', name: '泵感来了', how: '第十次训练', lore: '施瓦辛格说，泵感是世界上最好的感觉。', motif: '10' },
  { id: 'sessions_50', name: '知天命', how: '第五十次训练', lore: '五十而知天命。', motif: '50' },
  {
    id: 'sessions_100',
    name: '百年老店',
    how: '第一百次训练',
    lore: '爱马仕 1837，卡地亚 1847。练满一百次，你也是老字号了。',
    motif: '100',
  },
  // 片
  {
    id: 'plate_1',
    name: '一片冰心',
    how: '卧推或深蹲第一次挂上一片，135 lb',
    lore: '一片冰心在玉壶。杠铃两边各一片，心里也清明。',
    motif: '135',
    unit: 'lb',
  },
  {
    id: 'plate_2',
    name: '片甲不留',
    how: '两片，225 lb',
    lore: '成语反着用：片，都留在杠上。',
    motif: '225',
    unit: 'lb',
  },
  {
    id: 'plate_3',
    name: '三百壮士',
    how: '三片，315 lb',
    lore: '温泉关的三百个斯巴达人。三片，三百多磅。',
    motif: '315',
    unit: 'lb',
  },
  // 身体
  {
    id: 'bench_bodyweight',
    name: '轻松举，宝贝',
    how: '卧推推起自己的体重',
    lore: '罗尼·库尔曼上杠前必喊：Light weight, baby。',
    motif: '身',
  },
  {
    id: 'squat_1_5',
    name: '给我一个支点',
    how: '深蹲一倍半体重',
    lore: '阿基米德说给他一个支点就能撬起地球。你先撬起一倍半的自己。',
    motif: '点',
  },
  {
    id: 'press_atlas',
    name: '阿特拉斯的肩',
    how: '坐姿哑铃推肩，单只 50 lb',
    lore: '阿特拉斯把天扛在肩上。你扛的是一对五十磅。',
    motif: '肩',
  },
  // 引体
  {
    id: 'pullup_free',
    name: '牛顿的苹果',
    how: '不借辅助，严格完成八次引体',
    lore: '万有引力管得了苹果，管不了你。',
    motif: '引',
  },
  {
    id: 'assist_halved',
    name: '自食其力',
    how: '引体的辅助减到最初的一半',
    lore: '少借一半的力，多用一半的自己。',
    motif: '减',
  },
  {
    id: 'pullup_loaded',
    name: '多带一件行李',
    how: '负重引体，严格八次',
    lore: '路易·威登是做行李箱起家的。负重，就是带着行李上路。',
    motif: '负',
  },
  // 进步
  {
    id: 'first_pr',
    name: '米洛的牛犊',
    how: '任一主项的第一个 e1RM 纪录',
    lore: '克罗顿的米洛每天抱着小牛走，牛长成公牛，他照样举得起。渐进超负荷的起点。',
    motif: '犊',
  },
  {
    id: 'unstuck',
    name: '翻过阿尔卑斯',
    how: '停滞三次之后再创纪录',
    lore: '汉尼拔带着大象翻过了阿尔卑斯。停滞不是终点，是山。',
    motif: '越',
  },
  // 节律
  {
    id: 'week_full',
    name: '没跳过腿日',
    how: '一周计划里的每一天都练了',
    lore: '健身房第一诫：Never skip leg day。',
    motif: '全',
  },
  {
    id: 'streak_4',
    name: '再来一回合',
    how: '连续四周一次没落',
    lore: '《文明》玩家的深夜名言：就再来一回合。',
    motif: '4',
  },
  {
    id: 'streak_12',
    name: '十二试炼',
    how: '连续十二周',
    lore: '赫拉克勒斯有十二项试炼。你的是十二个星期。',
    motif: '12',
  },
  { id: 'streak_52', name: '罗马不是一天建成的', how: '连续一年', lore: '但确实是一天一天建成的。', motif: '52' },
  {
    id: 'rest_kept',
    name: '让他们吃蛋糕吧',
    how: '一整周只在计划的日子练，休息日真的休息了',
    lore: '玛丽·安托瓦内特大概没说过这句话。但休息日，你可以。',
    motif: '逸',
  },
  // 信
  { id: 'letter_1', name: '见字如面', how: '收到第一封周信', lore: '古人写信的开头。AI 的信，也当面读。', motif: '信' },
  { id: 'letter_10', name: '家书抵万金', how: '第十封周信', lore: '杜甫：烽火连三月，家书抵万金。', motif: '金' },
  // 体重
  { id: 'weigh_1', name: '阿基米德的浴缸', how: '第一次称重', lore: '他在浴缸里喊了尤里卡。你站上秤。', motif: '称' },
  {
    id: 'trend',
    name: '秤不说谎',
    how: '十四天里称够八次，趋势成立',
    lore: '亨利·罗林斯说，铁不会骗你。秤也不会。',
    motif: '数',
  },
  // 随手记
  {
    id: 'note_1',
    name: '蒙田的随笔',
    how: '写下第一篇随手记',
    lore: '蒙田发明了随笔，法语里的意思是「尝试」。随手记也是。',
    motif: '记',
  },
  {
    id: 'notes_30',
    name: '追忆似水年华',
    how: '三十天写过随手记',
    lore: '普鲁斯特用七卷书追忆。你用三十天。',
    motif: '笔',
  },
  // 主题
  {
    id: 'gold_week',
    name: '黄金年代',
    how: '第一个鎏金的星期',
    lore: '威尼斯海滩的黄金年代，Gold’s Gym 的鎏金岁月。这周是你的。',
    motif: '鎏',
  },
];

export type NotesMilestones = { count: number; first_date?: string | null; date_30?: string | null };

const main = (ex: string) => STRENGTH_EXERCISES.some(id => id === ex);
const working = (session: TrainingSession) =>
  session.sets.filter(x => x.role !== 'warmup' && x.role !== 'drop' && !x.partial && strictReps(x) >= 1);
const pullups = (session: TrainingSession, kind: TrainingSet['kind']) =>
  session.sets.filter(
    x => x.ex === 'pull_up' && x.kind === kind && x.role !== 'warmup' && !x.partial && strictReps(x) >= 8,
  );

/**
 * Every medal, earned or not, derived from saved facts alone. The date is the day the
 * condition was first met; null means still waiting. Nothing here is awarded by hand.
 */
export function medals(facts: Facts, today: string, notes?: NotesMilestones): Medal[] {
  const sessions = [...facts.sessions].filter(s => s.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const weights = [...facts.weights].filter(w => w.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const earned: Record<string, string | null> = {};
  const first = (predicate: (session: TrainingSession) => boolean) => sessions.find(predicate)?.date ?? null;
  const loadAtLeast = (exercises: string[], lb: number) =>
    first(s => working(s).some(x => exercises.includes(x.ex) && x.kind === 'external' && toLb(x.load, x.unit) >= lb));
  const overBodyweight = (ex: string, factor: number) =>
    first(s => {
      const bw = bodyweightOn(facts.weights, s.date)?.lb;
      return !!bw && working(s).some(x => x.ex === ex && x.kind === 'external' && toLb(x.load, x.unit) >= bw * factor);
    });
  const nth = (n: number) => sessions[n - 1]?.date ?? null;

  earned.first_session = nth(1);
  earned.sessions_10 = nth(10);
  earned.sessions_50 = nth(50);
  earned.sessions_100 = nth(100);
  const plans = [...facts.plan_history]
    .filter(h => h.effective_date <= today && h.plans.some(p => p.items.length))
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  earned.first_plan = plans[0]?.effective_date ?? (facts.plans.some(p => p.items.length) ? today : null);

  earned.plate_1 = loadAtLeast(['bench_press', 'back_squat'], 135);
  earned.plate_2 = loadAtLeast(['bench_press', 'back_squat'], 225);
  earned.plate_3 = loadAtLeast(['bench_press', 'back_squat'], 315);
  earned.bench_bodyweight = overBodyweight('bench_press', 1);
  earned.squat_1_5 = overBodyweight('back_squat', 1.5);
  earned.press_atlas = loadAtLeast(['db_shoulder_press'], 50);

  earned.pullup_free = first(s => pullups(s, 'bodyweight').length > 0);
  earned.pullup_loaded = first(s => pullups(s, 'bodyweight').some(x => x.load > 0));
  const firstAssist = sessions
    .flatMap(s => s.sets.filter(x => x.ex === 'pull_up' && x.kind === 'assist' && x.role !== 'warmup'))
    .map(x => toLb(x.load, x.unit))[0];
  earned.assist_halved =
    firstAssist == null ? null : first(s => pullups(s, 'assist').some(x => toLb(x.load, x.unit) <= firstAssist / 2));

  const scored = scoredSessions(facts).filter(s => s.date <= today);
  earned.first_pr = scored.find(s => s.prs.some(main))?.date ?? null;
  let unstuck: string | null = null;
  for (const line of strengthSeries(facts)) {
    let high: number | null = null,
      stall = 0;
    for (const point of line.points.filter(p => p.date <= today)) {
      if (high != null && point.e1rm > high + 1e-6) {
        if (stall >= 3 && (unstuck == null || point.date < unstuck)) unstuck = point.date;
        stall = 0;
      } else if (high != null) stall++;
      high = Math.max(high ?? 0, point.e1rm);
    }
  }
  earned.unstuck = unstuck;

  // Weeks are judged only once they are over, against the plan that was in force at the time.
  const streakTargets: Record<number, string> = { 4: 'streak_4', 12: 'streak_12', 52: 'streak_52' };
  earned.week_full = earned.rest_kept = earned.streak_4 = earned.streak_12 = earned.streak_52 = null;
  const earliest = plans[0]?.effective_date;
  if (earliest) {
    let streak = 0;
    for (let week = monday(earliest); addDays(week, 6) < today; week = addDays(week, 7)) {
      let due = 0,
        missed = false,
        extra = false;
      for (let i = 0; i < 7; i++) {
        const date = addDays(week, i),
          plan = planOn(facts, date).find(p => p.weekday === weekday(date) && p.items.length),
          trained = facts.sessions.some(s => s.date === date && (!plan || s.title === plan.title));
        if (plan) {
          due++;
          if (!trained) missed = true;
        } else if (facts.sessions.some(s => s.date === date)) extra = true;
      }
      const complete = due > 0 && !missed,
        end = addDays(week, 6);
      streak = complete ? streak + 1 : 0;
      if (complete && !earned.week_full) earned.week_full = end;
      if (complete && !extra && !earned.rest_kept) earned.rest_kept = end;
      const target = streakTargets[streak];
      if (target && !earned[target]) earned[target] = end;
    }
  }

  const letters = [...facts.curations]
    .filter(c => c.recap?.letter?.length && c.week <= monday(today))
    .sort((a, b) => a.week.localeCompare(b.week));
  const arrived = (c: { week: string }) => (addDays(c.week, 6) < today ? addDays(c.week, 6) : today);
  earned.letter_1 = letters[0] ? arrived(letters[0]) : null;
  earned.letter_10 = letters[9] ? arrived(letters[9]) : null;

  earned.weigh_1 = weights[0]?.date ?? null;
  earned.trend = weights.find(w => weightRate(weights, w.date) != null)?.date ?? null;

  earned.note_1 = notes?.first_date ?? null;
  earned.notes_30 = notes && notes.count >= 30 ? (notes.date_30 ?? null) : null;

  earned.gold_week =
    [...facts.curations]
      .filter(c => c.theme?.id === 'gold' && c.week <= monday(today))
      .sort((a, b) => a.week.localeCompare(b.week))[0]?.week ?? null;

  return ACHIEVEMENTS.map(a => ({
    id: a.id,
    name: a.name,
    how: a.how,
    lore: a.lore,
    motif: a.motif,
    ...(a.unit ? { unit: a.unit } : {}),
    date: earned[a.id] ?? null,
  }));
}

/** Medals whose date falls in the current week, for the board and the letter. */
export function medalsThisWeek(all: Medal[], today: string) {
  const start = monday(today);
  return all.filter(m => m.date && m.date >= start && m.date <= today);
}
