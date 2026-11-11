import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_LABELS, FreeTimeGrid, hourLabel } from '../src/components/post/FreeTimeGrid';

describe('FreeTimeGrid', () => {
  afterEach(() => window.localStorage.removeItem('partyFinder.timeFormat'));

  it('shows the whole day in two side-by-side half-day sections', () => {
    render(<FreeTimeGrid label="Free" value={[]} onChange={() => {}} />);
    const grid = screen.getByRole('grid');
    expect(within(grid).getAllByRole('row')).toHaveLength(26);
    expect(screen.getByRole('button', { name: 'Sun 12a' }).closest('tr'))
      .toBe(screen.getByRole('button', { name: 'Sun 12p' }).closest('tr'));
    expect(screen.getByRole('button', { name: 'Sat 11:30a' }).closest('tr'))
      .toBe(screen.getByRole('button', { name: 'Sat 11:30p' }).closest('tr'));
  });

  it('keeps keyboard navigation and selection working across noon', () => {
    const onChange = vi.fn();
    render(<FreeTimeGrid label="Free" value={[]} onChange={onChange} />);
    const morning = screen.getByRole('button', { name: 'Tue 11:30a' });
    morning.focus();
    fireEvent.keyDown(morning, { key: 'ArrowDown' });
    const noon = screen.getByRole('button', { name: 'Tue 12p' });
    expect(noon).toHaveFocus();
    fireEvent.click(noon);
    expect(onChange).toHaveBeenCalledWith([120]);
  });

  it('moves horizontally between the morning and afternoon sections', () => {
    render(<FreeTimeGrid label="Free" value={[]} onChange={() => {}} />);
    const morning = screen.getByRole('button', { name: 'Sat 8a' });
    const afternoon = screen.getByRole('button', { name: 'Sun 8p' });
    morning.focus();
    fireEvent.keyDown(morning, { key: 'ArrowRight' });
    expect(afternoon).toHaveFocus();
    fireEvent.keyDown(afternoon, { key: 'ArrowLeft' });
    expect(morning).toHaveFocus();
  });

  it('remembers the selected 24-hour format for another chart', () => {
    const { unmount } = render(<FreeTimeGrid label="Free" value={[137]} readOnly />);
    fireEvent.click(screen.getByRole('button', { name: '24-hour' }));
    expect(screen.getByRole('gridcell', { name: 'Tue 20:30' })).toHaveAttribute('aria-selected', 'true');
    expect(window.localStorage.getItem('partyFinder.timeFormat')).toBe('24h');
    unmount();
    render(<FreeTimeGrid label="Another chart" value={[137]} readOnly />);
    expect(screen.getByRole('button', { name: '24-hour' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('gridcell', { name: 'Tue 20:30' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '12-hour' }));
    expect(screen.getByRole('gridcell', { name: 'Tue 8:30p' })).toBeInTheDocument();
  });

  it('updates other visible charts when the format changes', () => {
    render(<><FreeTimeGrid label="First" value={[137]} readOnly /><FreeTimeGrid label="Second" value={[137]} readOnly /></>);
    const toolbars = screen.getAllByRole('group', { name: 'Time format' });
    fireEvent.click(within(toolbars[0]).getByRole('button', { name: '24-hour' }));
    expect(within(toolbars[1]).getByRole('button', { name: '24-hour' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('gridcell', { name: 'Tue 20:30' })).toHaveLength(2);
  });
  it('selects a 30-minute slot independently of the surrounding hours', () => {
    const onChange = vi.fn();
    render(<FreeTimeGrid label="Free" value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tue 8:30p' }));
    expect(onChange).toHaveBeenCalledWith([137]);
    expect(within(screen.getByRole('grid')).getAllByRole('button')).toHaveLength(336);
  });
  it('Clear selection empties the grid, and is disabled when nothing is selected', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FreeTimeGrid value={[136, 137, 230]} onChange={onChange} label="Free times" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    rerender(<FreeTimeGrid value={[]} onChange={onChange} label="Free times" />);
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
  });

  it('read-only grids have no Clear selection button', () => {
    render(<FreeTimeGrid value={[136]} readOnly label="Free times" />);
    expect(screen.queryByRole('button', { name: 'Clear selection' })).toBeNull();
  });

  it('exports labels', () => {
    expect(DAY_LABELS[2]).toBe('Tue');
    expect(hourLabel(20)).toBe('8p');
  });

  it('clicking Tue 8p calls onChange([136])', () => {
    const onChange = vi.fn();
    render(<FreeTimeGrid label="Free" value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tue 8p' }));
    expect(onChange).toHaveBeenCalledWith([136]);
  });

  it('a keyboard activation (click without a mouse press) toggles a selected cell off', () => {
    const onChange = vi.fn();
    render(<FreeTimeGrid label="Free" value={[136]} onChange={onChange} />);
    const cell = screen.getByRole('button', { name: 'Tue 8p' });
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    cell.focus();
    fireEvent.click(cell);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('read-only renders aria-selected cells and no buttons', () => {
    render(<FreeTimeGrid label="Free" value={[136]} readOnly />);
    expect(within(screen.getByRole('grid')).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('gridcell', { name: 'Tue 8p' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('gridcell', { name: 'Tue 9p' })).toHaveAttribute('aria-selected', 'false');
  });

  const tabStops = () => within(screen.getByRole('grid')).getAllByRole('button').filter((b) => b.tabIndex === 0);

  it('is one Tab stop: only the first selected cell is tabbable', () => {
    render(<FreeTimeGrid label="Free" value={[136, 200]} onChange={() => {}} />);
    expect(within(screen.getByRole('grid')).getAllByRole('button')).toHaveLength(336);
    expect(tabStops().map((b) => b.getAttribute('aria-label'))).toEqual(['Tue 8p']);
  });

  it('with nothing selected, Sun 12a is the Tab stop', () => {
    render(<FreeTimeGrid label="Free" value={[]} onChange={() => {}} />);
    expect(tabStops().map((b) => b.getAttribute('aria-label'))).toEqual(['Sun 12a']);
  });

  it('arrow keys, Home and End move focus and the Tab stop; activating toggles the focused cell', () => {
    const onChange = vi.fn();
    render(<FreeTimeGrid label="Free" value={[136]} onChange={onChange} />);
    const cell = (name: string) => screen.getByRole('button', { name });
    const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });
    cell('Tue 8p').focus();
    key('ArrowRight');
    expect(cell('Wed 8p')).toHaveFocus();
    key('ArrowDown');
    expect(cell('Wed 8:30p')).toHaveFocus();
    key('ArrowLeft');
    key('ArrowUp');
    key('ArrowUp');
    expect(cell('Tue 7:30p')).toHaveFocus();
    key('End');
    expect(cell('Sat 7:30p')).toHaveFocus();
    key('ArrowRight');
    expect(cell('Sat 7:30p')).toHaveFocus();
    key('Home');
    expect(cell('Sun 7:30p')).toHaveFocus();
    expect(tabStops()).toEqual([cell('Sun 7:30p')]);
    // jsdom does not turn Enter/Space on a button into a click; a click without a mouse press is that activation.
    fireEvent.click(document.activeElement!);
    expect(onChange).toHaveBeenLastCalledWith([39, 136]);
  });

  it('a fast drag applies every cell entered before a re-render', () => {
    const onChange = vi.fn();
    render(<FreeTimeGrid label="Free" value={[]} onChange={onChange} />);
    const cell = (name: string) => screen.getByRole('button', { name });
    fireEvent.mouseDown(cell('Tue 8p'));
    fireEvent.mouseEnter(cell('Tue 8:30p'));
    fireEvent.mouseEnter(cell('Tue 9p'));
    fireEvent.mouseEnter(cell('Tue 9:30p'));
    fireEvent.mouseUp(window);
    expect(onChange).toHaveBeenLastCalledWith([136, 137, 138, 139]);
  });

  it('describedBy sets aria-describedby on the grid', () => {
    render(<FreeTimeGrid label="Free" value={[]} onChange={() => {}} describedBy="hint-1" />);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-describedby', 'hint-1');
  });
});
