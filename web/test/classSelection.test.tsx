import { screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { KNOWN_CLASSES } from '@pf/shared';
import { ManualFields } from '../src/components/character/ManualFields';
import { renderWithProviders } from './setup';

it('offers all classes in the same categories used by the admin catalog', () => {
  renderWithProviders(<ManualFields jobName="" onJob={vi.fn()} level="275" onLevel={vi.fn()} classOptions={KNOWN_CLASSES} />);
  const select = screen.getByLabelText('Class');
  expect(within(select).getAllByRole('option')).toHaveLength(55);
  expect(within(select).getAllByRole('group')).toHaveLength(12);
  for (const [category, name] of [['Anima', 'Ren'], ['Demon', 'Lethe'], ['Shine', 'Sia Astelle'], ['Shine', 'Erel Light'], ['Explorers', 'Buccaneer']]) {
    expect(within(within(select).getByRole('group', { name: category })).getByRole('option', { name })).toBeInTheDocument();
  }
  expect(within(select).queryByRole('option', { name: 'Blade Master' })).not.toBeInTheDocument();
});
