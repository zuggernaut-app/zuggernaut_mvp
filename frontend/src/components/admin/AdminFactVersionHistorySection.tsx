import type { ReactElement } from 'react'
import type { BusinessContextDto, FactVersionDto } from '../../types/api'

function sourceLabel(source: FactVersionDto['source']): string {
  if (source === 'customer_intake') return 'Customer intake'
  if (source === 'customer_fact_confirm') return 'Customer fact confirm'
  if (source === 'operator_fact_check') return 'Operator fact-check'
  if (source === 'setup_call_confirmed') return 'Setup call confirmed'
  return source
}

interface AdminFactVersionHistorySectionProps {
  businessContext: BusinessContextDto
}

export function AdminFactVersionHistorySection({
  businessContext,
}: AdminFactVersionHistorySectionProps): ReactElement {
  const versions = businessContext.factVersions ?? []
  const latest = businessContext.latestFactVersion ?? 0
  const older = versions.filter((v) => v.version !== latest)

  if (older.length === 0) {
    return (
      <section style={{ marginTop: '1.5rem' }}>
        <h2>Fact version history</h2>
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>No older fact versions yet.</p>
      </section>
    )
  }

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>Fact version history</h2>
      <p style={{ color: 'var(--color-muted)', marginTop: 0 }}>
        Older saves are listed below. Campaigns use version {latest}.
      </p>
      <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
        {older
          .slice()
          .sort((a, b) => b.version - a.version)
          .map((entry) => (
            <li key={entry.version} style={{ marginBottom: '1rem' }}>
              <strong>v{entry.version}</strong> · {sourceLabel(entry.source)}
              {entry.savedAt ? ` · ${new Date(entry.savedAt).toLocaleString()}` : null}
              <pre
                style={{
                  fontSize: '0.8rem',
                  margin: '0.35rem 0 0',
                  whiteSpace: 'pre-wrap',
                  color: 'var(--color-muted)',
                }}
              >
                {JSON.stringify(entry.fields, null, 2)}
              </pre>
            </li>
          ))}
      </ul>
    </section>
  )
}
