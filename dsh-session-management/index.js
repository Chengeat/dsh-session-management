/**
 * dsh-session-management — manage DSH sessions: list, archive/unarchive,
 * pin/unpin, stop, rename (live), and physically delete stored session logs.
 *
 * One operation core (`sessionAdmin`) shared by:
 *  - the model-facing `session_manage` tool,
 *  - the human `/sessions` slash command,
 *  - the web route `/<webPath>/api` used by the settings page.
 */
import { rm } from 'node:fs/promises'
import path from 'node:path'

export const name = 'session-management'
export const inject = ['tools', 'commands', 'sessionQuery', 'workspaceRegistry', 'agents', 'sessionTitle']

/** Route prefix serving the settings page JSON API at `/<API_BASE>/…`. */
const API_BASE = '/dsh-session-management'

const CONFIRM_PHRASE = 'confirm'
const ACTIONS = ['list', 'archive', 'unarchive', 'pin', 'unpin', 'stop', 'rename', 'delete']

function formatError(error) {
  if (error == null) return 'unknown error'
  const label = error.name && error.name !== 'Error' ? `${error.name}: ` : ''
  return `${label}${error.message ?? String(error)}`
}

function shortTime(ms) {
  if (ms === null || ms === undefined) return '—'
  try { return new Date(ms).toLocaleString() } catch { return String(ms) }
}

function normalizeId(raw) {
  // Session ids are opaque: some are plain UUIDs without the "session-"
  // prefix. Never rewrite one — use the exact id the list reported.
  return String(raw ?? '').trim()
}

/**
 * One operation core; every caller (tool / command / route) shares it.
 * `svc` holds services resolved synchronously while the plugin fiber is active;
 * an HTTP route callback runs outside that fiber, so it must never re-read
 * them through `ctx` (that would throw "inactive context").
 */
