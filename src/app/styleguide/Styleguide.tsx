import { useEffect, useRef, useState } from 'react';
import { themeNames } from '../shell/theme.ts';
import { Mark, type MarkVariant } from '../ui/Mark.tsx';
import './styleguide.css';

type Theme = keyof typeof themeNames;
const themes = Object.keys(themeNames) as Theme[];
const displayFont =
  'https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;0,6..96,600;1,6..96,400;1,6..96,500&display=swap';

const milestones = [
  { value: '135', unit: 'lb', caption: '第一片 · 卧推', date: '2026.10.03', glyph: '片' },
  { value: '225', unit: 'lb', caption: '两片 · 深蹲', date: '2026.11.14', glyph: '片' },
  { value: '1.0', unit: '×', caption: '超过体重 · 卧推', date: '2026.12.02', glyph: '身' },
  { value: '徒手', caption: '引体向上 · 八次', date: '2027.01.09', glyph: '手' },
  { value: '4', unit: '周', caption: '连续四周一次没落', date: '2026.10.26', glyph: '周' },
  { value: '100', caption: '第一百次训练', date: '2027.03.18', glyph: '百' },
];

const sleep = [
  { day: '一', bed: 23.4, wake: 7.2, train: true },
  { day: '二', bed: 23.9, wake: 7.0, train: false },
  { day: '三', bed: 0.6, wake: 7.5, train: true },
  { day: '四', bed: 23.2, wake: 6.9, train: false },
  { day: '五', bed: 0.2, wake: 8.1, train: true },
  { day: '六', bed: 1.1, wake: 9.4, train: false, rest: true },
  { day: '日', bed: 23.5, wake: 8.0, train: false, rest: true },
];

