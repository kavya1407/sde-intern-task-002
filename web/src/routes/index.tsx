import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({
  component: BillSplitterApp,
})

interface Home {
  id: string
  name: string
  createdAt: string
}

interface Member {
  id: string
  homeId: string
  name: string
}

interface Share {
  id: string
  billId: string
  memberId: string
  memberName?: string
  amountCents: number
  paidAt: string | null
  splitOrder: number
}

interface Bill {
  id: string
  homeId: string
  title: string
  totalCents: number
  createdAt: string
  shares: Share[]
}

interface Balance {
  memberId: string
  name: string
  outstandingCents: number
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString()
  } catch {
    return isoString
  }
}

function BillSplitterApp() {
  const [homes, setHomes] = useState<Home[]>([])
  const [selectedHomeId, setSelectedHomeId] = useState<string>('')
  const [homesLoading, setHomesLoading] = useState(true)
  const [homesError, setHomesError] = useState<string | null>(null)

  const [members, setMembers] = useState<Member[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [balances, setBalances] = useState<Balance[]>([])
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState<string | null>(null)

  // Payment states
  const [payingShareId, setPayingShareId] = useState<string | null>(null)
  const [paymentError, setPaymentError] = useState<{ shareId: string; message: string } | null>(
    null,
  )

  // Form states
  const [newHomeName, setNewHomeName] = useState('')
  const [creatingHome, setCreatingHome] = useState(false)
  const [homeFormError, setHomeFormError] = useState<string | null>(null)

  const [newMemberName, setNewMemberName] = useState('')
  const [creatingMember, setCreatingMember] = useState(false)
  const [memberFormError, setMemberFormError] = useState<string | null>(null)

  const [newBillTitle, setNewBillTitle] = useState('')
  const [newBillDollars, setNewBillDollars] = useState('')
  const [creatingBill, setCreatingBill] = useState(false)
  const [billFormError, setBillFormError] = useState<string | null>(null)

  const [seedingDemo, setSeedingDemo] = useState(false)

  // Fetch homes list
  const fetchHomes = useCallback(async (preserveHomeId?: string) => {
    setHomesLoading(true)
    setHomesError(null)
    try {
      const res = await fetch('/api/homes')
      const data = (await res.json().catch(() => null)) as { homes?: Home[]; error?: string } | null
      if (!res.ok) {
        throw new Error(data?.error || `Server responded with ${res.status}`)
      }
      const list = data?.homes || []
      setHomes(list)
      if (list.length > 0) {
        const nextId =
          preserveHomeId && list.some((h) => h.id === preserveHomeId)
            ? preserveHomeId
            : list[0]?.id || ''
        setSelectedHomeId(nextId)
      } else {
        setSelectedHomeId('')
      }
    } catch (err) {
      setHomesError(err instanceof Error ? err.message : 'Failed to fetch homes')
    } finally {
      setHomesLoading(false)
    }
  }, [])

  // Fetch data for selected home
  const fetchHomeData = useCallback(async (homeId: string) => {
    if (!homeId) {
      setMembers([])
      setBills([])
      setBalances([])
      return
    }

    setDataLoading(true)
    setDataError(null)

    try {
      const [membersRes, billsRes, balancesRes] = await Promise.all([
        fetch(`/api/homes/${homeId}/members`),
        fetch(`/api/homes/${homeId}/bills`),
        fetch(`/api/homes/${homeId}/balances`),
      ])

      const [membersData, billsData, balancesData] = await Promise.all([
        membersRes.json().catch(() => null) as Promise<{
          members?: Member[]
          error?: string
        } | null>,
        billsRes.json().catch(() => null) as Promise<{ bills?: Bill[]; error?: string } | null>,
        balancesRes.json().catch(() => null) as Promise<{
          balances?: Balance[]
          error?: string
        } | null>,
      ])

      if (!membersRes.ok) throw new Error(membersData?.error || 'Failed to fetch members')
      if (!billsRes.ok) throw new Error(billsData?.error || 'Failed to fetch bills')
      if (!balancesRes.ok) throw new Error(balancesData?.error || 'Failed to fetch balances')

      setMembers(membersData?.members || [])
      setBills(billsData?.bills || [])
      setBalances(balancesData?.balances || [])
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Error loading home data')
    } finally {
      setDataLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHomes()
  }, [fetchHomes])

  useEffect(() => {
    if (selectedHomeId) {
      fetchHomeData(selectedHomeId)
    }
  }, [selectedHomeId, fetchHomeData])

  // Handle pay share
  const handlePayShare = async (billId: string, shareId: string) => {
    setPayingShareId(shareId)
    setPaymentError(null)

    try {
      const idempotencyKey = crypto.randomUUID()
      const res = await fetch(`/api/bills/${billId}/shares/${shareId}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
      })

      const data = (await res.json().catch(() => null)) as {
        id?: string
        paidAt?: string
        error?: string
      } | null

      if (!res.ok) {
        throw new Error(data?.error || `Payment failed with status ${res.status}`)
      }

      // Successful payment: update bill share in place
      setBills((prev) =>
        prev.map((b) =>
          b.id === billId
            ? {
                ...b,
                shares: b.shares.map((s) =>
                  s.id === shareId ? { ...s, paidAt: data?.paidAt || new Date().toISOString() } : s,
                ),
              }
            : b,
        ),
      )

      // Refresh balances in the background
      if (selectedHomeId) {
        const balRes = await fetch(`/api/homes/${selectedHomeId}/balances`)
        const balData = (await balRes.json().catch(() => null)) as { balances?: Balance[] } | null
        if (balData?.balances) {
          setBalances(balData.balances)
        }
      }
    } catch (err) {
      // Kept unpaid on error, display message
      setPaymentError({
        shareId,
        message: err instanceof Error ? err.message : 'Network error: could not complete payment',
      })
    } finally {
      setPayingShareId(null)
    }
  }

  // Create new home
  const handleCreateHome = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newHomeName.trim()
    if (!name) {
      setHomeFormError('Home name cannot be empty')
      return
    }

    setCreatingHome(true)
    setHomeFormError(null)

    try {
      const res = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null
      if (!res.ok || !data?.id) {
        throw new Error(data?.error || 'Failed to create home')
      }
      setNewHomeName('')
      await fetchHomes(data.id)
    } catch (err) {
      setHomeFormError(err instanceof Error ? err.message : 'Error creating home')
    } finally {
      setCreatingHome(false)
    }
  }

  // Add new member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newMemberName.trim()
    if (!name) {
      setMemberFormError('Member name cannot be empty')
      return
    }
    if (!selectedHomeId) return

    setCreatingMember(true)
    setMemberFormError(null)

    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null
      if (!res.ok || !data?.id) {
        throw new Error(data?.error || 'Failed to add member')
      }
      setNewMemberName('')
      fetchHomeData(selectedHomeId)
    } catch (err) {
      setMemberFormError(err instanceof Error ? err.message : 'Error adding member')
    } finally {
      setCreatingMember(false)
    }
  }

  // Create new bill
  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = newBillTitle.trim()
    if (!title) {
      setBillFormError('Bill title is required')
      return
    }
    const dollars = Number.parseFloat(newBillDollars)
    if (Number.isNaN(dollars) || dollars <= 0) {
      setBillFormError('Enter a positive dollar amount (e.g. 25.50)')
      return
    }
    const totalCents = Math.round(dollars * 100)
    if (totalCents <= 0) {
      setBillFormError('Total cents must be greater than zero')
      return
    }

    if (!selectedHomeId) return

    setCreatingBill(true)
    setBillFormError(null)

    try {
      const res = await fetch(`/api/homes/${selectedHomeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, totalCents }),
      })
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null
      if (!res.ok || !data?.id) {
        throw new Error(data?.error || 'Failed to create bill')
      }
      setNewBillTitle('')
      setNewBillDollars('')
      fetchHomeData(selectedHomeId)
    } catch (err) {
      setBillFormError(err instanceof Error ? err.message : 'Error creating bill')
    } finally {
      setCreatingBill(false)
    }
  }

  // Seed sample demo data
  const handleSeedDemo = async () => {
    setSeedingDemo(true)
    try {
      const homeRes = await fetch('/api/homes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Flat 4B' }),
      })
      const homeData = (await homeRes.json()) as { id: string }
      const homeId = homeData.id

      // Add members in specific order
      await fetch(`/api/homes/${homeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Asha' }),
      })
      await fetch(`/api/homes/${homeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ben' }),
      })
      await fetch(`/api/homes/${homeId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Chitra' }),
      })

      // Create bills
      await fetch(`/api/homes/${homeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Electricity', totalCents: 1000 }), // 334, 333, 333
      })
      await fetch(`/api/homes/${homeId}/bills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Wi-Fi Fiber', totalCents: 3000 }), // 1000, 1000, 1000
      })

      await fetchHomes(homeId)
    } catch (err) {
      alert(`Failed to seed demo data: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setSeedingDemo(false)
    }
  }

  const selectedHome = homes.find((h) => h.id === selectedHomeId)

  return (
    <div
      style={{
        maxWidth: 1040,
        margin: '0 auto',
        padding: '32px 20px 80px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        color: '#1f2937',
        lineHeight: 1.5,
      }}
    >
      {/* Top Header */}
      <header
        style={{
          borderBottom: '1px solid #e5e7eb',
          paddingBottom: 20,
          marginBottom: 28,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#111827' }}>
            Shared Bill Splitter
          </h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Equal shares with remainder distribution and idempotent payments
          </p>
        </div>

        {homes.length === 0 && !homesLoading && (
          <button
            type="button"
            onClick={handleSeedDemo}
            disabled={seedingDemo}
            style={{
              padding: '8px 16px',
              backgroundColor: '#10b981',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 14,
              cursor: seedingDemo ? 'wait' : 'pointer',
            }}
          >
            {seedingDemo ? 'Creating Demo Data...' : '+ Create Demo Home (Flat 4B)'}
          </button>
        )}
      </header>

      {/* Global Homes Error */}
      {homesError && (
        <div
          role="alert"
          style={{
            backgroundColor: '#fee2e2',
            border: '1px solid #f87171',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ color: '#991b1b', fontWeight: 500 }}>
            Error loading homes: {homesError}
          </span>
          <button
            type="button"
            onClick={() => fetchHomes(selectedHomeId)}
            style={{
              padding: '6px 12px',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Home Selector Bar */}
      <section
        style={{
          backgroundColor: '#f9fafb',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: 18,
          marginBottom: 28,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label htmlFor="home-select" style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>
            Select Home:
          </label>
          {homesLoading ? (
            <span style={{ color: '#6b7280', fontSize: 14 }}>Loading homes...</span>
          ) : homes.length === 0 ? (
            <span style={{ color: '#9ca3af', fontSize: 14 }}>No homes available yet</span>
          ) : (
            <select
              id="home-select"
              value={selectedHomeId}
              onChange={(e) => setSelectedHomeId(e.target.value)}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                backgroundColor: '#ffffff',
                fontSize: 14,
                fontWeight: 500,
                color: '#111827',
                minWidth: 180,
              }}
            >
              {homes.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Create New Home Form */}
        <form
          onSubmit={handleCreateHome}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <input
            type="text"
            placeholder="New home name (e.g. Flat 2A)"
            value={newHomeName}
            onChange={(e) => setNewHomeName(e.target.value)}
            disabled={creatingHome}
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              fontSize: 14,
              width: 220,
            }}
          />
          <button
            type="submit"
            disabled={creatingHome || !newHomeName.trim()}
            style={{
              padding: '8px 14px',
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              cursor: creatingHome ? 'wait' : 'pointer',
              opacity: !newHomeName.trim() ? 0.6 : 1,
            }}
          >
            {creatingHome ? 'Creating...' : '+ Add Home'}
          </button>
        </form>
      </section>

      {homeFormError && (
        <div style={{ color: '#dc2626', fontSize: 13, marginTop: -20, marginBottom: 20 }}>
          {homeFormError}
        </div>
      )}

      {/* Main Content Area */}
      {!selectedHomeId ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            backgroundColor: '#ffffff',
            border: '2px dashed #d1d5db',
            borderRadius: 12,
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>
            No Home Selected
          </h2>
          <p style={{ color: '#6b7280', fontSize: 14, maxWidth: 440, margin: '0 auto 20px' }}>
            Select an existing home from the dropdown above or create a new home to start managing
            members, bills, and shares.
          </p>
        </div>
      ) : dataError ? (
        <div
          role="alert"
          style={{
            backgroundColor: '#fee2e2',
            border: '1px solid #f87171',
            borderRadius: 10,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <h3 style={{ margin: '0 0 8px', color: '#991b1b', fontSize: 18 }}>
            Failed to Load Data for {selectedHome?.name || 'Home'}
          </h3>
          <p style={{ color: '#7f1d1d', margin: '0 0 16px', fontSize: 14 }}>{dataError}</p>
          <button
            type="button"
            onClick={() => fetchHomeData(selectedHomeId)}
            style={{
              padding: '8px 18px',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry Loading
          </button>
        </div>
      ) : dataLoading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 16, color: '#6b7280' }}>Loading bills and balances...</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 28 }}>
          {/* Members & Balances Summary Card */}
          <section
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: 24,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>
                  Members & Outstanding Balances
                </h2>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: '#6b7280' }}>
                  Ordered by joining sequence. Cents remainder goes to earlier members.
                </p>
              </div>

              {/* Add Member inline form */}
              <form
                onSubmit={handleAddMember}
                style={{ display: 'flex', gap: 8, alignItems: 'center' }}
              >
                <input
                  type="text"
                  placeholder="New member name"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  disabled={creatingMember}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 13,
                  }}
                />
                <button
                  type="submit"
                  disabled={creatingMember || !newMemberName.trim()}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#4b5563',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: creatingMember ? 'wait' : 'pointer',
                  }}
                >
                  {creatingMember ? 'Adding...' : '+ Member'}
                </button>
              </form>
            </div>

            {memberFormError && (
              <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>
                {memberFormError}
              </div>
            )}

            {members.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  backgroundColor: '#fef3c7',
                  border: '1px solid #fde68a',
                  borderRadius: 6,
                  color: '#92400e',
                  fontSize: 14,
                }}
              >
                This home has no members yet. Add at least one member to create and split bills.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 12,
                }}
              >
                {balances.map((b, idx) => (
                  <div
                    key={b.memberId}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      padding: '12px 16px',
                      backgroundColor: b.outstandingCents > 0 ? '#fffbeb' : '#f9fafb',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#1f2937' }}>
                        #{idx + 1} {b.name}
                      </span>
                      {b.outstandingCents === 0 ? (
                        <span
                          style={{
                            fontSize: 11,
                            backgroundColor: '#d1fae5',
                            color: '#065f46',
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          Settled
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: 11,
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          Owes
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: b.outstandingCents > 0 ? '#b45309' : '#059669',
                      }}
                    >
                      {formatMoney(b.outstandingCents)}
                    </div>
                    <div style={{ fontSize: 11, color: '#9ca3af' }}>unpaid shares</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Create Bill Form Card */}
          <section
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: 24,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700, color: '#111827' }}>
              Create New Bill
            </h2>

            <form
              onSubmit={handleCreateBill}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr)) auto',
                gap: 12,
                alignItems: 'flex-end',
              }}
            >
              <div>
                <label
                  htmlFor="bill-title"
                  style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}
                >
                  Bill Title
                </label>
                <input
                  id="bill-title"
                  type="text"
                  placeholder="e.g. Electricity, Groceries"
                  value={newBillTitle}
                  onChange={(e) => setNewBillTitle(e.target.value)}
                  disabled={creatingBill || members.length === 0}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="bill-amount"
                  style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}
                >
                  Total Amount (USD)
                </label>
                <input
                  id="bill-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 30.00"
                  value={newBillDollars}
                  onChange={(e) => setNewBillDollars(e.target.value)}
                  disabled={creatingBill || members.length === 0}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={creatingBill || members.length === 0 || !newBillTitle.trim()}
                style={{
                  padding: '9px 20px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: creatingBill ? 'wait' : 'pointer',
                  opacity: members.length === 0 || !newBillTitle.trim() ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {creatingBill ? 'Creating...' : '+ Split Bill'}
              </button>
            </form>

            {billFormError && (
              <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{billFormError}</div>
            )}

            {members.length === 0 && (
              <div style={{ color: '#6b7280', fontSize: 12, marginTop: 8 }}>
                * Add at least 1 member above to split bills.
              </div>
            )}
          </section>

          {/* Bills & Shares Section */}
          <section>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>
                Bills & Shares
              </h2>
              <span style={{ fontSize: 14, color: '#6b7280' }}>
                {bills.length} {bills.length === 1 ? 'bill' : 'bills'}
              </span>
            </div>

            {/* Empty State */}
            {bills.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '48px 20px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 12 }}>🧾</div>
                <h3 style={{ fontSize: 17, fontWeight: 600, color: '#374151', margin: '0 0 6px' }}>
                  No Bills Yet
                </h3>
                <p style={{ color: '#6b7280', fontSize: 14, maxWidth: 400, margin: '0 auto' }}>
                  There are no bills recorded for {selectedHome?.name || 'this home'}. Create a new
                  bill above to split costs evenly across all members.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
                {bills.map((bill) => {
                  const paidCount = bill.shares.filter((s) => s.paidAt !== null).length
                  const totalShares = bill.shares.length
                  const allPaid = totalShares > 0 && paidCount === totalShares

                  return (
                    <div
                      key={bill.id}
                      style={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 10,
                        padding: 20,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      }}
                    >
                      {/* Bill Header */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          borderBottom: '1px solid #f3f4f6',
                          paddingBottom: 14,
                          marginBottom: 14,
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <h3
                              style={{
                                margin: 0,
                                fontSize: 18,
                                fontWeight: 700,
                                color: '#111827',
                              }}
                            >
                              {bill.title}
                            </h3>
                            {allPaid ? (
                              <span
                                style={{
                                  fontSize: 12,
                                  backgroundColor: '#d1fae5',
                                  color: '#065f46',
                                  padding: '2px 8px',
                                  borderRadius: 9999,
                                  fontWeight: 600,
                                }}
                              >
                                Fully Settled
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: 12,
                                  backgroundColor: '#fef3c7',
                                  color: '#92400e',
                                  padding: '2px 8px',
                                  borderRadius: 9999,
                                  fontWeight: 600,
                                }}
                              >
                                {paidCount} of {totalShares} paid
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                            Created: {formatDate(bill.createdAt)}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>
                            {formatMoney(bill.totalCents)}
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            {bill.totalCents} cents total
                          </div>
                        </div>
                      </div>

                      {/* Shares list */}
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: '#4b5563',
                            marginBottom: 8,
                          }}
                        >
                          Individual Shares:
                        </div>

                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr',
                            gap: 8,
                          }}
                        >
                          {bill.shares.map((share) => {
                            const isPaid = share.paidAt !== null
                            const isPaying = payingShareId === share.id
                            const hasError = paymentError?.shareId === share.id

                            return (
                              <div
                                key={share.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '10px 14px',
                                  backgroundColor: isPaid ? '#f9fafb' : '#ffffff',
                                  border: hasError ? '1px solid #f87171' : '1px solid #e5e7eb',
                                  borderRadius: 8,
                                  gap: 12,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      fontSize: 14,
                                      color: isPaid ? '#4b5563' : '#111827',
                                    }}
                                  >
                                    {share.memberName || 'Member'}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 14,
                                      fontWeight: 700,
                                      color: isPaid ? '#6b7280' : '#1e40af',
                                    }}
                                  >
                                    {formatMoney(share.amountCents)}
                                  </span>
                                  <span style={{ fontSize: 12, color: '#9ca3af' }}>
                                    ({share.amountCents}¢)
                                  </span>
                                </div>

                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  {hasError && (
                                    <span
                                      role="alert"
                                      style={{
                                        color: '#dc2626',
                                        fontSize: 12,
                                        fontWeight: 500,
                                      }}
                                    >
                                      Payment failed: {paymentError?.message}
                                    </span>
                                  )}

                                  {isPaid ? (
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: 12,
                                          fontWeight: 600,
                                          color: '#059669',
                                          backgroundColor: '#d1fae5',
                                          padding: '4px 8px',
                                          borderRadius: 4,
                                        }}
                                      >
                                        ✓ Paid
                                      </span>
                                      <span style={{ fontSize: 11, color: '#9ca3af' }}>
                                        {formatDate(share.paidAt as string)}
                                      </span>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span
                                        style={{
                                          fontSize: 12,
                                          fontWeight: 600,
                                          color: '#b45309',
                                          backgroundColor: '#fef3c7',
                                          padding: '4px 8px',
                                          borderRadius: 4,
                                        }}
                                      >
                                        Unpaid
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handlePayShare(bill.id, share.id)}
                                        disabled={isPaying}
                                        style={{
                                          padding: '5px 12px',
                                          backgroundColor: '#2563eb',
                                          color: '#ffffff',
                                          border: 'none',
                                          borderRadius: 6,
                                          fontSize: 13,
                                          fontWeight: 600,
                                          cursor: isPaying ? 'wait' : 'pointer',
                                          opacity: isPaying ? 0.7 : 1,
                                        }}
                                      >
                                        {isPaying ? 'Paying...' : 'Pay Share'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
