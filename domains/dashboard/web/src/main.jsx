import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const AUTO_REFRESH_MS = 30_000;

function useTheme() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem('comet-theme');
    const initial =
      stored === 'dark' || stored === 'light'
        ? stored
        : window.matchMedia?.('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    // 同步设置属性，避免首次渲染闪烁
    document.documentElement.setAttribute('data-theme', initial);
    return initial;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('comet-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return { theme, toggle };
}

const PHASES = [
  ['open', '启动'],
  ['design', '设计'],
  ['build', '构建'],
  ['verify', '验证'],
  ['archive', '归档'],
];

const ARTIFACTS = [
  ['proposal', 'proposal.md', '提案'],
  ['design', 'design.md', '设计文档'],
  ['tasks', 'tasks.md', '任务清单'],
  ['plan', 'plan.md', '实施计划'],
  ['verifyReport', 'verify-result.md', '验证报告'],
  ['cometYaml', '.comet.yaml', '变更配置'],
];

const SOURCE_LABELS = {
  openspec: 'OpenSpec 产物',
  superpowers: 'Superpowers 产物',
  comet: 'Comet 中间产物',
};

const VERIFY_LABEL = {
  pass: '通过',
  fail: '验证失败',
  pending: '待验证',
  unknown: '未知',
};

const VERIFY_TONE = {
  pass: 'ok',
  fail: 'danger',
  pending: 'warn',
  unknown: 'neutral',
};

function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [artifact, setArtifact] = useState(null);
  const refreshingRef = useRef(false);
  const { theme, toggle: toggleTheme } = useTheme();

  const useDemo = new URLSearchParams(window.location.search).has('demo');

  const refresh = useCallback(
    async (manual = false) => {
      if (refreshingRef.current) return;

      refreshingRef.current = true;
      if (manual) setLoading(true);
      try {
        const next = useDemo ? await loadDemoSnapshot() : await fetchSnapshot();
        setSnapshot(next);
        setSelectedId((previous) => pickSelected(next, previous));
        if (manual) toast('状态已刷新');
      } catch (error) {
        toast(`刷新失败：${error.message}`);
      } finally {
        refreshingRef.current = false;
        if (manual) setLoading(false);
      }
    },
    [useDemo],
  );

  useEffect(() => {
    void refresh(false);

    const timer = window.setInterval(() => {
      void refresh(false);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [refresh]);

  const selected = useMemo(() => findChange(snapshot, selectedId), [snapshot, selectedId]);
  const visible = useMemo(() => filterChanges(snapshot, tab, query), [snapshot, tab, query]);

  return (
    <main className="min-h-screen bg-surface text-fg antialiased lg:grid lg:grid-cols-[var(--rail-w)_1fr]">
      <Sidebar open={railOpen} onClose={() => setRailOpen(false)} />
      {railOpen && (
        <button
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
          aria-label="关闭导航"
          onClick={() => setRailOpen(false)}
        />
      )}
      <section className="min-w-0">
        <Topbar
          project={snapshot?.project}
          loading={loading}
          query={query}
          onQuery={setQuery}
          onMenu={() => setRailOpen(true)}
          onRefresh={() => refresh(true)}
          autoRefreshMs={AUTO_REFRESH_MS}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <div className="px-4 pb-12 pt-5 sm:px-6 lg:px-8">
          {!snapshot ? (
            <LoadingState />
          ) : (
            <Dashboard
              snapshot={snapshot}
              visible={visible}
              selected={selected}
              selectedId={selectedId}
              tab={tab}
              onTab={setTab}
              onSelect={setSelectedId}
              onPreview={setArtifact}
            />
          )}
        </div>
      </section>
      <ArtifactDrawer artifact={artifact} onClose={() => setArtifact(null)} />
    </main>
  );
}

function Sidebar({ open, onClose }) {
  return (
    <aside
      className={[
        'fixed inset-y-0 left-0 z-50 flex w-[var(--rail-w)] flex-col gap-5 border-r border-border bg-bg px-4 py-5 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')}
    >
      <div className="flex items-start gap-2 px-2 py-1">
        <img src="/favicon.png" alt="Comet" className="size-7 rounded-[7px]" />
        <div className="min-w-0">
          <div className="truncate text-base font-bold leading-tight">Comet Dashboard</div>
          <div className="mt-0.5 text-[11px] leading-none text-meta">v0.0.1</div>
        </div>
      </div>
      <nav>
        <div className="mb-2 mt-4 px-2 text-[11px] font-semibold uppercase text-meta">工作区</div>
        <button
          className="flex w-full items-center gap-3 rounded-xl bg-accent-soft px-3 py-2 text-left text-sm font-medium text-accent-active"
          onClick={onClose}
        >
          <span className="text-lg leading-none">≡</span>
          变更
        </button>
      </nav>
      <div className="mt-auto px-2 text-[11px] leading-relaxed text-meta">
        只读监控视图
        <br />
        基于 comet 流程产物
      </div>
    </aside>
  );
}

function Topbar({
  project,
  loading,
  query,
  onQuery,
  onMenu,
  onRefresh,
  autoRefreshMs,
  theme,
  onToggleTheme,
}) {
  const refreshSeconds = Math.round(autoRefreshMs / 1000);

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border-soft bg-surface/80 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
      <button
        className="grid size-10 place-items-center rounded-xl text-fg-2 hover:bg-bg lg:hidden"
        onClick={onMenu}
        aria-label="打开导航"
      >
        ☰
      </button>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-base font-semibold">项目仪表盘</div>
        <div className="truncate text-xs text-meta">{project?.path ?? '—'}</div>
      </div>
      <label className="relative ml-auto w-[clamp(180px,24vw,300px)] max-sm:hidden">
        <SearchIcon className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-meta" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          className="h-10 w-full rounded-full border border-border bg-bg pl-10 pr-4 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/20"
          placeholder="搜索变更..."
          type="search"
        />
      </label>
      <span className="hidden rounded-full bg-bg px-3 py-2 text-xs font-medium text-meta md:inline-flex">
        自动刷新 · {refreshSeconds} 秒
      </span>
      <button
        className="rounded-full border border-border bg-bg px-4 py-2 text-sm font-medium text-fg-2 hover:bg-surface"
        disabled={loading}
        onClick={onRefresh}
      >
        {loading ? '刷新中' : '立即刷新'}
      </button>
      <button
        className="grid size-10 place-items-center rounded-xl text-fg-2 transition-colors hover:bg-bg hover:text-fg"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
        title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>
    </header>
  );
}

function SunIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SearchIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </svg>
  );
}

