import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

// Ensure unexpected errors return JSON: { "error": "message" }
app.onError((err, c) => {
  return c.json({ error: err.message || 'Internal Server Error' }, 500)
})

app.get('/api/health', (c) => c.json({ status: 'ok' }))

// POST /api/homes
app.post('/api/homes', async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'Home name is required and must not be empty' }, 422)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()
  const now = new Date().toISOString()

  await c.env.DB.prepare('INSERT INTO homes (id, name, created_at) VALUES (?, ?, ?)')
    .bind(id, name, now)
    .run()

  return c.json({ id, name }, 201)
})

// GET /api/homes (list homes for web UI)
app.get('/api/homes', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, created_at as createdAt FROM homes ORDER BY created_at DESC',
  ).all<{ id: string; name: string; createdAt: string }>()

  return c.json({ homes: results })
})

// POST /api/homes/:homeId/members
app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json<{ name?: unknown }>().catch(() => null)
  if (!body || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return c.json({ error: 'Member name is required and must not be empty' }, 422)
  }

  const id = crypto.randomUUID()
  const name = body.name.trim()
  const now = new Date().toISOString()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, homeId, name, now)
    .run()

  return c.json({ id, homeId, name }, 201)
})

// GET /api/homes/:homeId/members (list members for web UI)
app.get('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const { results } = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, name, created_at as createdAt FROM members WHERE home_id = ? ORDER BY seq ASC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; name: string; createdAt: string }>()

  return c.json({ members: results })
})

// POST /api/homes/:homeId/bills
app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const body = await c.req.json<{ title?: unknown; totalCents?: unknown }>().catch(() => null)
  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 422)
  }

  const { title, totalCents } = body

  if (typeof title !== 'string' || title.trim().length === 0) {
    return c.json({ error: 'Title is required and must not be empty' }, 422)
  }

  if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents <= 0) {
    return c.json({ error: 'totalCents must be a positive whole integer' }, 422)
  }

  const { results: members } = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY seq ASC',
  )
    .bind(homeId)
    .all<{ id: string }>()

  if (members.length === 0) {
    return c.json({ error: 'Home has no members to split the bill' }, 422)
  }

  const billId = crypto.randomUUID()
  const cleanTitle = title.trim()
  const now = new Date().toISOString()
  const numMembers = members.length
  const baseAmount = Math.floor(totalCents / numMembers)
  const remainder = totalCents % numMembers

  const shares: Array<{ id: string; memberId: string; amountCents: number; paidAt: null }> = []
  const statements: D1PreparedStatement[] = []

  statements.push(
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(billId, homeId, cleanTitle, totalCents, now),
  )

  for (let i = 0; i < numMembers; i++) {
    const member = members[i]
    if (!member) continue
    const shareId = crypto.randomUUID()
    const amountCents = baseAmount + (i < remainder ? 1 : 0)

    shares.push({
      id: shareId,
      memberId: member.id,
      amountCents,
      paidAt: null,
    })

    statements.push(
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents, split_order, paid_at, idempotency_key) VALUES (?, ?, ?, ?, ?, NULL, NULL)',
      ).bind(shareId, billId, member.id, amountCents, i),
    )
  }

  await c.env.DB.batch(statements)

  return c.json(
    {
      id: billId,
      homeId,
      title: cleanTitle,
      totalCents,
      shares,
    },
    201,
  )
})

// GET /api/homes/:homeId/bills (list bills and shares for web UI)
app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const { results: bills } = await c.env.DB.prepare(
    'SELECT id, home_id as homeId, title, total_cents as totalCents, created_at as createdAt FROM bills WHERE home_id = ? ORDER BY created_at DESC',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; title: string; totalCents: number; createdAt: string }>()

  const { results: shares } = await c.env.DB.prepare(
    `SELECT 
      s.id, 
      s.bill_id as billId, 
      s.member_id as memberId, 
      m.name as memberName, 
      s.amount_cents as amountCents, 
      s.paid_at as paidAt, 
      s.split_order as splitOrder
    FROM shares s
    JOIN members m ON m.id = s.member_id
    JOIN bills b ON b.id = s.bill_id
    WHERE b.home_id = ?
    ORDER BY s.split_order ASC`,
  )
    .bind(homeId)
    .all<{
      id: string
      billId: string
      memberId: string
      memberName: string
      amountCents: number
      paidAt: string | null
      splitOrder: number
    }>()

  const billsWithShares = bills.map((b) => ({
    ...b,
    shares: shares.filter((s) => s.billId === b.id),
  }))

  return c.json({ bills: billsWithShares })
})

// POST /api/bills/:billId/shares/:shareId/pay
app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')

  const idempotencyKey = c.req.header('Idempotency-Key')?.trim()
  if (!idempotencyKey) {
    return c.json({ error: 'Idempotency-Key header is required' }, 400)
  }

  // Check if bill exists
  const bill = await c.env.DB.prepare('SELECT id FROM bills WHERE id = ?')
    .bind(billId)
    .first<{ id: string }>()

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404)
  }

  // Check if share exists and belongs to the bill
  const share = await c.env.DB.prepare(
    'SELECT id, bill_id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{
      id: string
      bill_id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      idempotency_key: string | null
    }>()

  if (!share) {
    return c.json({ error: 'Share not found' }, 404)
  }

  // If already paid
  if (share.paid_at !== null) {
    if (share.idempotency_key === idempotencyKey) {
      return c.json(
        {
          id: share.id,
          memberId: share.member_id,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different idempotency key' }, 409)
  }

  // Try atomic update
  const now = new Date().toISOString()
  const result = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(now, idempotencyKey, shareId, billId)
    .run()

  if (result.meta.changes === 1) {
    return c.json(
      {
        id: share.id,
        memberId: share.member_id,
        amountCents: share.amount_cents,
        paidAt: now,
      },
      200,
    )
  }

  // If 0 rows updated, a concurrent request completed first
  const latestShare = await c.env.DB.prepare(
    'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ? AND bill_id = ?',
  )
    .bind(shareId, billId)
    .first<{
      id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      idempotency_key: string | null
    }>()

  if (latestShare && latestShare.paid_at !== null) {
    if (latestShare.idempotency_key === idempotencyKey) {
      return c.json(
        {
          id: latestShare.id,
          memberId: latestShare.member_id,
          amountCents: latestShare.amount_cents,
          paidAt: latestShare.paid_at,
        },
        200,
      )
    }
    return c.json({ error: 'Share already paid with a different idempotency key' }, 409)
  }

  return c.json({ error: 'Failed to process payment' }, 500)
})

// GET /api/homes/:homeId/balances
app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')

  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?')
    .bind(homeId)
    .first<{ id: string }>()

  if (!home) {
    return c.json({ error: 'Home not found' }, 404)
  }

  const { results: balances } = await c.env.DB.prepare(
    `SELECT 
      m.id AS memberId,
      m.name AS name,
      COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
    FROM members m
    LEFT JOIN bills b ON b.home_id = m.home_id
    LEFT JOIN shares s ON s.bill_id = b.id AND s.member_id = m.id AND s.paid_at IS NULL
    WHERE m.home_id = ?
    GROUP BY m.id, m.name, m.seq
    ORDER BY m.seq ASC`,
  )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances }, 200)
})

export default app
