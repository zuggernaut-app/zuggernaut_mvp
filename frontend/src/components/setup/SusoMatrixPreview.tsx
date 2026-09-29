import type { ReactElement } from 'react'
import type { SusoFeasibilityGate, SusoMatrixCell, SusoMatrixPreview } from '../../types/api'

function statusLabel(status: SusoMatrixCell['status']): string {
  if (status === 'eligible') return 'Eligible'
  if (status === 'trimmed') return 'Trimmed (budget)'
  return 'Gated'
}

function statusClass(status: SusoMatrixCell['status']): string {
  if (status === 'eligible') return 'status-succeeded'
  if (status === 'trimmed') return 'status-review'
  return 'status-failed'
}

interface SusoMatrixPreviewProps {
  matrix: SusoMatrixPreview | null
  loading?: boolean
}

export function SusoMatrixPreview({ matrix, loading }: SusoMatrixPreviewProps): ReactElement {
  if (loading) {
    return <p className="muted">Loading strategy matrix…</p>
  }
  if (!matrix) {
    return <p className="muted">Save Step 0 inputs to preview eligible campaign cells.</p>
  }

  return (
    <div className="suso-matrix-preview">
      {matrix.ctaStyle ? (
        <p className="muted">
          CTA style for this profile: <strong>{matrix.ctaStyle.replace(/_/g, ' ')}</strong>
        </p>
      ) : null}

      <h3 className="h4">Feasibility gates</h3>
      <ul className="list-plain">
        {matrix.gates.map((gate: SusoFeasibilityGate) => (
          <li key={gate.gate}>
            <strong>{gate.label}</strong> — {gate.state.replace(/_/g, ' ')}
            {gate.detail ? <span className="muted"> ({gate.detail})</span> : null}
          </li>
        ))}
      </ul>

      <h3 className="h4">Search strategy matrix</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cell</th>
              <th>Objective</th>
              <th>Stage</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {matrix.cells.map((cell) => (
              <tr key={`${cell.objective}-${cell.stage}-${cell.segment}`}>
                <td>{cell.label}</td>
                <td>{cell.objective}</td>
                <td>{cell.stage}</td>
                <td>
                  <span className={statusClass(cell.status)}>{statusLabel(cell.status)}</span>
                  {cell.gateReason ? (
                    <div className="muted small">{cell.gateReason}</div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