function Dashboard({ snapshot, visible, selected, selectedId, tab, onTab, onSelect, onPreview }) {
  const isEmpty = snapshot.changes.active.length + snapshot.changes.archived.length === 0;
  return (
    <div className="mx-auto min-w-0 max-w-dashboard">
      <SectionHead
        title="项目概览"
        hint={`生成于 ${formatTimestamp(snapshot.project.generatedAt)}`}
      />
      <SummaryCards snapshot={snapshot} />
      <SectionHead title="变更工作区" hint="查看文件产物与项目进度" />
      {isEmpty ? (
        <EmptyState />
      ) : (
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(260px,320px)]">
          <ChangesExplorer
            visible={visible}
            selectedId={selectedId}
            tab={tab}
            onTab={onTab}
            onSelect={onSelect}
          />
          {selected && <ChangeDetail change={selected} onPreview={onPreview} />}
          {selected && <SidePanel change={selected} git={snapshot.git} onPreview={onPreview} />}
        </div>
      )}
    </div>
  );
}

function SectionHead({ title, hint }) {
  return (
    <div className="mb-4 mt-6 flex flex-wrap items-baseline gap-3 first:mt-2">
      <h2 className="text-[28px] font-bold leading-tight">{title}</h2>
      <span className="text-sm text-muted">{hint}</span>
    </div>
  );
}

