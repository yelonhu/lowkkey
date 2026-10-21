/**
 * The achievement catalog. The name is the fun: a story from European history (lifting is a
 * Western habit), a luxury house's origin, a gym-floor joke, or a Chinese line turned on itself.
 * `how` states the condition once; `lore` is the one-line story behind the name.
 * Every medal is derived from saved facts; nothing here is awarded by hand.
 */
export type Achievement = {
  id: string;
  name: string;
  how: string;
  lore: string;
  motif: string;
  unit?: string;
  group: 'start' | 'plates' | 'body' | 'pull' | 'progress' | 'rhythm' | 'letters' | 'weight' | 'notes' | 'theme';
};

export const ACHIEVEMENTS: Achievement[] = [
  // 开始
  {
    id: 'first_session',
    name: '我来，我练，我记',
    how: '记下第一次训练',
    lore: '凯撒说「我来，我见，我征服」。你来，你练，AI 记。',
    motif: '1',
    group: 'start',
  },
  {
    id: 'first_plan',
    name: '从马具开始',
    how: '第一份训练计划',
    lore: '爱马仕 1837 年从一间马具作坊起家。好东西都从一副合身的鞍具开始。',
    motif: '鞍',
    group: 'start',
  },
  {
    id: 'sessions_10',
    name: '泵感来了',
    how: '第十次训练',
    lore: '施瓦辛格说，泵感是世界上最好的感觉。',
    motif: '10',
    group: 'start',
  },
  { id: 'sessions_50', name: '知天命', how: '第五十次训练', lore: '五十而知天命。', motif: '50', group: 'start' },
  {
    id: 'sessions_100',
    name: '百年老店',
    how: '第一百次训练',
    lore: '爱马仕 1837，卡地亚 1847。练满一百次，你也是老字号了。',
    motif: '100',
    group: 'start',
  },
  // 片
  {
    id: 'plate_1',
    name: '一片冰心',
    how: '卧推或深蹲第一次挂上一片，135 lb',
    lore: '一片冰心在玉壶。杠铃两边各一片，心里也清明。',
    motif: '135',
    unit: 'lb',
    group: 'plates',
  },
  {
    id: 'plate_2',
    name: '片甲不留',
    how: '两片，225 lb',
    lore: '成语反着用：片，都留在杠上。',
    motif: '225',
    unit: 'lb',
    group: 'plates',
  },
  {
    id: 'plate_3',
    name: '三百壮士',
    how: '三片，315 lb',
    lore: '温泉关的三百个斯巴达人。三片，三百多磅。',
    motif: '315',
    unit: 'lb',
    group: 'plates',
  },
  // 身体
  {
    id: 'bench_bodyweight',
    name: '轻松举，宝贝',
    how: '卧推推起自己的体重',
    lore: '罗尼·库尔曼上杠前必喊：Light weight, baby。',
    motif: '身',
    group: 'body',
  },
  {
    id: 'squat_1_5',
    name: '给我一个支点',
    how: '深蹲一倍半体重',
    lore: '阿基米德说给他一个支点就能撬起地球。你先撬起一倍半的自己。',
    motif: '点',
    group: 'body',
  },
  {
    id: 'press_atlas',
    name: '阿特拉斯的肩',
    how: '坐姿哑铃推肩，单只 50 lb',
    lore: '阿特拉斯把天扛在肩上。你扛的是一对五十磅。',
    motif: '肩',
    group: 'body',
  },
  // 引体
  {
    id: 'pullup_free',
    name: '牛顿的苹果',
    how: '不借辅助，严格完成八次引体',
    lore: '万有引力管得了苹果，管不了你。',
    motif: '引',
    group: 'pull',
  },
  {
    id: 'assist_halved',
    name: '自食其力',
    how: '引体的辅助减到最初的一半',
    lore: '少借一半的力，多用一半的自己。',
    motif: '减',
    group: 'pull',
  },
  {
    id: 'pullup_loaded',
    name: '多带一件行李',
    how: '负重引体，严格八次',
    lore: '路易·威登是做行李箱起家的。负重，就是带着行李上路。',
    motif: '负',
    group: 'pull',
  },
  // 进步
  {
    id: 'first_pr',
    name: '米洛的牛犊',
    how: '任一主项的第一个 e1RM 纪录',
    lore: '克罗顿的米洛每天抱着小牛走，牛长成公牛，他照样举得起。渐进超负荷的起点。',
    motif: '犊',
    group: 'progress',
  },
  {
    id: 'unstuck',
    name: '翻过阿尔卑斯',
    how: '停滞三次之后再创纪录',
    lore: '汉尼拔带着大象翻过了阿尔卑斯。停滞不是终点，是山。',
    motif: '越',
    group: 'progress',
  },
  // 节律
  {
    id: 'week_full',
    name: '没跳过腿日',
    how: '一周计划里的每一天都练了',
    lore: '健身房第一诫：Never skip leg day。',
    motif: '全',
    group: 'rhythm',
  },
  {
    id: 'streak_4',
    name: '再来一回合',
    how: '连续四周一次没落',
    lore: '《文明》玩家的深夜名言：就再来一回合。',
    motif: '4',
    group: 'rhythm',
  },
  {
    id: 'streak_12',
    name: '十二试炼',
    how: '连续十二周',
    lore: '赫拉克勒斯有十二项试炼。你的是十二个星期。',
    motif: '12',
    group: 'rhythm',
  },
  {
    id: 'streak_52',
    name: '罗马不是一天建成的',
    how: '连续一年',
    lore: '但确实是一天一天建成的。',
    motif: '52',
    group: 'rhythm',
  },
  {
    id: 'rest_kept',
    name: '让他们吃蛋糕吧',
    how: '计划里的休息日真的休息了',
    lore: '玛丽·安托瓦内特大概没说过这句话。但休息日，你可以。',
    motif: '逸',
    group: 'rhythm',
  },
  // 信
  {
    id: 'letter_1',
    name: '见字如面',
    how: '收到第一封周信',
    lore: '古人写信的开头。AI 的信，也当面读。',
    motif: '信',
    group: 'letters',
  },
  {
    id: 'letter_10',
    name: '家书抵万金',
    how: '第十封周信',
    lore: '杜甫：烽火连三月，家书抵万金。',
    motif: '金',
    group: 'letters',
  },
  // 体重
  {
    id: 'weigh_1',
    name: '阿基米德的浴缸',
    how: '第一次称重',
    lore: '他在浴缸里喊了尤里卡。你站上秤。',
    motif: '称',
    group: 'weight',
  },
  {
    id: 'trend',
    name: '秤不说谎',
    how: '十四天里称够八次，趋势成立',
    lore: '亨利·罗林斯说，铁不会骗你。秤也不会。',
    motif: '数',
    group: 'weight',
  },
  // 随手记
  {
    id: 'note_1',
    name: '蒙田的随笔',
    how: '写下第一篇随手记',
    lore: '蒙田发明了随笔，法语里的意思是「尝试」。随手记也是。',
    motif: '记',
    group: 'notes',
  },
  {
    id: 'notes_30',
    name: '追忆似水年华',
    how: '三十天写过随手记',
    lore: '普鲁斯特用七卷书追忆。你用三十天。',
    motif: '笔',
    group: 'notes',
  },
  // 主题
  {
    id: 'gold_week',
    name: '黄金年代',
    how: '第一个鎏金的星期',
    lore: '威尼斯海滩的黄金年代，Gold’s Gym 的鎏金岁月。这周是你的。',
    motif: '鎏',
    group: 'theme',
  },
];
