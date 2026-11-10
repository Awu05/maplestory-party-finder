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

  const tabStops = () => screen.getAllByRole('button').filter((b) => b.tabIndex === 0);

  it('is one Tab stop: only the first selected cell is tabbable', () => {
    render(<FreeTimeGrid label="Free" value={[68, 100]} onChange={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(168);
    expect(tabStops().map((b) => b.getAttribute('aria-label'))).toEqual(['Tue 8p']);
  });

  it('with nothing selected, Sun 12a is the Tab stop', () => {
    render(<FreeTimeGrid label="Free" value={[]} onChange={() => {}} />);
    expect(tabStops().map((b) => b.getAttribute('aria-label'))).toEqual(['Sun 12a']);
  });

  it('arrow keys, Home and End move focus and the Tab stop; activating toggles the focused cell', () => {
    const onChange = vi.fn();
    render(<FreeTimeGrid label="Free" value={[68]} onChange={onChange} />);
    const cell = (name: string) => screen.getByRole('button', { name });
    const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });
    cell('Tue 8p').focus();
    key('ArrowRight');
    expect(cell('Wed 8p')).toHaveFocus();
    key('ArrowDown');
    expect(cell('Wed 9p')).toHaveFocus();
    key('ArrowLeft');
    key('ArrowUp');
    key('ArrowUp');
    expect(cell('Tue 7p')).toHaveFocus();
    key('End');
    expect(cell('Sat 7p')).toHaveFocus();
    key('ArrowRight');
    expect(cell('Sat 7p')).toHaveFocus();
    key('Home');
    expect(cell('Sun 7p')).toHaveFocus();
    expect(tabStops()).toEqual([cell('Sun 7p')]);
    // jsdom does not turn Enter/Space on a button into a click; a click without a mouse press is that activation.
    fireEvent.click(document.activeElement!);
    expect(onChange).toHaveBeenLastCalledWith([19, 68]);
  });

  it('a fast drag applies every cell entered before a re-render', () => {
    const onChange = vi.fn();
    render(<FreeTimeGrid label="Free" value={[]} onChange={onChange} />);
    const cell = (name: string) => screen.getByRole('button', { name });
    fireEvent.mouseDown(cell('Tue 8p'));
    fireEvent.mouseEnter(cell('Tue 9p'));
    fireEvent.mouseEnter(cell('Tue 10p'));
    fireEvent.mouseEnter(cell('Tue 11p'));
    fireEvent.mouseUp(window);
    expect(onChange).toHaveBeenLastCalledWith([68, 69, 70, 71]);
  });

  it('describedBy sets aria-describedby on the grid', () => {
    render(<FreeTimeGrid label="Free" value={[]} onChange={() => {}} describedBy="hint-1" />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-describedby', 'hint-1');
  });
});
