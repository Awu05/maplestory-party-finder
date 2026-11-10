import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DAY_LABELS, FreeTimeGrid, hourLabel } from '../src/components/post/FreeTimeGrid';

describe('FreeTimeGrid', () => {
  it('exports labels', () => {
    expect(DAY_LABELS[2]).toBe('Tue');
    expect(hourLabel(20)).toBe('8p');
  });

  it('clicking Tue 8p calls onChange([68])', () => {
    const onChange = vi.fn();
    render(<FreeTimeGrid label="Free" value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tue 8p' }));
    expect(onChange).toHaveBeenCalledWith([68]);
  });

  it('a keyboard activation (click without a mouse press) toggles a selected cell off', () => {
    const onChange = vi.fn();
    render(<FreeTimeGrid label="Free" value={[68]} onChange={onChange} />);
    const cell = screen.getByRole('button', { name: 'Tue 8p' });
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    cell.focus();
    fireEvent.click(cell);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('read-only renders aria-selected cells and no buttons', () => {
    render(<FreeTimeGrid label="Free" value={[68]} readOnly />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('gridcell', { name: 'Tue 8p' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('gridcell', { name: 'Tue 9p' })).toHaveAttribute('aria-selected', 'false');
  });
});