function createSessionAdmin(svc) {
  const { sessionQuery, workspaceRegistry, agents, sessionTitle } = svc
  const persistence = svc.persistence

  async function storedSnapshot(sessionId) {
    const backend = persistence
    if (backend === undefined) return undefined
    const snaps = await backend.list()
    return snaps.find((s) => String(s.header?.id ?? s.id ?? '') === String(sessionId))
  }

  const admin = {
    async list({ archived = false, query = '' } = {}) {
      const records = await sessionQuery.listSessions()
      const ids = records.map((r) => String(r.header.id))
      const titleById = new Map()
      if (ids.length > 0) {
        const results = await sessionQuery.readTitleSnapshots(ids)
        for (const result of results) {
          if (result.status !== 'fulfilled') continue
          const value = result.value
          const id = String(value?.session?.id ?? '')
          const t = value?.title
          if (id !== '' && t !== undefined) titleById.set(id, typeof t === 'string' ? t : (t.text ?? t.title ?? ''))
        }
      }
      const backend = persistence
      const storedById = new Map()
      if (backend !== undefined) {
        try {
          for (const snap of await backend.list()) storedById.set(String(snap.header?.id ?? snap.id ?? ''), snap)
        } catch { /* listing stays best-effort when the backend fails */ }
      }
      const registry = workspaceRegistry
      const archivedSet = new Set(registry.archivedSessionIds.map(String))
      const pinnedSet = new Set(registry.pinnedSessionIds.map(String))
      const needle = query.trim().toLowerCase()
      const rows = []
      for (const record of records) {
        const id = String(record.header.id)
        const isArchived = archivedSet.has(id)
        if (!archived && isArchived) continue
        const title = titleById.get(id) ?? ''
        const cwd = record.header.cwd ?? ''
        if (needle !== '' && !`${title} ${id} ${cwd}`.toLowerCase().includes(needle)) continue
        const agent = agents.get(record.header.id)
        const stored = storedById.get(id)
        rows.push({
          id,
          title,
          cwd: cwd === '' ? null : cwd,
          createdAt: record.header.createdAt ?? null,
          live: record.live === true,
          running: agent?.status === 'running',
          archived: isArchived,
          pinned: pinnedSet.has(id),
          parentSession: record.header.parentSession != null ? String(record.header.parentSession) : null,
          eventCount: stored?.eventCount ?? null,
          sizeBytes: stored?.sizeBytes ?? null,
          logPath: stored?.location?.path ?? null,
        })
      }
      rows.sort((a, b) => (b.pinned === a.pinned ? 0 : b.pinned ? 1 : -1) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
      return { ok: true, items: rows, total: rows.length }
    },

    async archive(sessionId, { stop = false } = {}) {
      await workspaceRegistry.archiveSession(sessionId, { stopActivity: stop })
      return { ok: true, sessionId, action: 'archive' }
    },

    async unarchive(sessionId) {
      await workspaceRegistry.unarchiveSession(sessionId)
      return { ok: true, sessionId, action: 'unarchive' }
    },

    async pin(sessionId) {
      await workspaceRegistry.pinSession(sessionId)
      return { ok: true, sessionId, action: 'pin' }
    },

    async unpin(sessionId) {
      await workspaceRegistry.unpinSession(sessionId)
      return { ok: true, sessionId, action: 'unpin' }
    },

    async stop(sessionId) {
      const agent = agents.get(sessionId)
      if (agent === undefined) return { ok: false, sessionId, error: `session ${sessionId} has no live agent to stop` }
      if (agent.status === 'running') agent.cancel({ kind: 'user' })
      return { ok: true, sessionId, action: 'stop', status: agent.status }
    },

    /** Rename rides the durable title fold; only a live session log can append it. */
    async rename(sessionId, title) {
      const value = String(title ?? '').trim()
      if (value === '') return { ok: false, sessionId, error: 'a new title is required' }
      const agent = agents.get(sessionId)
      if (agent === undefined) return { ok: false, sessionId, error: 'only live sessions can be renamed (stored logs are append-only)' }
      sessionTitle.rename(agent.session, value)
      return { ok: true, sessionId, action: 'rename', title: value }
    },

    /**
     * Physical removal of a stored session: the whole session-owned log
     * directory (every format generation) under the persistence root is
     * deleted. Irreversible. A live session is stopped first; its in-memory
     * copy disappears when the app restarts.
     */
    async delete(sessionId) {
      if (persistence === undefined) return { ok: false, sessionId, error: 'no session persistence backend is mounted' }
      const snap = await storedSnapshot(sessionId)
      if (snap === undefined) return { ok: false, sessionId, error: `stored session ${sessionId} not found` }
      const logPath = snap.location?.path
      if (typeof logPath !== 'string') return { ok: false, sessionId, error: 'this session has no materialized log yet (nothing to delete; it disappears with the process)' }
      if (!/^session(\.v\d+)?\.jsonl(\.zstd)?$/u.test(path.basename(logPath))) {
        return { ok: false, sessionId, error: `unexpected log artifact name "${path.basename(logPath)}"; refusing to delete` }
      }
      const dir = path.dirname(logPath)
      const agent = agents.get(sessionId)
      if (agent !== undefined && agent.status === 'running') agent.cancel({ kind: 'user' })
      try { await workspaceRegistry.unarchiveSession(sessionId) } catch { /* not archived */ }
      try { await workspaceRegistry.unpinSession(sessionId) } catch { /* not pinned */ }
      await rm(dir, { recursive: true, force: true })
      return { ok: true, sessionId, action: 'delete', removedPath: dir }
    },
  }
  return admin
}

function present(title, kind, rawInput) {
  return { card: 'generic', title, kind, ...(rawInput === undefined ? {} : { rawInput }) }
}

function renderValue(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 1) }]
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean' },
  },
}

// Raw JSON Schema accepted by the registry subset: `required` is a root-level
// array of property names, never a leaf sibling.
const TOOL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ACTIONS,
      description: 'Operation to perform.',
    },
    sessionId: {
      type: 'string',
      description: 'Target session id (UUID, with or without the "session-" prefix). Required for every action except list. Pass the current session id to act on this session.',
    },
    title: {
      type: 'string',
      description: 'New title, for action=rename.',
    },
    confirm: {
      type: 'string',
      description: `Must be exactly "${CONFIRM_PHRASE}" for action=delete.`,
    },
    query: {
      type: 'string',
      description: 'For list: case-insensitive filter over title, id, and cwd.',
    },
    includeArchived: {
      type: 'boolean',
      description: 'For list: include archived sessions (default false).',
    },
    stop: {
      type: 'boolean',
      description: 'For archive: stop the session running work instead of refusing it (default false).',
    },
  },
}

