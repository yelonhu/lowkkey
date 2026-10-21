import { useEffect, useRef, type ReactNode } from 'react';

export function Welcome({
  children,
  action,
  back,
  variant,
}: {
  children: ReactNode;
  action?: ReactNode;
  back?: () => void;
  variant?: 'login';
}) {
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const heading = main.current?.querySelector('h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  }, [back === undefined]);
  return (
    <main ref={main} className={'journey' + (variant === 'login' ? ' journey--login' : '')}>
      <header className="journey-header">
        <span className="brand">lowkkey</span>
        {action}
      </header>
      <section className="journey-body">
        {back && (
          <button className="journey-back" onClick={back} aria-label="返回上一步">
            ← 返回
          </button>
        )}
        {children}
      </section>
    </main>
  );
}
export function SessionLoading({ error, retry }: { error: string; retry: () => Promise<void> }) {
  return (
    <Welcome>
      <p className="session-loading" role="status">
        {error ? '暂时无法打开，请重试。' : '正在打开 lowkkey…'}
      </p>
      {error && (
        <button className="journey-quiet" onClick={() => void retry()}>
          重试
        </button>
      )}
    </Welcome>
  );
}
export function ProviderMark({ ai }: { ai: 'claude' | 'chatgpt' }) {
  return (
    <picture className={'ai-mark' + (ai === 'chatgpt' ? ' ai-mark--chatgpt' : '')} aria-hidden="true">
      {ai === 'chatgpt' && <source media="(prefers-color-scheme: dark)" srcSet="/brands/chatgpt-white.svg" />}
      <img src={ai === 'chatgpt' ? '/brands/chatgpt-black.svg' : '/brands/claude.svg'} width="32" height="32" alt="" />
    </picture>
  );
}