function SummaryCards({ snapshot }) {
  const cards = [
    ['活跃变更', snapshot.summary.activeChanges, '当前 repo 中', '进行中'],
    ['已归档变更', snapshot.summary.archivedChanges, '历史迭代', '已完成'],
    [
      'Verify 失败',
      snapshot.summary.verifyFailed,
      snapshot.summary.verifyFailed ? '需要处理' : '全部通过',
      snapshot.summary.verifyFailed ? '阻塞' : '健康',
    ],
    [
      '未完成任务',
      snapshot.summary.tasksIncomplete,
      '跨变更统计',
      snapshot.summary.tasksIncomplete ? '待办' : '清零',
    ],
    [
      'Git 未提交',
      snapshot.summary.dirtyFiles,
      'verify 前需复核',
      snapshot.summary.dirtyFiles ? '未提交' : '干净',
    ],
  ];
  return (
    <section className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
      {cards.map(([label, value, note, tag]) => (
        <SummaryCard
          key={label}
          label={label}
          value={value}
          note={note}
          tag={tag}
          animationKey={`${snapshot.project.generatedAt}-${label}`}
        />
      ))}
    </section>
  );
}

function SummaryCard({ label, value, note, tag, animationKey }) {
  const animatedValue = useAnimatedNumber(value, 850, animationKey);

  return (
    <article className="summary-card-glow relative overflow-hidden rounded-lg bg-bg p-5 shadow-raised transition-shadow duration-200 hover:shadow-lg">
      <div className="text-sm font-medium text-muted">{label}</div>
      <div className="mt-1 text-[40px] font-bold leading-none tabular-nums">
        {Math.round(animatedValue)}
      </div>
      <div className="mt-2 truncate text-xs text-meta">{note}</div>
      <span className="absolute right-5 top-5 rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-fg-2">
        {tag}
      </span>
    </article>
  );
}

