import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SusoMatrixPreview } from '../../types/api'
import { SusoMatrixPreview } from './SusoMatrixPreview'

const sampleMatrix: SusoMatrixPreview = {
  ctaStyle: 'buy_now',
  gates: [
    {
      gate: 'budget',
      state: 'passed',
      label: 'Budget viability',
      detail: 'Budget tier will be checked against qualifying matrix cells.',
    },
  ],
  cells: [
    {
      objective: 'leadgen',
      stage: 'consideration',
      segment: 'geographic',
      label: 'Leadgen — consideration',
      status: 'eligible',
    },
    {
      objective: 'sales',
      stage: 'conversion',
      segment: 'geographic',
      label: 'Sales — conversion',
      status: 'gated',
      gateReason: 'Sales objective not allowed for this value×complexity profile',
    },
  ],
}

describe('SusoMatrixPreview', () => {
  it('renders fallback when matrix is null', () => {
    render(<SusoMatrixPreview matrix={null} />)
    expect(
      screen.getByText(/save step 0 inputs to preview eligible campaign cells/i),
    ).toBeInTheDocument()
  })

  it('renders loading state', () => {
    render(<SusoMatrixPreview matrix={null} loading />)
    expect(screen.getByText(/loading strategy matrix/i)).toBeInTheDocument()
  })

  it('renders eligible cell with status label', () => {
    render(<SusoMatrixPreview matrix={sampleMatrix} />)
    expect(screen.getByText('Eligible')).toBeInTheDocument()
    expect(screen.getByText('Leadgen — consideration')).toBeInTheDocument()
  })

  it('renders gated cell gate reason', () => {
    render(<SusoMatrixPreview matrix={sampleMatrix} />)
    expect(
      screen.getByText(/sales objective not allowed for this value×complexity profile/i),
    ).toBeInTheDocument()
  })
})
