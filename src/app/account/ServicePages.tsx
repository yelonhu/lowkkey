import { Welcome } from './Welcome.tsx';

const contact = 'yelon.hu@gmail.com';
export function ServicePage({ kind }: { kind: 'support' | 'terms' }) {
  return (
    <Welcome
      action={
        <a className="journey-quiet" href="/">
          回到 lowkkey
        </a>
      }
    >
      <p className="meta">{kind === 'terms' ? '服务条款 · 草稿，尚未生效' : '支持'}</p>
      <h1>{kind === 'terms' ? '关于使用 lowkkey。' : '有问题，随时写来。'}</h1>
      <article className="privacy-document">
        {kind === 'support' ? (
          <>
            <p>
              登录、连接 AI 或保存记录遇到问题，可以联系 <a href={'mailto:' + contact}>{contact}</a>
              。请说明使用的设备、发生时间和看到的错误；不要发送密码、验证码或访问令牌。
            </p>
            <h2>连接 AI</h2>
            <p>
              在 <a href="/#start">连接引导</a>中复制地址，打开你使用的 AI 网页版。ChatGPT
              创建连接后还需安装插件，再在新对话中选择 lowkkey；使用手机和网页上的同一个账号。具体路径可展开“连接帮助”。
            </p>
            <h2>记录没有更新</h2>
            <p>
              确认随手记显示“已保存”，回到页面刷新。未同步的内容仍保留在本机；如有版本冲突，请先比较两份文字再选择。AI
              只能读取已同步的记录。
            </p>
            <h2>管理资料与授权</h2>
            <p>
              点击 lowkkey 品牌打开设置，可查看或撤销 AI
              授权、导出资料及注销账户。隐私或数据处理请求也可通过上述邮箱联系。
            </p>
          </>
        ) : (
          <>
            <p>
              此页是供发布前确认的条款草稿，尚未成为用户协议。个人服务提供者的真实姓名、正式域名与生效日期将在确认后补齐。
            </p>
            <h2>服务内容</h2>
            <p>
              lowkkey 用于记录和查看训练、体重、计划与随手记，并让你授权的 AI 访问这些资料。AI
              对话由所选平台提供，使用该平台还需遵守其规则。
            </p>
            <h2>账户与授权</h2>
            <p>
              使用 Google 登录进入自己的档案。请保护你的登录账户，只授权你信任的 AI
              连接。你可以在设置中撤销授权；撤销不会自动删除已传送到 AI 平台的内容。
            </p>
            <h2>你保存的内容</h2>
            <p>
              你的内容仍属于你。你允许 lowkkey 为提供服务而保存、处理和展示所提交的内容，并按你的授权提供给
              AI。请只提交你有权使用的内容，不尝试访问他人账户、绕过权限或干扰服务。
            </p>
            <h2>AI 与训练建议</h2>
            <p>
              AI 可能误解或遗漏信息，请核对重要记录和建议。lowkkey
              不是医疗服务，不提供诊断或治疗；训练安排应结合自身实际情况，身体不适时应停止并寻求合适的专业帮助。
            </p>
            <h2>服务变化与退出</h2>
            <p>
              当前服务处于
              beta，可能发生维护、中断或功能调整。你可以导出记录、撤销连接或注销账户。账户和资料的处理方式见隐私政策。
            </p>
            <h2>联系与条款更新</h2>
            <p>
              问题请联系 <a href={'mailto:' + contact}>{contact}</a>
              。正式条款及后续重要变更会公布版本和生效时间，并在需要时请你确认。
            </p>
          </>
        )}
        <p>
          <a href="/privacy">隐私政策</a> ·{' '}
          <a href={kind === 'support' ? '/terms' : '/support'}>{kind === 'support' ? '服务条款草稿' : '联系支持'}</a>
        </p>
      </article>
    </Welcome>
  );
}