function ChangesExplorer({ visible, selectedId, tab, onTab, onSelect }) {
  return (
    <aside className="rounded-lg bg-bg shadow-raised">
      <div className="flex items-center border-b border-border-soft px-5 py-4">
        <h3 className="font-semibold">Changes Explorer</h3>
        <span className="ml-auto rounded-full bg-surface px-3 py-1 text-xs text-fg-2">
          {visible.length} 个
        </span>
      </div>
      <div className="p-4">
        <div className="mb-4 inline-flex rounded-xl bg-surface p-1">
          {[
            ['active', '活跃'],
            ['archived', '已归档'],
            ['all', '全部'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={`rounded-lg px-3 py-1.5 text-sm ${tab === value ? 'bg-bg text-fg shadow-sm' : 'text-muted'}`}
              onClick={() => onTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {visible.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">
              {tab === 'active'
                ? '暂无活跃变更'
                : tab === 'archived'
                  ? '暂无已归档变更'
                  : '暂无变更'}
            </div>
          ) : (
            visible.map((change) => (
              <ChangeCard
                key={change.id}
                change={change}
                active={change.id === selectedId}
                onClick={() => onSelect(change.id)}
              />
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function ChangeCard({ change, active, onClick }) {
  const percent = change.tasks.total
    ? Math.round((change.tasks.completed / change.tasks.total) * 100)
    : 0;
  return (
    <button
      className={`w-full rounded-xl border p-3 text-left transition-all duration-200 ${active ? 'border-accent/30 bg-accent-softer shadow-sm' : 'border-transparent hover:bg-surface hover:border-border-soft'}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 text-xs text-meta">◇</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{change.displayName}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-meta">
            <span>{phaseLabel(change.phase)}</span>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface">
              <span
                className={`block h-full rounded-full ${percent === 100 ? 'bg-success' : 'bg-accent'}`}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span>
              {change.tasks.completed}/{change.tasks.total}
            </span>
          </div>
        </div>
        <Pill tone={VERIFY_TONE[change.verify.result]}>
          {VERIFY_LABEL[change.verify.result] ?? '未知'}
        </Pill>
      </div>
    </button>
  );
}

function ChangeDetail({ change, onPreview }) {
  return (
    <section className="min-w-0 rounded-lg bg-bg shadow-raised">
      <div className="flex items-start gap-4 border-b border-border-soft px-5 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{change.displayName}</h3>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-meta">
            <span>{change.workflow ?? '—'}</span>
            <span>更新于 {formatTimestamp(change.updatedAt)}</span>
            <span className="min-w-0 truncate font-mono">{relativeChangePath(change)}</span>
          </div>
        </div>
        <Pill tone={change.status === 'archived' ? 'ok' : VERIFY_TONE[change.verify.result]}>
          {change.status === 'archived' ? '已归档' : VERIFY_LABEL[change.verify.result]}
        </Pill>
      </div>
      <div className="space-y-5 p-5">
        <PhaseStepper
          phase={change.phase}
          archived={change.status === 'archived'}
          next={change.next}
        />
        <div className="grid gap-4 md:grid-cols-[1fr_340px]">
          <ArtifactList change={change} onPreview={onPreview} />
          <div className="flex flex-col gap-4">
            <TaskProgress change={change} />
          </div>
        </div>
      </div>
    </section>
  );
}

function PhaseStepper({ phase, archived, next }) {
  const current = archived ? 'archive' : phase;
  const currentIndex = Math.max(
    0,
    PHASES.findIndex(([key]) => key === current),
  );
  return (
    <article>
      <div className="mb-4 flex items-center gap-2">
        <h4 className="text-sm font-semibold">生命周期阶段</h4>
        <span className="ml-auto rounded-full bg-surface px-3 py-1 font-mono text-xs text-fg-2">
          {archived ? `归档 ${phase}` : `下一步 ${next?.command ?? '—'}`}
        </span>
      </div>
      <div className="flex">
        {PHASES.map(([key, label], index) => {
          const state =
            index < currentIndex || archived
              ? 'done'
              : index === currentIndex
                ? 'current'
                : 'pending';
          return (
            <div key={key} className="relative flex flex-1 flex-col items-center gap-2 text-center">
              {index > 0 && (
                <span
                  className={`absolute left-0 right-1/2 top-4 h-px ${index <= currentIndex || archived ? 'bg-accent' : 'bg-border'}`}
                />
              )}
              {index < PHASES.length - 1 && (
                <span
                  className={`absolute left-1/2 right-0 top-4 h-px ${index < currentIndex || archived ? 'bg-accent' : 'bg-border'}`}
                />
              )}
              <span
                className={`relative z-10 grid size-8 place-items-center rounded-full border text-sm font-bold ${state === 'done' ? 'border-accent bg-accent text-white' : state === 'current' ? 'border-accent bg-bg text-accent' : 'border-border bg-bg text-fg-2'}`}
              >
                {state === 'done' ? '✓' : index + 1}
              </span>
              <span
                className={`text-[13px] font-semibold ${state === 'current' ? 'text-accent' : state === 'done' ? 'text-accent' : 'text-fg-2'}`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function ArtifactList({ change, onPreview }) {
  const previewByKey = new Map(
    (change.artifactPreviews ?? []).map((preview) => [preview.key, preview]),
  );
  const grouped = change.artifacts?.grouped ?? [];
  const total = grouped.length;
  const ready = grouped.filter((a) => a.exists).length;
  const openspecArtifacts = grouped.filter((a) => a.source === 'openspec');
  const superpowersArtifacts = grouped.filter((a) => a.source === 'superpowers');
  const cometArtifacts = grouped.filter((a) => a.source === 'comet');

  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold tracking-tight">关键产物</h4>
        <span className="font-mono text-[12px] text-meta">
          {ready}/{total}
        </span>
      </div>
      <div className="space-y-3">
        <ArtifactGroup
          title="OpenSpec"
          artifacts={openspecArtifacts}
          previewByKey={previewByKey}
          onPreview={onPreview}
        />
        <ArtifactGroup
          title="Superpowers"
          artifacts={superpowersArtifacts}
          previewByKey={previewByKey}
          onPreview={onPreview}
        />
        <ArtifactGroup
          title="Comet"
          artifacts={cometArtifacts}
          previewByKey={previewByKey}
          onPreview={onPreview}
        />
      </div>
    </article>
  );
}

function ArtifactGroup({ title, artifacts, previewByKey, onPreview }) {
  if (artifacts.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[12px] font-medium uppercase tracking-wider text-muted">{title}</span>
        <span className="h-px flex-1 bg-border-soft" />
      </div>
      <div className="space-y-px">
        {artifacts.map((artifact) => {
          const preview = previewByKey.get(artifact.key);
          return (
            <ArtifactRow
              key={artifact.key}
              artifact={artifact}
              preview={preview}
              onPreview={onPreview}
            />
          );
        })}
      </div>
    </div>
  );
}

function ArtifactRow({ artifact, preview, onPreview }) {
  const exists = artifact.exists;
  const notApplicable = artifact.notApplicable;
  const statusLabel = exists ? artifact.label : notApplicable ? '无需生成' : '未生成';

  return (
    <button
      className={`group grid w-full grid-cols-[16px_1fr_auto] items-center gap-x-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-100 ${
        exists ? 'cursor-pointer hover:bg-surface' : 'cursor-default opacity-50'
      }`}
      disabled={!exists}
      onClick={() => onPreview({ key: artifact.key, name: artifact.label, preview })}
    >
      {/* status dot */}
      <span className="flex h-4 w-4 items-center justify-center">
        {exists ? (
          <span className="h-2 w-2 rounded-full bg-accent" />
        ) : notApplicable ? (
          <span className="h-2 w-2 rounded-full border border-border bg-surface" />
        ) : (
          <span className="h-2 w-2 rounded-full border border-border" />
        )}
      </span>
      <span className="min-w-0 truncate text-[13px] text-fg">{artifact.key}</span>
      <span className="whitespace-nowrap pl-4 text-right text-[12px] text-muted">
        {statusLabel}
      </span>
    </button>
  );
}

function useAnimatedNumber(target, duration = 800, resetKey = target) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(pref-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setValue(target);
      return undefined;
    }

    const from = 0;
    const diff = target;
    const startedAt = performance.now();
    let frame = 0;

    setValue(0);

    const tick = (now) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + diff * eased);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [duration, resetKey, target]);

  return value;
}

function TaskProgress({ change }) {
  const total = change.tasks.total;
  const completed = change.tasks.completed;
  const remaining = Math.max(0, total - completed);
  const archived = change.status === 'archived';
  const doneSections = change.tasks.sections.filter((s) => s.status === 'done').length;
  const totalSections = change.tasks.sections.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const animatedPercent = useAnimatedNumber(percent, 900, change.id);
  const animatedCompleted = useAnimatedNumber(completed, 900, change.id);
  const animatedRemaining = useAnimatedNumber(remaining, 900, change.id);
  const animatedDoneSections = useAnimatedNumber(doneSections, 900, change.id);
  const animatedRemainingValue = Math.round(animatedRemaining);
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - animatedPercent / 100);

  const isComplete = remaining === 0 && total > 0;
  const hintTone =
    archived || isComplete ? 'bg-ok-soft text-success' : 'bg-accent-softer text-fg-2';
  const dotTone = archived || isComplete ? 'bg-success' : 'bg-accent';
  const hintText = archived
    ? '已归档完成，流程已结束'
    : isComplete
      ? `所有任务已完成，可以进入 ${change.phase === 'verify' ? '归档' : 'Verify'}`
      : `剩余 ${animatedRemainingValue} 项未完成，完成后进入 ${
          change.phase === 'verify' ? '归档' : 'Verify'
        }`;

  return (
    <article className="rounded-xl border border-border-soft bg-bg px-5 py-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold tracking-tight">任务进度</h4>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${isComplete ? 'bg-ok-soft text-success' : 'bg-accent-soft text-accent'}`}
        >
          {isComplete ? '全部完成' : `${animatedRemainingValue} 项待办`}
        </span>
      </div>

      {/* Donut */}
      <div className="flex justify-center">
        <div className="relative h-[110px] w-[110px]">
          <svg
            className="block size-full -rotate-90"
            viewBox="0 0 120 120"
            role="img"
            aria-label={`任务完成度 ${percent}%`}
          >
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="var(--color-border-soft)"
              strokeWidth="7"
            />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke={isComplete ? 'var(--color-success)' : 'var(--color-accent)'}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[26px] font-bold leading-none tabular-nums">
              {Math.round(animatedPercent)}%
            </span>
            <span className="mt-0.5 text-[10px] text-muted">完成度</span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-4 flex items-center justify-center gap-6 text-center">
        <div>
          <div className="text-[18px] font-bold leading-none tabular-nums">
            {Math.round(animatedCompleted)}
          </div>
          <div className="mt-1 text-[11px] text-muted">已完成</div>
        </div>
        <div className="h-6 w-px bg-border-soft" />
        <div>
          <div className="text-[18px] font-bold leading-none tabular-nums">
            {animatedRemainingValue}
          </div>
          <div className="mt-1 text-[11px] text-muted">剩余</div>
        </div>
        <div className="h-6 w-px bg-border-soft" />
        <div>
          <div className="text-[18px] font-bold leading-none tabular-nums">
            {Math.round(animatedDoneSections)}/{totalSections}
          </div>
          <div className="mt-1 text-[11px] text-muted">分组</div>
        </div>
      </div>

      {/* Compact section bars */}
      {change.tasks.sections.length > 0 && (
        <div className="mt-4 space-y-2.5 border-t border-border-soft pt-4">
          {change.tasks.sections.map((section) => {
            const sp = section.total ? Math.round((section.completed / section.total) * 100) : 0;
            const done = section.status === 'done';
            return (
              <div key={section.title}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="truncate text-[11px] text-fg-2">{section.title}</span>
                  <span className="shrink-0 pl-2 font-mono text-[10px] text-muted">
                    {section.completed}/{section.total}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${done ? 'bg-success' : 'bg-accent'}`}
                    style={{ width: `${sp}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Next hint */}
      <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] ${hintTone}`}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotTone}`} />
        <span>{hintText}</span>
      </div>
    </article>
  );
}

function SidePanel({ change, git, onPreview }) {
  return (
    <aside className="min-h-[480px] space-y-4 xl:col-start-2 2xl:col-start-auto">
      {change.status === 'archived' ? (
        <ArchiveSummary change={change} />
      ) : (
        <NextAction change={change} />
      )}
      <RiskCard change={change} />
      <GitSnapshot git={git} />
    </aside>
  );
}

function NextAction({ change }) {
  return (
    <Card title="下一步建议" tag={phaseLabel(change.phase)}>
      <div className="rounded-xl bg-fg px-4 py-3 font-mono text-[13px] text-bg">
        <span className="text-success">$ </span>
        {change.next?.command ?? '—'}
      </div>
      <p className="text-sm text-fg-2">{change.next?.reason ?? '暂无建议'}</p>
      <p className="text-[13px] leading-relaxed text-muted">{change.next?.description ?? ''}</p>
    </Card>
  );
}

function ArchiveSummary({ change }) {
  return (
    <Card title="归档摘要" tag="已归档">
      <div className="break-words rounded-xl bg-accent-soft px-4 py-3 font-mono text-[13px] text-accent">
        {change.archive?.archiveName ?? change.name}
      </div>
      <p className="break-words text-sm text-fg-2">
        原名：{change.archive?.originalName ?? change.name} · 归档于：
        {change.archive?.archivedAt ?? '—'}
      </p>
      <p className="break-words text-[13px] leading-relaxed text-muted">
        归档路径：{change.archive?.archivePath ?? change.path} · 任务：{change.tasks.completed} /{' '}
        {change.tasks.total}
      </p>
    </Card>
  );
}

function RiskCard({ change }) {
  const risks = change.risks ?? [];
  return (
    <Card title="风险提示" tag={`${risks.length} 项`}>
      {risks.length === 0 ? (
        <div className="rounded-xl bg-surface-warm p-3 text-sm text-muted">
          当前未发现阻塞风险。
        </div>
      ) : (
        <div className="space-y-2">
          {risks.map((risk) => (
            <div
              key={`${risk.code}-${risk.message}`}
              className="rounded-xl border border-border-soft p-3"
            >
              <div className="flex gap-2 text-sm font-semibold">
                <span
                  className={
                    risk.level === 'error'
                      ? 'text-danger'
                      : risk.level === 'warning'
                        ? 'text-warn'
                        : 'text-meta'
                  }
                >
                  ●
                </span>
                <span>{risk.message}</span>
              </div>
              <div className="mt-1 font-mono text-xs text-meta">{risk.code}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function GitSnapshot({ git }) {
  return (
    <Card title="Git 快照" tag={`${git.dirtyFiles} 个未提交`}>
      <KeyValue k="分支" v={git.branch ?? '—'} />
      <KeyValue k="HEAD" v={git.head ?? '—'} />
      <div className="pt-2 text-[11px] font-semibold uppercase text-meta">最近提交</div>
      <ul className="space-y-1">
        {git.recentCommits.map((commit) => (
          <li key={commit} className="truncate text-sm text-fg-2">
            {commit}
          </li>
        ))}
      </ul>
      <div className="pt-2 text-[11px] font-semibold uppercase text-meta">未提交文件</div>
      <ul className="space-y-1">
        {git.dirtyFileList.slice(0, 5).map((file) => (
          <li key={file} className="break-all font-mono text-xs text-warn">
            {file}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Card({ title, tag, children }) {
  return (
    <article className="rounded-lg bg-bg p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <h4 className="font-semibold">{title}</h4>
        {tag && (
          <span className="ml-auto rounded-full bg-surface px-3 py-1 text-xs text-fg-2">{tag}</span>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </article>
  );
}

function KeyValue({ k, v }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-16 shrink-0 text-muted">{k}</span>
      <span className="min-w-0 truncate font-mono text-[13px]">{v}</span>
    </div>
  );
}

function ArtifactDrawer({ artifact, onClose }) {
  useEffect(() => {
    if (!artifact) return;
    const scrollY = window.scrollY;
    const previousBodyStyle = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
    };
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    return () => {
      document.body.style.position = previousBodyStyle.position;
      document.body.style.top = previousBodyStyle.top;
      document.body.style.left = previousBodyStyle.left;
      document.body.style.right = previousBodyStyle.right;
      document.body.style.width = previousBodyStyle.width;
      window.scrollTo(0, scrollY);
    };
  }, [artifact]);

  if (!artifact) return null;
  const preview = artifact.preview;
  const content = preview?.exists
    ? `${preview.content?.trimEnd() || '这个产物是空文件。'}${preview.truncated ? '\n\n> 内容过长，已截取前 256KB。' : ''}`
    : preview
      ? `尚未生成 ${artifact.name}。`
      : '这个产物文件存在，但当前 dashboard 服务返回的数据里没有全文内容。请重启 dashboard 服务后再刷新页面。';
  return (
    <div className="fixed inset-0 z-[90] grid grid-cols-[minmax(0,1fr)_minmax(360px,760px)] max-sm:grid-cols-1">
      <button aria-label="关闭产物预览" className="bg-black/30 max-sm:hidden" onClick={onClose} />
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-bg shadow-[-20px_0_44px_rgba(0,0,0,0.12)]">
        <header className="flex items-start gap-3 border-b border-border-soft p-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">{artifact.name}</h2>
            <p className="mt-1 truncate font-mono text-xs text-meta">
              {preview?.path ?? '当前服务未返回全文内容'}
            </p>
            {(preview?.size != null || preview?.updatedAt) && (
              <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted">
                {preview?.size != null && <span>{formatFileSize(preview.size)}</span>}
                {preview?.updatedAt && <span>更新于 {formatTimestamp(preview.updatedAt)}</span>}
              </div>
            )}
          </div>
          <button
            className="grid size-10 place-items-center rounded-xl text-fg-2 hover:bg-surface"
            onClick={onClose}
            aria-label="关闭产物预览"
          >
            ×
          </button>
        </header>
        <div
          className="artifact-markdown min-h-0 flex-1 overflow-y-auto overscroll-contain p-5"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      </section>
    </div>
  );
}

function Pill({ tone = 'neutral', children }) {
  const cls =
    {
      ok: 'bg-ok-soft text-success',
      warn: 'bg-warn-soft text-warn',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-info-soft text-info',
      neutral: 'bg-surface text-fg-2',
    }[tone] ?? 'bg-surface text-fg-2';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg bg-bg p-10 text-center text-sm text-muted shadow-raised">
      当前无 Comet 迭代。
    </div>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-dashboard rounded-lg bg-bg p-10 text-center text-sm text-muted shadow-raised">
      正在加载 dashboard...
    </div>
  );
}

async function fetchSnapshot() {
  const res = await fetch('/api/dashboard', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadDemoSnapshot() {
  const module = await import('../demo.js');
  return withDemoArtifactPreviews(module.DEMO_SNAPSHOT);
}

function withDemoArtifactPreviews(snapshot) {
  const hydrateChange = (change) => {
    const grouped = change.artifacts?.grouped ?? [];
    const previews = grouped.map((artifact) => ({
      key: artifact.key,
      label: artifact.label,
      path: artifact.path,
      exists: artifact.exists,
      size: artifact.exists ? 1024 + Math.floor(Math.random() * 4096) : undefined,
      updatedAt: artifact.exists ? '2026-06-25T12:00:00.000Z' : undefined,
      content: artifact.exists
        ? `# ${artifact.label}\n\n${artifact.label}：${change.displayName}\n\n- 当前阶段：${phaseLabel(change.phase)}\n- 任务进度：${change.tasks.completed}/${change.tasks.total}\n- Verify：${VERIFY_LABEL[change.verify.result] ?? '未知'}\n`
        : undefined,
    }));
    return { ...change, artifactPreviews: previews };
  };

  return {
    ...snapshot,
    changes: {
      active: (snapshot.changes.active ?? []).map(hydrateChange),
      archived: (snapshot.changes.archived ?? []).map(hydrateChange),
    },
  };
}

function pickSelected(snapshot, previous) {
  const all = [...(snapshot.changes.active ?? []), ...(snapshot.changes.archived ?? [])];
  if (previous && all.some((change) => change.id === previous)) return previous;
  return snapshot.changes.active?.[0]?.id ?? snapshot.changes.archived?.[0]?.id ?? null;
}

function findChange(snapshot, id) {
  if (!snapshot || !id) return null;
  return (
    [...(snapshot.changes.active ?? []), ...(snapshot.changes.archived ?? [])].find(
      (change) => change.id === id,
    ) ?? null
  );
}

function filterChanges(snapshot, tab, query) {
  if (!snapshot) return [];
  const list =
    tab === 'archived'
      ? (snapshot.changes.archived ?? [])
      : tab === 'all'
        ? [...(snapshot.changes.active ?? []), ...(snapshot.changes.archived ?? [])]
        : (snapshot.changes.active ?? []);
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((change) =>
    [change.name, change.displayName, change.workflow, change.phase]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
}

function relativeChangePath(change) {
  return change.status === 'archived'
    ? `openspec/changes/archive/${change.name}`
    : `openspec/changes/${change.name}`;
}

function phaseLabel(phase) {
  return PHASES.find(([key]) => key === phase)?.[1] ?? phase ?? '未知';
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatFileSize(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => el.classList.remove('show'), 2200);
}

function renderMarkdown(markdown) {
  const lines = String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const html = [];
  let inCode = false;
  let code = [];
  let list = [];

  const flushList = () => {
    if (list.length) {
      html.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      list = [];
    }
  };
  const flushCode = () => {
    html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    code = [];
  };

  for (const line of lines) {
    if (/^```/u.test(line)) {
      if (inCode) flushCode();
      else flushList();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/u);
    if (heading) {
      flushList();
      html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/u);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flushList();
    html.push(`<p>${inline(line)}</p>`);
  }
  if (inCode) flushCode();
  flushList();
  return html.join('\n') || '<p>这个产物是空文件。</p>';
}

function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

createRoot(document.getElementById('root')).render(<App />);
