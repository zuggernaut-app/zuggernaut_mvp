import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { SetupRunReportRecovery, SetupRunReportRecoveryStep } from '../types/api'

function RecoveryStepItem({ step }: { step: SetupRunReportRecoveryStep }): ReactElement {
  if (step.href) {
    if (step.external) {
      return (
        <a href={step.href} target="_blank" rel="noreferrer">
          {step.text}
        </a>
      )
    }
    return <Link to={step.href}>{step.text}</Link>
  }
  return <>{step.text}</>
}

interface RecoveryPlaybookProps {
  recovery: SetupRunReportRecovery
}

export function RecoveryPlaybook({ recovery }: RecoveryPlaybookProps): ReactElement {
  return (
    <div className="alert alert-info" style={{ marginTop: '0.75rem' }}>
      <strong>{recovery.title}</strong>
      <ol style={{ marginTop: '0.5rem', paddingLeft: '1.25rem', fontSize: '0.875rem' }}>
        {recovery.steps.map((step, index) => (
          <li key={`${step.text}-${index}`} style={{ marginBottom: '0.35rem' }}>
            <RecoveryStepItem step={step} />
          </li>
        ))}
      </ol>
      {recovery.advancedSteps && recovery.advancedSteps.length > 0 ? (
        <details style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-muted)' }}>
            Advanced / operator steps
          </summary>
          <ol style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            {recovery.advancedSteps.map((step, index) => (
              <li key={`adv-${step.text}-${index}`} style={{ marginBottom: '0.35rem' }}>
                <RecoveryStepItem step={step} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  )
}