function useDisplayFont() {
  useEffect(() => {
    if (document.querySelector(`link[href="${displayFont}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = displayFont;
    document.head.append(link);
  }, []);
}

function Sparkline() {
  const points = [160.2, 160.6, 160.3, 160.9, 161.1, 160.8, 161.4, 161.2, 161.6, 161.3, 161.8];
  const lo = Math.min(...points) - 0.3,
    hi = Math.max(...points) + 0.3;
  const x = (i: number) => (i / (points.length - 1)) * 300,
    y = (v: number) => 34 - ((v - lo) / (hi - lo)) * 30;
  const d = points.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  return (
    <svg className="bd-spark" viewBox="0 0 300 36" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="bd-spark-g" x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'var(--g0)' }} />
          <stop offset="1" style={{ stopColor: 'var(--g2)' }} />
        </linearGradient>
      </defs>
      <path d={d} />
      <circle cx={x(points.length - 1)} cy={y(points.at(-1)!)} r="3" />
    </svg>
  );
}

function WeekRing({ done, planned }: { done: number; planned: number }) {
  const r = 26,
    c = 2 * Math.PI * r;
  return (
    <div className="bd-ring">
      <svg viewBox="0 0 60 60" aria-hidden="true">
        <defs>
          <linearGradient id="bd-ring-g" x1="0" x2="1">
            <stop offset="0" style={{ stopColor: 'var(--g0)' }} />
            <stop offset="1" style={{ stopColor: 'var(--g2)' }} />
          </linearGradient>
        </defs>
        <circle cx="30" cy="30" r={r} className="track" />
        <circle
          cx="30"
          cy="30"
          r={r}
          className="fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, done / planned))}
        />
      </svg>
      <b>
        {done}
        <small> / {planned}</small>
      </b>
    </div>
  );
}

function RhythmBand() {
  const start = 21,
    span = 14,
    W = 520,
    L = 28,
    R = 12,
    rowH = 22;
  const X = (hour: number) => L + (((hour < 12 ? hour + 24 : hour) - start) / span) * (W - L - R);
  return (
    <svg className="sg-rhythm" viewBox={`0 0 ${W} ${sleep.length * rowH + 28}`} role="img" aria-label="一周作息带">
      <defs>
        <linearGradient id="rh-g" x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'var(--g0)' }} />
          <stop offset="1" style={{ stopColor: 'var(--g2)' }} />
        </linearGradient>
      </defs>
      {[22, 0, 2, 4, 6, 8, 10].map(h => (
        <g key={h}>
          <line x1={X(h)} x2={X(h)} y1="14" y2={sleep.length * rowH + 14} className="grid" />
          <text x={X(h)} y="9" textAnchor="middle" className="axis">
            {String(h).padStart(2, '0')}
          </text>
        </g>
      ))}
      {sleep.map((row, i) => {
        const y = 18 + i * rowH;
        return (
          <g key={row.day}>
            <text x="4" y={y + 12} className="day">
              {row.day}
            </text>
            <rect
              x={X(row.bed)}
              y={y + 3}
              width={X(row.wake) - X(row.bed)}
              height="12"
              rx="6"
              className={'band' + (row.rest ? ' rest' : '')}
            />
            {row.train && <circle cx={X(row.wake) + 10} cy={y + 9} r="2.2" className="train" />}
          </g>
        );
      })}
    </svg>
  );
}

function MotionDemo() {
  const paper = useRef<HTMLDivElement>(null);
  const press = useRef<HTMLButtonElement>(null);
  const spring = (el: Element | null, frames: Keyframe[], duration: string, easing: string) => {
    if (!el) return;
    const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(duration));
    el.animate(frames, {
      duration: ms,
      easing: getComputedStyle(document.documentElement).getPropertyValue(easing).trim(),
      fill: 'forwards',
    });
  };
  return (
    <div className="sg-motion">
      <button
        ref={press}
        onPointerDown={() => press.current?.setAttribute('data-pressed', '')}
        onPointerUp={() => press.current?.removeAttribute('data-pressed')}
        onPointerLeave={() => press.current?.removeAttribute('data-pressed')}
      >
        按住我
      </button>
      <button
        onClick={() =>
          spring(
            paper.current,
            [
              { transform: 'translateY(40px)', opacity: 0 },
              { transform: 'translateY(0)', opacity: 1 },
            ],
            '--d-spring',
            '--spring',
          )
        }
      >
        纸升起（gentle）
      </button>
      <button
        onClick={() =>
          spring(
            paper.current,
            [
              { transform: 'translateY(0)', opacity: 1 },
              { transform: 'translateY(40px)', opacity: 0 },
            ],
            '--d-snap',
            '--spring-snap',
          )
        }
      >
        收回（snap）
      </button>
      <div ref={paper} className="sg-paper" aria-hidden="true" />
    </div>
  );
}

export function Styleguide() {
  useDisplayFont();
  const [theme, setTheme] = useState<Theme>((document.documentElement.dataset.theme as Theme) || 'ink');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const [variant, setVariant] = useState<MarkVariant>('ring');
  return (
    <main className="sg">
      <header className="sg-head">
        <h1>
          lowkkey 审美体系<small>v6 草案 · 活样板</small>
        </h1>
        <div className="sg-themes" role="group" aria-label="主题">
          {themes.map(t => (
            <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>
              {themeNames[t]}
            </button>
          ))}
        </div>
      </header>

      <section className="sg-sec">
        <h2>
          原则<span>取法 Cartier 的精确与 Hermès 的工艺，根仍是水墨</span>
        </h2>
        <ul className="sg-principles">
          <li>
            <b>一种签名色</b>每个主题只有一个强调色，一屏最多出现三次：心跳、本周主题、焦点线。其余全是纸与墨。
          </li>
          <li>
            <b>数字是主角</b>大数字用高反差衬线显示，像表盘上的刻度；小数字与表格用 Inter 等宽数字。
          </li>
          <li>
            <b>发丝线</b>三种线：0.5px 发丝、1px 规则线、2px 条。边框是刻出来的，不是画上去的。
          </li>
          <li>
            <b>材质不靠填色</b>墨、鎏金、珍珠母只出现在线、渐变与天光里，不做色块。
          </li>
          <li>
            <b>留白是奢侈</b>一屏少放东西；间距走 4 基阶梯；正文行高 1.85 到 2。
          </li>
          <li>
            <b>一点幽默</b>呼吸的句点、信末的署名、印记的边款。小，不可爱。
          </li>
        </ul>
      </section>

      <section className="sg-sec">
        <h2>
          材质与色<span>当前主题 · {themeNames[theme]} · 深色跟随系统</span>
        </h2>
        <div className="sg-swatches">
          {[
            ['--bg', '纸'],
            ['--surf', '面'],
            ['--ink', '墨'],
            ['--ink2', '次墨'],
            ['--muted', '淡'],
            ['--faint', '极淡'],
            ['--line', '线'],
            ['--acc', '签名色'],
          ].map(([token, name]) => (
            <div className="sg-swatch" key={token}>
              <i style={{ background: `var(${token})` }} />
              <b>{name}</b>
              <span>{token}</span>
            </div>
          ))}
          <div className="sg-swatch">
            <i style={{ background: 'linear-gradient(135deg,var(--g0),var(--g1),var(--g2))' }} />
            <b>材质渐变</b>
            <span>--g0 → --g2</span>
          </div>
          <div className="sg-swatch">
            <i style={{ background: 'var(--wash-bg)' }} />
            <b>声音的底</b>
            <span>--wash-bg</span>
          </div>
        </div>
        <div className="sg-skyline">
          <span>天光 --sky：本周主题铺在页面顶部的一层光</span>
        </div>
      </section>

      <section className="sg-sec">
        <h2>
          字体与数字<span>宋体正文 · Inter 小字与表格 · Bodoni Moda 候选显示数字</span>
        </h2>
        <div className="sg-type">
          <div className="sg-spec">
            <span>现在 · Inter 600 / 40</span>
            <div className="sg-hero-inter">
              161.8<span className="sg-unit">lb</span>
            </div>
          </div>
          <div className="sg-spec">
            <span>候选 · Bodoni Moda 500 / 56</span>
            <div className="sg-hero-bodoni">
              161.8<span className="sg-unit">lb</span>
            </div>
          </div>
          <div className="sg-spec">
            <span>候选 · Bodoni Moda 斜体</span>
            <div className="sg-hero-bodoni-i">
              161.8<span className="sg-unit">lb</span>
            </div>
          </div>
          <div className="sg-spec">
            <span>品牌 · 现在 / 候选</span>
            <div style={{ display: 'flex', gap: 'var(--s7)', alignItems: 'baseline' }}>
              <span className="sg-brand-inter">lowkkey</span>
              <span className="sg-brand-bodoni">lowkkey</span>
            </div>
          </div>
          <div className="sg-spec">
            <span>信的标题 · 宋体 600 / 28</span>
            <div className="sg-title">稳稳地向前</div>
          </div>
          <div className="sg-spec">
            <span>标签 · 宋体 400 / 13</span>
            <div className="sg-label">week 4 · 10.19 – 10.25 · 本周 1 / 2 · 体重 161.8 lb</div>
          </div>
          <div className="sg-spec">
            <span>正文 · 宋体 400 / 16 · 行高 2</span>
            <p className="sg-prose">
              这周卧推完成得更稳。最后一组比上次多留了一点余地，这正是我们说好的节奏。下次留意动作的完整性，重量先不动。
            </p>
          </div>
          <div className="sg-spec">
            <span>表格数字 · Inter 等宽</span>
            <div className="sg-tab">115 × 8 / 6+2 · 85 × 6 · 65 × 6* · e1RM 146</div>
          </div>
          <div className="sg-spec">
            <span>阶梯</span>
            <div className="sg-ladder">
              {[
                ['--t-micro', 11],
                ['--t-small', 12.5],
                ['--t-label', 13],
                ['--t-body', 15],
                ['--t-lead', 17],
                ['--t-title', 22],
                ['--t-display', 28],
                ['--t-hero', 40],
              ].map(([name, px]) => (
                <span key={name} style={{ fontSize: `var(${name})` }}>
                  字<small>{px}</small>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="sg-sec">
        <h2>
          线与面<span>发丝 · 规则线 · 条 · 卡 · 声音的底</span>
        </h2>
        <div className="sg-lines">
          <div className="sg-line">
            <span>发丝 0.5px · --line</span>
            <i className="hair" />
          </div>
          <div className="sg-line">
            <span>规则线 1px · --ink</span>
            <i className="rule" />
          </div>
          <div className="sg-line">
            <span>条 2px · 材质渐变</span>
            <i className="bar" />
          </div>
        </div>
        <div className="sg-surfaces">
          <div className="sg-card">
            <b>卡</b>发丝边、面色、一层极轻的深度。深色下无影，只有线。
          </div>
          <p className="cl">AI 的声音：一枚墨点，一段话，一层极淡的底。页面上只有这一个声音。</p>
          <div className="sg-wash">洗底 --wash-bg：给声音用，不给数据用。</div>
        </div>
      </section>

      <section className="sg-sec">
        <h2>
          印记研究<span>雕刻，不是图章 · 三种做法，同一组里程碑</span>
        </h2>
        <div className="sg-themes" role="group" aria-label="印记做法" style={{ marginBottom: 'var(--s6)' }}>
          {(
            [
              ['ring', '刻圈'],
              ['guilloche', '玑镂'],
              ['seal', '方印'],
            ] as const
          ).map(([v, name]) => (
            <button key={v} aria-pressed={variant === v} onClick={() => setVariant(v)}>
              {name}
            </button>
          ))}
        </div>
        <div className="sg-marks">
          {milestones.map(m => (
            <figure key={m.caption}>
              <Mark variant={variant} {...m} />
              <figcaption>{m.caption}</figcaption>
            </figure>
          ))}
        </div>
        <p className="sg-note">
          刻圈：双层发丝圆，边款沿圆排字，数字居中，最像表盘。玑镂：七十二道放射发丝，像硬币的边，重量感最强。方印：圆角方框，数字在左上、一个字在右下，最接近东方的印，但仍是刻的。
        </p>
      </section>

      <section className="sg-sec">
        <h2>
          board 原型<span>AI 布置的首页 · 每张卡有一扇门</span>
        </h2>
        <div className="sg-phone">
          <div className="bd-top">
            <span className="brand">lowkkey</span>
            <span className="mood">
              <b>{themeNames[theme]}</b>主项稳步前进
            </span>
          </div>
          <p className="bd-presence">
            <i />
            <span>昨天的卧推记下了。今天歇一天，明天腿与肩，深蹲还是 175，不急着加。</span>
          </p>
          <p className="bd-status">
            <span>
              <b>周一</b>10.19
            </span>
            <span>
              <b>week</b>4
            </span>
            <span>
              <b>本周</b>1 / 2
            </span>
          </p>
          <div className="bd-cards">
            <article className="bd-card">
              <div className="bd-kind">
                next<span>明天 · 周二 10.20</span>
              </div>
              <h3>腿与肩</h3>
              <div className="bd-sub">3 个动作 · 9 组</div>
              <ul className="bd-items">
                <li>
                  杠铃深蹲
                  <b>
                    175<small>lb</small>
                  </b>
                </li>
                <li>
                  坐姿哑铃推肩
                  <b>
                    45<small>lb / 只</small>
                  </b>
                </li>
                <li>
                  侧平举
                  <b>
                    15<small>lb</small>
                  </b>
                </li>
              </ul>
              <a className="door" href="#board">
                聊这一天 <span aria-hidden="true">↗</span>
              </a>
            </article>
            <div className="bd-two">
              <article className="bd-card">
                <div className="bd-kind">week</div>
                <WeekRing done={1} planned={2} />
              </article>
              <article className="bd-card">
                <div className="bd-kind">body</div>
                <div className="bd-hero">
                  <b>
                    161.8<small>lb</small>
                  </b>
                </div>
                <Sparkline />
              </article>
            </div>
            <article className="bd-card bd-letter">
              <div className="bd-kind">
                letter<span>week 4</span>
              </div>
              <h3>稳稳地向前</h3>
              <p>
                这周卧推完成得更稳。最后一组比上次多留了一点余地，这正是我们说好的节奏。下次留意动作的完整性，重量先不动。
              </p>
              <div className="sign">— AI · 10.19</div>
              <a className="door" href="#board">
                回信 <span aria-hidden="true">↗</span>
              </a>
            </article>
            <article className="bd-card bd-mark quiet">
              <Mark variant={variant} size={96} {...milestones[0]} />
              <p>
                本周落下一枚印记：卧推第一片。
                <br />
                它会留在 recap 页末尾。
              </p>
            </article>
          </div>
        </div>
        <p className="sg-note">
          卡片目录固定：presence、next、week、body、letter、mark、focus、rest、rhythm。AI
          只能挑选与排序，不能造卡。门不写入任何事实，只把人带回对话并预填一句话。
        </p>
      </section>

      <section className="sg-sec">
        <h2>
          作息带<span>rhythm 面板 · 一周的睡眠，训练日有一点</span>
        </h2>
        <RhythmBand />
        <p className="sg-note">
          横轴从晚上九点到次日十一点。每一条从上床到起床；休息日更淡；起床后的小点是训练日。数据由 AI
          从对话里听到就写：「昨晚十二点睡，七点起」。
        </p>
      </section>

      <section className="sg-sec">
        <h2>
          动效<span>两条弹簧 · 一种按压</span>
        </h2>
        <MotionDemo />
        <p className="sg-note">
          gentle 有一点越过，用于纸升起、卡片长成页面；snap 不越过，用于收回与小位移。按压即刻缩到 0.975
          并带一层洗底，手指移开即恢复。
        </p>
      </section>
    </main>
  );
}
