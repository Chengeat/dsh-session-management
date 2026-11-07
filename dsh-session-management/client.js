window.__ModuleLoader__.load({
  id: 'dsh-session-management-t',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-session-management-t/api'

    // Locale follows the Harness language setting (ctx.locale), not the raw
    // browser header. Set once in apply(); the browser language is only the
    // pre-activation fallback.
    let localeService = null
    function isZh() {
      try {
        if (localeService !== undefined && localeService !== null) {
          return /^zh/iu.test(String(localeService.getLocale().active ?? ''))
        }
      } catch { /* fall through to navigator */ }
      return typeof navigator !== 'undefined' && /^zh/iu.test(navigator.language || '')
    }

    function makeStrings(ZH) {
      return {
        title: ZH ? 'Session 管理' : 'Session management',
        searchPlaceholder: ZH ? '搜索标题 / ID / 目录…' : 'Search title / id / cwd…',
        refresh: ZH ? '刷新' : 'Refresh',
        showArchived: ZH ? '显示已归档' : 'Show archived',
        loading: ZH ? '加载中…' : 'Loading…',
        count: (n) => ZH ? `共 ${n} 个会话` : `${n} session(s)`,
        error: (m) => ZH ? `错误：${m}` : `Error: ${m}`,
        empty: ZH ? '没有匹配的会话' : 'No matching sessions',
        colSession: ZH ? '会话' : 'Session',
        colStatus: ZH ? '状态' : 'Status',
        colCreated: ZH ? '创建 / 大小' : 'Created / size',
        colActions: ZH ? '操作' : 'Actions',
        untitled: ZH ? '(无标题)' : '(untitled)',
        running: ZH ? '运行中' : 'running',
        pinned: ZH ? '置顶' : 'pinned',
        archived: ZH ? '已归档' : 'archived',
        events: (n) => ZH ? `${n} 事件` : `${n} events`,
        archive: ZH ? '归档' : 'Archive',
        unarchive: ZH ? '取消归档' : 'Unarchive',
        pin: ZH ? '置顶' : 'Pin',
        unpin: ZH ? '取消置顶' : 'Unpin',
        stop: ZH ? '停止' : 'Stop',
        rename: ZH ? '改名' : 'Rename',
        del: ZH ? '删除' : 'Delete',
        confirmDelete: ZH ? '确认删除' : 'Confirm delete',
        cannotRestore: ZH ? '不可恢复!' : 'Irreversible!',
        cancel: ZH ? '取消' : 'Cancel',
        save: ZH ? '保存' : 'Save',
        newTitle: ZH ? '新标题' : 'New title',
        doneArchived: (id) => ZH ? `已归档 ${id}` : `Archived ${id}`,
        doneUnarchived: (id) => ZH ? `已取消归档 ${id}` : `Unarchived ${id}`,
        donePinned: (id) => ZH ? `已置顶 ${id}` : `Pinned ${id}`,
        doneUnpinned: (id) => ZH ? `已取消置顶 ${id}` : `Unpinned ${id}`,
        doneStopped: (id) => ZH ? `已请求停止 ${id}` : `Stop requested for ${id}`,
        doneDeleted: (id) => ZH ? `已彻底删除 ${id}` : `Permanently deleted ${id}`,
        doneRenamed: ZH ? '已重命名' : 'Renamed',
        note: ZH
          ? '提示：「归档」可逆（会话从列表隐藏，随时可恢复，历史完整保留）；「删除」会永久移除磁盘上的会话日志目录，不可恢复（运行中的会话会先被停止；当前会话也可删除，其内存副本在应用重启后消失）。'
          : 'Note: "Archive" is reversible (the session hides from lists, history untouched, restorable any time); "Delete" permanently removes the session log directory from disk and cannot be undone (a running session is stopped first; deleting the current session is allowed and its in-memory copy disappears after the app restarts).',
        note2: ZH
          ? '同样的操作也可以直接对 AI 说，例如「列出所有会话」「把那个测试会话删掉」——经由 session_manage 工具或 /sessions 命令执行。'
          : 'The same operations work through the agent: say "list all sessions" or "delete that test session" — they run via the session_manage tool or the /sessions command.',
        // Sidebar right-click menu (session target)
        delSession: ZH ? '删除会话' : 'Delete session',
        armToast: ZH
          ? '彻底删除会永久移除磁盘上的会话日志，不可恢复。点击「确认删除」执行：'
          : 'Permanent delete removes the session log from disk and cannot be undone. Press Confirm to proceed:',
        confirmBtn: ZH ? '确认删除' : 'Confirm delete',
        deleteFailed: ZH ? '删除会话失败' : 'Failed to delete the session',
        deleteDone: ZH ? '已删除会话日志；侧栏列表稍后自动同步' : 'Session log deleted; the sidebar list syncs shortly',
      }
    }

    async function call(payload) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      let data
      try { data = await response.json() } catch { data = { ok: false, error: `HTTP ${response.status}` } }
      if (data.ok !== true) throw new Error(data.error || `HTTP ${response.status}`)
      return data
    }

    function fmtBytes(n) {
      if (n == null) return '—'
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
      return `${(n / 1024 / 1024).toFixed(1)} MiB`
    }

    function fmtTime(ms) {
      if (ms == null) return '—'
      try { return new Date(ms).toLocaleString() } catch { return String(ms) }
    }

    function shortId(id) {
      return String(id).replace(/^session-/u, '').slice(0, 8)
    }

    function css() {
      return `
.sm-root { padding: 16px 20px; color: var(--dsw-alias-label-primary); }
.sm-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.sm-input { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 6px 10px; font-size: 13px; min-width: 220px; }
.sm-btn { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.sm-btn:hover { border-color: var(--dsw-alias-border-l2); }
.sm-btn[disabled] { opacity: 0.5; cursor: default; }
.sm-btn-danger { color: var(--dsw-alias-state-error-primary); }
.sm-btn-confirm { background: var(--dsw-alias-state-error-primary); color: #fff; border-color: transparent; }
.sm-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; margin: 6px 0; white-space: pre-wrap; }
.sm-ok { color: var(--dsw-alias-state-success-primary); font-size: 12px; margin: 6px 0; }
.sm-table { width: 100%; border-collapse: collapse; font-size: 12.5px; table-layout: fixed; }
.sm-table th { text-align: left; color: var(--dsw-alias-label-secondary); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.sm-table td { padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); vertical-align: top; }
.sm-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sm-title { font-weight: 500; }
.sm-id { color: var(--dsw-alias-label-secondary); font-family: monospace; font-size: 11px; }
.sm-cwd { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.sm-tag { display: inline-block; border-radius: 4px; padding: 1px 6px; font-size: 10.5px; margin: 0 4px 2px 0; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.sm-tag-live { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.sm-tag-running { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.sm-tag-pinned { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.sm-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.sm-count { color: var(--dsw-alias-label-secondary); font-size: 12px; margin-left: auto; }
.sm-empty { padding: 24px; color: var(--dsw-alias-label-secondary); text-align: center; }
.sm-note { color: var(--dsw-alias-label-secondary); font-size: 11.5px; margin-top: 10px; line-height: 1.6; }
`
    }

    function SessionAdminPage() {
      const zh = React.useSyncExternalStore(
        (cb) => (localeService ? localeService.subscribe(cb) : () => {}),
        isZh,
      )
      const S = makeStrings(zh)
      const [items, setItems] = React.useState([])
      const [query, setQuery] = React.useState('')
      const [showArchived, setShowArchived] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [message, setMessage] = React.useState('')
      const [confirmDelete, setConfirmDelete] = React.useState(null)
      const [renameFor, setRenameFor] = React.useState(null)
      const [renameValue, setRenameValue] = React.useState('')

      const refresh = React.useCallback(async (q, archived) => {
        setBusy(true)
        setError('')
        try {
          const data = await call({ action: 'list', query: q || '', includeArchived: archived === true })
          setItems(data.items || [])
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setBusy(false)
        }
      }, [])

      React.useEffect(() => { refresh(query, showArchived) }, []) // eslint-disable-line

      async function act(payload, okText) {
        setBusy(true)
        setError('')
        setMessage('')
        try {
          await call(payload)
          if (okText) setMessage(okText)
          setConfirmDelete(null)
          setRenameFor(null)
          await refresh(query, showArchived)
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          setBusy(false)
        }
      }

      function rowActions(row) {
        const buttons = []
        if (row.archived) {
          buttons.push(h('button', { key: 'ua', className: 'sm-btn', disabled: busy, onClick: () => act({ action: 'unarchive', sessionId: row.id }, S.doneUnarchived(shortId(row.id))) }, S.unarchive))
        } else {
          buttons.push(h('button', { key: 'a', className: 'sm-btn', disabled: busy, onClick: () => act({ action: 'archive', sessionId: row.id, stop: true }, S.doneArchived(shortId(row.id))) }, S.archive))
        }
        if (row.pinned) {
          buttons.push(h('button', { key: 'up', className: 'sm-btn', disabled: busy, onClick: () => act({ action: 'unpin', sessionId: row.id }, S.doneUnpinned(shortId(row.id))) }, S.unpin))
        } else {
          buttons.push(h('button', { key: 'p', className: 'sm-btn', disabled: busy, onClick: () => act({ action: 'pin', sessionId: row.id }, S.donePinned(shortId(row.id))) }, S.pin))
        }
        if (row.running) {
          buttons.push(h('button', { key: 's', className: 'sm-btn', disabled: busy, onClick: () => act({ action: 'stop', sessionId: row.id }, S.doneStopped(shortId(row.id))) }, S.stop))
        }
        if (row.live && renameFor !== row.id) {
          buttons.push(h('button', {
            key: 'r', className: 'sm-btn', disabled: busy,
            onClick: () => { setRenameFor(row.id); setRenameValue(row.title || '') },
          }, S.rename))
        }
        if (confirmDelete === row.id) {
          buttons.push(h('span', { key: 'dw', className: 'sm-btn sm-btn-danger' }, S.cannotRestore))
          buttons.push(h('button', {
            key: 'dy', className: 'sm-btn sm-btn-confirm', disabled: busy,
            onClick: () => act({ action: 'delete', sessionId: row.id, confirm: 'confirm' }, S.doneDeleted(shortId(row.id))),
          }, S.confirmDelete))
          buttons.push(h('button', { key: 'dn', className: 'sm-btn', disabled: busy, onClick: () => setConfirmDelete(null) }, S.cancel))
        } else {
          buttons.push(h('button', {
            key: 'd', className: 'sm-btn sm-btn-danger', disabled: busy,
            onClick: () => { setError(''); setConfirmDelete(row.id) },
          }, S.del))
        }
        if (renameFor === row.id) {
          buttons.push(h('input', { key: 'ri', className: 'sm-input', style: { minWidth: 140, padding: '4px 8px', fontSize: 12 }, value: renameValue, onChange: (e) => setRenameValue(e.target.value), placeholder: S.newTitle }))
          buttons.push(h('button', { key: 'rok', className: 'sm-btn', disabled: busy || !renameValue.trim(), onClick: () => act({ action: 'rename', sessionId: row.id, title: renameValue.trim() }, S.doneRenamed) }, S.save))
          buttons.push(h('button', { key: 'rc', className: 'sm-btn', disabled: busy, onClick: () => setRenameFor(null) }, '×'))
        }
        return h('div', { className: 'sm-actions' }, ...buttons)
      }

      return h('div', { className: 'sm-root' },
        h('style', { dangerouslySetInnerHTML: { __html: css() } }),
        h('div', { className: 'sm-toolbar' },
          h('input', {
            className: 'sm-input', placeholder: S.searchPlaceholder, value: query,
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') refresh(query, showArchived) },
          }),
          h('button', { className: 'sm-btn', disabled: busy, onClick: () => refresh(query, showArchived) }, S.refresh),
          h('label', { className: 'sm-btn', style: { display: 'inline-flex', gap: 6, alignItems: 'center' } },
            h('input', { type: 'checkbox', checked: showArchived, disabled: busy, onChange: (e) => { setShowArchived(e.target.checked); refresh(query, e.target.checked) } }),
            S.showArchived),
          h('span', { className: 'sm-count' }, busy ? S.loading : S.count(items.length)),
        ),
        error !== '' ? h('div', { className: 'sm-error' }, S.error(error)) : null,
        message !== '' ? h('div', { className: 'sm-ok' }, message) : null,
        items.length === 0 && !busy
          ? h('div', { className: 'sm-empty' }, S.empty)
          : h('table', { className: 'sm-table' },
            h('thead', null, h('tr', null,
              h('th', { style: { width: '32%' } }, S.colSession),
              h('th', { style: { width: '20%' } }, S.colStatus),
              h('th', { style: { width: '17%' } }, S.colCreated),
              h('th', null, S.colActions),
            )),
            h('tbody', null, ...items.map((row) =>
              h('tr', { key: row.id },
                h('td', null,
                  h('div', { className: 'sm-title sm-ellipsis', title: row.title || '' }, row.title || S.untitled),
                  h('div', { className: 'sm-id sm-ellipsis', title: row.id }, row.id),
                  h('div', { className: 'sm-cwd sm-ellipsis', title: row.cwd || '' }, row.cwd || ''),
                ),
                h('td', null,
                  h('span', { className: `sm-tag ${row.live ? 'sm-tag-live' : ''}` }, row.live ? 'live' : 'cold'),
                  row.running ? h('span', { className: 'sm-tag sm-tag-running' }, S.running) : null,
                  row.pinned ? h('span', { className: 'sm-tag sm-tag-pinned' }, S.pinned) : null,
                  row.archived ? h('span', { className: 'sm-tag' }, S.archived) : null,
                  row.eventCount != null ? h('span', { className: 'sm-tag' }, S.events(row.eventCount)) : null,
                ),
                h('td', null,
                  h('div', { className: 'sm-ellipsis' }, fmtTime(row.createdAt)),
                  h('div', { className: 'sm-cwd' }, fmtBytes(row.sizeBytes)),
                ),
                h('td', null, rowActions(row)),
              ),
            )),
          ),
        h('div', { className: 'sm-note' },
          S.note,
          h('br'),
          S.note2,
        ),
      )
    }

    return {
      inject: ['slots', 'contextMenus', 'locale'],
      apply(ctx) {
        localeService = ctx.locale

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'session-management',
          order: 60,
          label: () => makeStrings(isZh()).title,
        }, SessionAdminPage))

        // Sidebar session right-click menu: "Delete session" with a two-step
        // confirm carried by the host toast (notify's action button).
        ctx.effect(() => ctx.contextMenus.register({
          id: 'session-management.delete',
          target: 'session',
          order: 900,
          resolve: ({ sessionId }) => {
            const S = makeStrings(isZh())
            return [{
              id: 'delete',
              label: S.delSession,
              danger: true,
              separatorBefore: true,
              failureLabel: S.deleteFailed,
              run: () => {
                ctx.contextMenus.notify(S.armToast, false, {
                  label: S.confirmBtn,
                  failureLabel: S.deleteFailed,
                  run: async () => {
                    await call({ action: 'delete', sessionId, confirm: 'confirm' })
                    ctx.contextMenus.notify(S.deleteDone, true)
                  },
                })
              },
            }]
          },
        }), 'session-management: session delete menu')
      },
    }
  },
})
