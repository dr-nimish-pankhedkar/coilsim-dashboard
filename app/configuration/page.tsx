'use client'

import { useState } from 'react'

export default function ConfigurationPage() {
  const [password,   setPassword]   = useState('')
  const [status,     setStatus]     = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message,    setMessage]    = useState('')

  const [dcPassword, setDcPassword] = useState('')
  const [dcStatus,   setDcStatus]   = useState<'idle' | 'confirm' | 'loading' | 'success' | 'error'>('idle')
  const [dcMessage,  setDcMessage]  = useState('')

  async function handleDeleteDesignCases() {
    setDcStatus('loading')
    try {
      const res = await fetch('/api/admin/delete-design-cases', {
        method: 'POST',
        headers: { Authorization: `Bearer ${dcPassword}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setDcStatus('error')
        setDcMessage(json.error ?? 'Failed')
      } else {
        setDcStatus('success')
        setDcMessage(`Deleted ${json.deleted} dashboard design case(s). Pre-existing .proj models are unchanged.`)
        setDcPassword('')
      }
    } catch {
      setDcStatus('error')
      setDcMessage('Network error')
    }
  }

  async function handleReset() {
    setStatus('loading')
    try {
      const res = await fetch('/api/admin/reset-tasks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${password}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(json.error ?? 'Failed')
      } else {
        setStatus('success')
        setMessage(`Reset ${json.reset} task(s) to Pending.`)
        setPassword('')
      }
    } catch {
      setStatus('error')
      setMessage('Network error')
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900">Configuration</h1>

      {/* Input mapping */}
      <div className="card space-y-4">
        <p className="label">Input Assignment — exp.txt</p>
        <p className="text-sm text-gray-500">
          Maps PostgreSQL columns to CoilSim 1D input file rows.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="label mb-1">Row 3</p>
            <p className="text-sm font-medium text-gray-900">COT</p>
            <p className="text-xs text-gray-400 mt-0.5">← cot_input column</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="label mb-1">Row 9</p>
            <p className="text-sm font-medium text-gray-900">HC Flow</p>
            <p className="text-xs text-gray-400 mt-0.5">← flow_input column</p>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          NULL inputs preserve existing exp.txt values on the worker side.
        </p>
      </div>

      {/* Admin actions */}
      <div className="card space-y-4">
        <p className="label">Admin Actions</p>
        <p className="text-sm text-gray-500">
          Reset tasks stuck in &quot;Processing&quot; or &quot;Error&quot; state back to &quot;Pending&quot; so the worker picks them up again.
        </p>
        <div className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setStatus('idle') }}
            placeholder="Admin password"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          <button
            onClick={handleReset}
            disabled={!password || status === 'loading'}
            className="btn-primary w-full"
          >
            {status === 'loading' ? 'Resetting…' : 'Reset Processing & Error Tasks'}
          </button>
          {status === 'success' && (
            <p className="text-sm text-emerald-600">{message}</p>
          )}
          {status === 'error' && (
            <p className="text-sm text-red-600">{message}</p>
          )}
        </div>
      </div>
      {/* Delete dashboard design cases */}
      <div className="card space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="label">Delete Dashboard Design Cases</p>
            <p className="text-sm text-gray-500 mt-1">
              Removes all design cases created via the wizard from the DB.
              Pre-existing models registered from <code className="text-xs bg-gray-100 px-1 rounded">.proj</code> files are not affected.
            </p>
          </div>
          <span className="text-[10px] font-semibold bg-red-50 text-red-600 border border-red-100 px-2 py-1 rounded-full whitespace-nowrap">Destructive</span>
        </div>

        {dcStatus !== 'confirm' && dcStatus !== 'loading' ? (
          <div className="space-y-3">
            <input
              type="password"
              value={dcPassword}
              onChange={e => { setDcPassword(e.target.value); setDcStatus('idle') }}
              placeholder="Admin password"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <button
              onClick={() => { if (dcPassword) setDcStatus('confirm') }}
              disabled={!dcPassword}
              className="w-full rounded-lg border border-red-200 bg-red-50 text-red-600 text-sm font-medium py-2 hover:bg-red-100 transition-colors disabled:opacity-40"
            >
              Delete Dashboard Design Cases…
            </button>
            {dcStatus === 'success' && <p className="text-sm text-emerald-600">{dcMessage}</p>}
            {dcStatus === 'error'   && <p className="text-sm text-red-600">{dcMessage}</p>}
          </div>
        ) : dcStatus === 'loading' ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 text-center">
            Deleting…
          </div>
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
            <p className="text-sm font-semibold text-red-700">Are you sure?</p>
            <p className="text-xs text-red-600">
              This will permanently delete all wizard-built design cases from the database.
              The CoilSim project folders on disk are not deleted.
            </p>
            <div className="flex gap-3">
              <button onClick={handleDeleteDesignCases}
                className="flex-1 rounded-lg bg-red-600 text-white text-sm font-semibold py-2 hover:bg-red-700 transition-colors disabled:opacity-60">
                Yes, delete all
              </button>
              <button onClick={() => { setDcStatus('idle'); setDcPassword('') }}
                className="flex-1 rounded-lg border border-gray-200 text-gray-600 text-sm py-2 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