/** Run one admin verb; every failure settles as `{ ok: false, error }`. */
async function runAdmin(admin, action, options = {}) {
  try {
    if (action === 'list') return await admin.list({ archived: options.archived === true || options.includeArchived === true, query: options.query ?? '' })
    const sessionId = normalizeId(options.sessionId)
    if (sessionId === '') return { ok: false, error: 'sessionId is required for this action' }
    if (action === 'archive') return await admin.archive(sessionId, { stop: options.stop === true })
    if (action === 'unarchive') return await admin.unarchive(sessionId)
    if (action === 'pin') return await admin.pin(sessionId)
    if (action === 'unpin') return await admin.unpin(sessionId)
    if (action === 'stop') return await admin.stop(sessionId)
    if (action === 'rename') return await admin.rename(sessionId, options.title)
    if (action === 'delete') {
      if (options.confirm !== CONFIRM_PHRASE) {
        return { ok: false, error: `delete is irreversible; rerun with confirm="${CONFIRM_PHRASE}" to remove session ${sessionId}` }
      }
      return await admin.delete(sessionId)
    }
    return { ok: false, error: `unknown action ${action}` }
  } catch (error) {
    return { ok: false, error: formatError(error) }
  }
}

function parseCommand(rawInput) {
  const input = String(rawInput ?? '').trim()
  if (input === '') return { sub: 'list' }
  const at = input.search(/\s/u)
  const sub = (at === -1 ? input : input.slice(0, at)).toLowerCase()
  const rest = at === -1 ? '' : input.slice(at + 1).trim()
  return { sub, rest }
}

function commandHelp() {
  return 'Usage: /sessions [list [filter] | archived | archive <id> | unarchive <id> | pin <id> | unpin <id> | stop <id> | rename <id> <new title> | delete <id> confirm]'
}

