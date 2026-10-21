/**
 * The achievement catalog. Names are the fun: a line of verse, an idiom turned on its head,
 * a pun on the thing itself, a nod to a game. The condition is stated once, plainly, in `how`.
 * Every medal is derived from saved facts; nothing here is awarded by hand.
 */
export type Achievement = {
  id: string;
  name: string;
  how: string;
  motif: string;
  unit?: string;
  group: 'start' | 'plates' | 'body' | 'pull' | 'progress' | 'rhythm' | 'letters' | 'weight' | 'notes' | 'theme';
};

export const ACHIEVEMENTS: Achievement[] = [
  // 开始
  { id: 'first_session', name: '小试牛刀', how: '记下第一次训练', motif: '1', group: 'start' },
  { id: 'sessions_10', name: '渐入佳境', how: '第十次训练', motif: '10', group: 'start' },
  { id: 'sessions_50', name: '知天命', how: '第五十次训练', motif: '50', group: 'start' },
  { id: 'sessions_100', name: '百炼成钢', how: '第一百次训练', motif: '100', group: 'start' },
  // 片
  {
    id: 'plate_1',
    name: '一片冰心',
    how: '卧推或深蹲第一次挂上一片，135 lb',
    motif: '135',
    unit: 'lb',
    group: 'plates',
  },
  { id: 'plate_2', name: '片甲不留', how: '两片，225 lb', motif: '225', unit: 'lb', group: 'plates' },
  { id: 'plate_3', name: '飞入梅花', how: '三片，315 lb。一片两片三四片', motif: '315', unit: 'lb', group: 'plates' },
  // 身体
  { id: 'bench_bodyweight', name: '举重若轻', how: '卧推推起自己的体重', motif: '身', group: 'body' },
  { id: 'squat_1_5', name: '力拔山兮', how: '深蹲一倍半体重', motif: '山', group: 'body' },
  // 引体
  { id: 'pullup_free', name: '万有引力', how: '不借辅助，严格完成八次引体', motif: '引', group: 'pull' },
  { id: 'pullup_loaded', name: '负重前行', how: '负重引体，严格八次', motif: '负', group: 'pull' },
  { id: 'assist_halved', name: '减负', how: '引体的辅助减到最初的一半', motif: '减', group: 'pull' },
  // 进步
  { id: 'first_pr', name: '更上一层楼', how: '任一主项的第一个 e1RM 纪录', motif: '上', group: 'progress' },
  { id: 'unstuck', name: '柳暗花明', how: '停滞三次之后再创纪录', motif: '花', group: 'progress' },
  // 节律
  { id: 'week_full', name: '一个都不能少', how: '一周计划里的每一天都练了', motif: '全', group: 'rhythm' },
  { id: 'streak_4', name: '再来一回合', how: '连续四周一次没落', motif: '4', group: 'rhythm' },
  { id: 'streak_12', name: '风雨无阻', how: '连续十二周', motif: '12', group: 'rhythm' },
  { id: 'streak_52', name: '周而复始', how: '连续一年', motif: '52', group: 'rhythm' },
  { id: 'rest_kept', name: '以逸待劳', how: '计划里的休息日真的休息了', motif: '逸', group: 'rhythm' },
  // 信
  { id: 'letter_1', name: '见字如面', how: '收到第一封周信', motif: '信', group: 'letters' },
  { id: 'letter_10', name: '家书抵万金', how: '第十封周信', motif: '金', group: 'letters' },
  // 体重
  { id: 'weigh_1', name: '称心如意', how: '第一次称重', motif: '称', group: 'weight' },
  { id: 'trend', name: '心中有数', how: '十四天里称够八次，趋势成立', motif: '数', group: 'weight' },
  // 随手记
  { id: 'note_1', name: '有感而发', how: '写下第一篇随手记', motif: '记', group: 'notes' },
  { id: 'notes_30', name: '笔耕不辍', how: '三十天写过随手记', motif: '笔', group: 'notes' },
  // 主题
  { id: 'gold_week', name: '鎏金岁月', how: '第一个鎏金的星期', motif: '鎏', group: 'theme' },
];
