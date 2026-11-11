import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BossDTO } from '@pf/shared';
import { BossMultiPicker } from '../src/components/post/BossMultiPicker';

const bosses: BossDTO[] = ['Zakum', 'Pierre', 'Lucid', 'Darknell', 'Magnus', 'Custom boss', ...Array.from({ length: 6 }, (_, index) => `Extra boss ${index + 1}`)].map((name, index) => ({
  id: index + 1, name, imageUrl: null, difficulties: [{ id: index + 1, difficulty: 'Hard', partyCap: 6 }],
}));

function Picker({ initial = [] }: { initial?: number[] }) {
  const [value, setValue] = useState(initial);
  return <BossMultiPicker bosses={bosses} value={value} onChange={setValue} />;
}

describe('BossMultiPicker area groups', () => {
  it('groups known areas and keeps custom bosses available', () => {
    render(<Picker />);
    const summary = screen.getByText('Maple World').closest('summary')!;
    expect(summary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(screen.getByRole('checkbox', { name: 'Hard Zakum' })).toBeVisible();
    fireEvent.click(screen.getByText('Other bosses').closest('summary')!);
    expect(screen.getByRole('checkbox', { name: 'Hard Custom boss' })).toBeVisible();
    for (const area of ['Root Abyss', 'Arcane River', 'Tenebris', 'Grandis']) expect(screen.getByText(area)).toBeInTheDocument();
  });

  it('opens selected areas on edit and preserves selections when an area is collapsed', () => {
    render(<Picker initial={[3]} />);
    const area = screen.getByText('Arcane River').closest('details')!;
    expect(area).toHaveAttribute('open');
    expect(within(area).getByRole('checkbox', { name: 'Hard Lucid' })).toBeChecked();
    fireEvent.click(area.querySelector('summary')!);
    expect(area).not.toHaveAttribute('open');
    expect(within(area.querySelector('summary')!).getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(area.querySelector('summary')!);
    expect(within(area).getByRole('checkbox', { name: 'Hard Lucid' })).toBeChecked();
  });

  it('allows more than ten selections across areas and supports deselection', () => {
    render(<Picker initial={bosses.slice(0, 10).map((boss) => boss.difficulties[0].id)} />);
    const eleventh = screen.getByRole('checkbox', { name: 'Hard Extra boss 5' });
    const twelfth = screen.getByRole('checkbox', { name: 'Hard Extra boss 6' });
    expect(eleventh).toBeEnabled();
    fireEvent.click(eleventh);
    fireEvent.click(twelfth);
    expect(eleventh).toBeChecked();
    expect(twelfth).toBeChecked();
    expect(screen.getByText('12 selected')).toBeInTheDocument();
    fireEvent.click(eleventh);
    expect(eleventh).not.toBeChecked();
    expect(screen.getByText('11 selected')).toBeInTheDocument();
  });
});
