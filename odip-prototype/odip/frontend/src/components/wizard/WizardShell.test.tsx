import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WizardShell } from './WizardShell'

describe('WizardShell', () => {
  it('renders the rail and content once each, with the rail as an aside landmark and the content as a section (no nested <main>)', () => {
    render(
      <WizardShell
        rail={<div data-testid="rail-element">rail</div>}
        railLabel="Wizard steps"
      >
        <div data-testid="content-element">form</div>
      </WizardShell>,
    )

    const railNodes = screen.getAllByTestId('rail-element')
    const contentNodes = screen.getAllByTestId('content-element')
    expect(railNodes).toHaveLength(1)
    expect(contentNodes).toHaveLength(1)

    const aside = screen.getByRole('complementary', { name: /wizard steps/i })
    expect(aside).toBeInTheDocument()
    expect(aside).toHaveClass('lg:w-52', 'lg:shrink-0', 'min-w-0')

    // Content is a labelled section, NOT a <main>: AppLayout already provides the single
    // authenticated-shell <main id="main">, and nesting another one would be a landmark
    // regression.
    const section = screen.getByRole('region', { name: /wizard content/i })
    expect(section).toBeInTheDocument()
    expect(section).toHaveClass('min-w-0', 'flex-1')
    expect(document.querySelectorAll('main').length).toBe(0)
  })

  it('honours a custom railLabel and merges className overrides', () => {
    render(
      <WizardShell
        rail={<span>rail</span>}
        railLabel="Intake wizard steps"
        className="custom-outer"
        railClassName="custom-rail"
        contentClassName="custom-content"
      >
        <span>form</span>
      </WizardShell>,
    )

    expect(screen.getByRole('complementary', { name: /intake wizard steps/i })).toHaveClass('custom-rail')
    expect(screen.getByRole('region', { name: /wizard content/i })).toHaveClass('custom-content')
    expect(screen.getByRole('complementary', { name: /intake wizard steps/i }).parentElement).toHaveClass('custom-outer')
  })
})
