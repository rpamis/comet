/**
 * Comet bundle Client half: one Comet row beside the Harness' own sidebar
 * entries. Selecting it shows the local Comet Dashboard in the main column,
 * served through the Host's loopback proxy so the Dashboard's same-origin
 * checks stay intact. The row can also fall back to the right Sidebar browser.
 *
 * The Host half owns the `comet dashboard` process, its proxy, and the URL
 * handoff; this module only renders what the Host returns.
 */
window.__ModuleLoader__.load({
  id: 'comet-dsh-plugin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'comet-plugin';
    const DASHBOARD_ENDPOINT = '/comet-plugin/dashboard';
    const CLIENT_ICON = '__COMET_CLIENT_ICON__';

    const dictionaries = {
      zh: {
        nav: 'Comet',
        title: 'Comet Dashboard',
        refresh: '刷新',
        openSidebar: '在右侧栏打开',
        loading: '正在打开 Comet Dashboard…',
        noSession: '请先打开一个会话，再从这里打开 Comet Dashboard。',
        failed: '打开 Comet Dashboard 失败',
      },
      en: {
        nav: 'Comet',
        title: 'Comet Dashboard',
        refresh: 'Refresh',
        openSidebar: 'Open in sidebar',
        loading: 'Opening the Comet Dashboard…',
        noSession: 'Open a conversation first, then open the Comet Dashboard here.',
        failed: 'Could not open the Comet Dashboard',
      },
    };

    /** Read a value from a store-like source without depending on one shape. */
    function readSnapshot(source) {
      if (source === undefined || source === null) return undefined;
      try {
        if (typeof source === 'function') return source();
        if (typeof source.getSnapshot === 'function') return source.getSnapshot();
        if (typeof source.get === 'function') return source.get();
      } catch {
        return undefined;
      }
      return source;
    }

    function sessionIdOf(value) {
      if (typeof value === 'string' && value !== '') return value;
      if (value !== null && typeof value === 'object') {
        if (typeof value.key === 'string' && value.key !== '') return value.key;
        if (typeof value.sessionId === 'string' && value.sessionId !== '') return value.sessionId;
      }
      return undefined;
    }

    /** Resolve the Session the UI shows, from the services that publish it. */
    function readCurrentSessionId(ctx) {
      const uiSession = ctx.get('uiSession');
      const fromUi = sessionIdOf(readSnapshot(uiSession?.adapter?.current));
      if (fromUi !== undefined) return fromUi;
      return sessionIdOf(readSnapshot(ctx.get('sidebarRight')?.mounted));
    }

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** The Comet logo, as a small transparent image the sidebar row can render. */
    function CometLogo({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 16;
      return h('img', {
        src: CLIENT_ICON,
        width: edge,
        height: edge,
        alt: '',
        'aria-hidden': true,
        style: { display: 'block', objectFit: 'contain' },
      });
    }

    /** Ask the Host for the Session workspace's Dashboard addresses. */
    function requestDashboard(sessionId) {
      return fetch(DASHBOARD_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).then(async (response) => {
        let body;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        if (
          !response.ok ||
          body === null ||
          typeof body.url !== 'string' ||
          typeof body.webUrl !== 'string'
        ) {
          const reason = body !== null ? (body.message ?? body.error) : null;
          throw new Error(reason ? String(reason) : `HTTP ${response.status}`);
        }
        return { url: body.url, webUrl: body.webUrl };
      });
    }

    /** Open the Dashboard in the right Sidebar once its Session surface mounts. */
    async function openWhenMounted(sidebarRight, url, timeoutMs = 4_000) {
      const deadline = Date.now() + timeoutMs;
      let lastError;
      while (Date.now() < deadline) {
        try {
          sidebarRight.openTab('browser', { params: { url } });
          return;
        } catch (error) {
          lastError = error;
          await delay(80);
        }
      }
      throw lastError ?? new Error('The right Sidebar did not become available.');
    }

    const styles = {
      page: {
        height: '100%',
        overflow: 'hidden',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--dsw-alias-bg-base, #fff)',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        fontFamily: 'inherit',
      },
      toolbar: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flex: 'none',
        padding: '8px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, #e5e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
      },
      label: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
        fontSize: '13px',
        fontWeight: 600,
      },
      spacer: { flex: 1 },
      button: {
        border: '1px solid var(--dsw-alias-border-l1, #e5e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        borderRadius: '6px',
        padding: '3px 10px',
        fontSize: '12px',
        lineHeight: '18px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      },
      frame: {
        flex: '1 1 auto',
        minHeight: 0,
        width: '100%',
        border: '0',
        display: 'block',
        background: 'var(--dsw-alias-bg-base, #fff)',
      },
      centered: {
        flex: '1 1 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      },
      card: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        maxWidth: '420px',
        textAlign: 'center',
      },
      text: {
        margin: 0,
        fontSize: '14px',
        lineHeight: '22px',
        color: 'var(--dsw-alias-label-secondary, #4e5969)',
      },
      error: {
        margin: 0,
        fontSize: '14px',
        lineHeight: '22px',
        color: 'var(--dsw-alias-state-error-primary, #cb2634)',
      },
    };

    function CenterNote({ t, error, message, children }) {
      return h(
        'div',
        { style: styles.centered },
        h(
          'div',
          { style: styles.card },
          h(CometLogo, { size: 40 }),
          h('p', { style: error ? styles.error : styles.text }, message),
          children,
        ),
      );
    }

    /**
     * Main-panel body for the Comet row: the Dashboard framed by the Host's
     * loopback proxy, with refresh and a right-Sidebar fallback.
     */
    function CometPanel({ t, resolveSessionId, openInSidebar }) {
      const [state, setState] = React.useState({ status: 'loading' });
      const [nonce, setNonce] = React.useState(0);
      const started = React.useRef(false);
      const sessionRef = React.useRef(undefined);

      const load = () => {
        const sessionId = resolveSessionId();
        if (sessionId === undefined) {
          setState({ status: 'no-session' });
          return;
        }
        sessionRef.current = sessionId;
        setState({ status: 'loading' });
        requestDashboard(sessionId).then(
          (dashboard) => setState({ status: 'ready', webUrl: dashboard.webUrl }),
          (error) => setState({ status: 'error', message: String(error?.message ?? error) }),
        );
      };

      React.useEffect(() => {
        if (started.current) return;
        started.current = true;
        load();
      }, []);

      const refresh = () => {
        setNonce((value) => value + 1);
        load();
      };
      const showInSidebar = () => {
        const sessionId = sessionRef.current;
        if (sessionId === undefined) return;
        openInSidebar(sessionId).catch((error) => {
          console.warn('[comet] could not open the Dashboard in the sidebar:', error);
        });
      };

      if (state.status === 'no-session') {
        return h(CenterNote, { t, message: t('noSession') });
      }
      if (state.status === 'loading') {
        return h(CenterNote, { t, message: t('loading') });
      }
      if (state.status === 'error') {
        return h(
          CenterNote,
          { t, error: true, message: `${t('failed')}: ${state.message}` },
          h('button', { type: 'button', style: styles.button, onClick: refresh }, t('refresh')),
        );
      }
      return h(
        'div',
        { style: styles.page },
        h(
          'div',
          { style: styles.toolbar },
          h('span', { style: styles.label }, h(CometLogo, { size: 16 }), t('title')),
          h('div', { style: styles.spacer }),
          h('button', { type: 'button', style: styles.button, onClick: refresh }, t('refresh')),
          h(
            'button',
            { type: 'button', style: styles.button, onClick: showInSidebar },
            t('openSidebar'),
          ),
        ),
        h('iframe', {
          key: nonce,
          src: state.webUrl,
          title: t('title'),
          style: styles.frame,
          allow: 'clipboard-read; clipboard-write; fullscreen',
        }),
      );
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'comet: client dictionaries');
        const t = ctx.locale.bind(NS);
        // The row needs the Harness' sidebar entries, the frame's panel actions,
        // and — for the fallback — the right Sidebar's browser navigation.
        ctx.inject(['sidebarRight', 'layout'], (scoped) => {
          const face = scoped.sidebarRight;
          const lastSessionId = { value: undefined };
          const track = () => {
            const sessionId = readCurrentSessionId(scoped);
            if (sessionId !== undefined) lastSessionId.value = sessionId;
          };
          track();
          const trackSource = (source) => {
            if (source === null || typeof source !== 'object') return;
            if (typeof source.subscribe !== 'function') return;
            scoped.effect(() => source.subscribe(track), 'comet: on-screen Session');
          };
          trackSource(scoped.get('uiSession')?.adapter?.current);
          trackSource(face?.mounted);
          const resolveSessionId = () => readCurrentSessionId(scoped) ?? lastSessionId.value;

          const openInSidebar = async (sessionId) => {
            const dashboard = await requestDashboard(sessionId);
            // The right Sidebar acts on the Session surface on screen; selecting
            // the conversation back mounts that surface again.
            scoped.layout.selectPanel(null);
            await openWhenMounted(face, dashboard.url);
          };

          scoped.slots.inject('sidebar.panellist', () =>
            scoped.slots.register(
              { name: 'sidebar.panellist', id: 'comet', order: 30, label: () => t('nav') },
              (owner = {}) => h(CometLogo, { size: owner.size }),
            ),
          );
          scoped.slots.inject('main', () =>
            scoped.slots.register({ name: 'main', key: 'comet' }, () =>
              h(CometPanel, { t, resolveSessionId, openInSidebar }),
            ),
          );
        });
      },
    };
  },
});