export function apply(ctx, config) {
  // Resolve every service the admin core needs NOW, while this plugin fiber is
  // active. The HTTP route handler runs later, outside the fiber, and must use
  // these captured instances rather than re-reading them through `ctx`.
  const admin = createSessionAdmin({
    sessionQuery: ctx.sessionQuery,
    workspaceRegistry: ctx.workspaceRegistry,
    agents: ctx.agents,
    sessionTitle: ctx.sessionTitle,
    persistence: ctx.get('sessionPersistence'),
  })

  // ---------- model tool (plain registry definition, no defineTool import) ----------
  ctx.tools.register({
    name: 'session_manage',
    description:
      'Manage DSH sessions: list stored and live sessions, archive or unarchive them, pin or unpin, stop a running session, rename a live session title, or physically delete a stored session log. Deleting removes the durable log directory from disk and is irreversible; it requires confirm set to "confirm". Acting on the current session is allowed (stop, archive, and even delete).',
    parameters: TOOL_PARAMETERS,
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    execute: (args) => runAdmin(admin, args.action, { ...args }),
    presentCall: (args) => present(`Manage sessions (${args.action})`, args.action === 'list' ? 'read' : 'other', args.sessionId ?? args.query),
  })

  // ---------- slash command ----------
  ctx.commands.register({
    name: 'sessions',
    description: 'Manage DSH sessions: list, archive, unarchive, pin, unpin, stop, rename, delete',
    input: { hint: '[list [filter] | archived | archive <id> | unarchive <id> | pin <id> | unpin <id> | stop <id> | rename <id> <new title> | delete <id> confirm]' },
    async handler({ agent, rawInput }) {
      const { sub, rest } = parseCommand(rawInput)
      const currentId = String(agent?.session?.id ?? '')
      if (sub === 'list' || sub === 'archived') {
        const result = await runAdmin(admin, 'list', { archived: sub === 'archived', query: sub === 'archived' ? '' : rest })
        if (result.ok !== true) return { kind: 'error', text: result.error }
        if (result.items.length === 0) return { kind: 'success', text: 'No sessions found.' }
        const lines = result.items.map((row) => {
          const flags = [
            row.live ? 'live' : 'cold',
            row.running ? 'running' : null,
            row.pinned ? 'pinned' : null,
            row.archived ? 'archived' : null,
          ].filter(Boolean).join(',')
          const title = row.title !== '' ? row.title : '(untitled)'
          const size = row.sizeBytes != null ? ` · ${(row.sizeBytes / 1024).toFixed(1)} KiB` : ''
          const self = row.id === currentId ? ' ← this session' : ''
          return `· ${title}\n  id=${row.id} [${flags}] created=${shortTime(row.createdAt)}${size}${self}`
        })
        return { kind: 'success', text: `${result.total} session(s):\n${lines.join('\n')}` }
      }
      if (sub === 'help') return { kind: 'success', text: commandHelp() }
      const sp = rest.search(/\s/u)
      const targetId = normalizeId(sp === -1 ? rest : rest.slice(0, sp))
      const tail = sp === -1 ? '' : rest.slice(sp + 1).trim()
      const sessionId = targetId === '' && (sub === 'archive' || sub === 'pin' || sub === 'stop') ? currentId : targetId
      if (sessionId === '') return { kind: 'error', text: commandHelp() }
      if (sub === 'delete' && !/\bconfirm\b/u.test(tail)) {
        return { kind: 'error', text: `Deleting session ${sessionId} is IRREVERSIBLE (it removes the durable log from disk). Re-run with: /sessions delete ${targetId} confirm` }
      }
      if (sub === 'rename' && tail === '') return { kind: 'error', text: 'Usage: /sessions rename <session-id> <new title>' }
      const action = sub === 'archived' ? 'list' : sub
      const options = { sessionId, title: tail, confirm: CONFIRM_PHRASE, stop: true }
      const result = await runAdmin(admin, action, options)
      if (result.ok !== true) return { kind: 'error', text: result.error }
      if (action === 'delete') return { kind: 'success', text: `Deleted stored session ${sessionId}. Removed ${result.removedPath}. If it was live, its in-memory copy disappears after an app restart.` }
      if (action === 'rename') return { kind: 'success', text: `Renamed live session ${sessionId} to "${result.title}".` }
      if (action === 'stop') return { kind: 'success', text: `Stop requested for ${sessionId} (status: ${result.status}).` }
      return { kind: 'success', text: `${action}: ${sessionId}` }
    },
  })

  // ---------- web JSON API for the settings page ----------
  const apiFetch = async (request) => {
    const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
    })
    const origin = request.headers.get('origin')
    const host = request.headers.get('host')
    if (origin !== null && host !== null) {
      try {
        if (new URL(origin).host !== host) return json({ ok: false, error: 'cross-origin request refused' }, 403)
      } catch { return json({ ok: false, error: 'bad origin' }, 400) }
    }
    if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false, error: 'cross-site request refused' }, 403)
    const pathname = new URL(request.url).pathname
    if (request.method === 'GET' || request.method === 'HEAD') {
      return json({ ok: true, service: 'dsh-session-management', actions: ACTIONS })
    }
    if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405)
    void pathname
    let body
    try { body = await request.json() } catch { return json({ ok: false, error: 'invalid JSON body' }, 400) }
    const action = String(body?.action ?? '')
    const result = await runAdmin(admin, action, {
      sessionId: body?.sessionId,
      title: body?.title,
      confirm: body?.confirm,
      query: body?.query,
      archived: body?.includeArchived === true || body?.archived === true,
      stop: body?.stop === true,
    })
    return json(result, result.ok === true ? 200 : 422)
  }

  let disposeRoute = () => {}
  const web = ctx.get('webServer')
  if (web !== undefined) {
    const base = API_BASE
    try {
      disposeRoute = web.register({
        kind: 'prefix',
        path: base,
        handler: async (req, res) => {
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value)
            else if (Array.isArray(value)) for (const item of value) headers.append(key, item)
          }
          const url = `http://${req.headers.host ?? '127.0.0.1'}${req.url ?? '/'}`
          let request
          if (req.method === 'POST') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            request = new Request(url, { method: 'POST', headers, body: Buffer.concat(chunks) })
          } else {
            request = new Request(url, { method: req.method ?? 'GET', headers })
          }
          const response = await apiFetch(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(await response.text())
        },
      })
    } catch (error) {
      ctx.logger?.warn?.(`session-management: web API route skipped: ${formatError(error)}`)
    }
  }

  return () => {
    disposeRoute()
  }
}
