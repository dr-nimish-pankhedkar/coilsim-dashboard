'use client'

import { useState } from 'react'

export default function ConfigurationPage() {
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

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
    </div>
  )
}
