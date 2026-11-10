import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChipGroup, MenuChip, ToggleChip } from '../src/components/ui/Chips';

const OPTS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function Group({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState('a');
  return (
    <ChipGroup
      label="Letters"
      options={OPTS}
      value={v}
      onChange={(n) => {
        setV(n);
        onChange(n);
      }}
    />
  );
}

describe('ChipGroup', () => {
  it('is a radiogroup and click selects', () => {
    const onChange = vi.fn();
    render(<Group onChange={onChange} />);
    expect(screen.getByRole('radiogroup', { name: 'Letters' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true');
  });

  it('ArrowRight moves focus and selection; only the checked chip is tabbable', () => {
    render(<Group />);
    const alpha = screen.getByRole('radio', { name: 'Alpha' });
    expect(alpha).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('tabindex', '-1');
    alpha.focus();
    fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    const beta = screen.getByRole('radio', { name: 'Beta' });
    expect(beta).toHaveFocus();
    expect(beta).toHaveAttribute('aria-checked', 'true');
    expect(beta).toHaveAttribute('tabindex', '0');
    expect(alpha).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(beta, { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveFocus();
  });
});

describe('ChipGroup wrap-around', () => {
  it('wraps from last to first and first to last', () => {
    const onChange = vi.fn();
    render(<Group onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Gamma' }));
    const gamma = screen.getByRole('radio', { name: 'Gamma' });
    gamma.focus();
    fireEvent.keyDown(gamma, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Alpha' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('c');
  });
});

describe('ToggleChip', () => {
  it('toggles aria-pressed', () => {
    function T() {
      const [p, setP] = useState(false);
      return (
        <ToggleChip pressed={p} onToggle={() => setP(!p)}>
          Open
        </ToggleChip>
      );
    }
    render(<T />);
    const b = screen.getByRole('button', { name: 'Open' });
    expect(b).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(b);
    expect(b).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('MenuChip', () => {
  const setup = (props: Partial<React.ComponentProps<typeof MenuChip>> = {}) => {
    const onChange = vi.fn();
    render(
      <MenuChip label="Boss" valueLabel={null} options={OPTS} value="" onChange={onChange} allLabel="All" {...props} />,
    );
    return { onChange, button: screen.getByRole('button', { name: /Boss/ }) };
  };

  it('opens on click with allLabel first', () => {
    const { button } = setup();
    expect(button).toHaveAttribute('aria-haspopup', 'listbox');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const opts = screen.getAllByRole('option');
    expect(opts.map((o) => o.textContent)).toEqual(['All', 'Alpha', 'Beta', 'Gamma']);
  });

  it('shows label: valueLabel when set', () => {
    const { button } = setup({ valueLabel: 'Beta', value: 'b' });
    expect(button).toHaveTextContent('Boss: Beta');
  });

  it('opens on Enter, ArrowDown + Enter picks', () => {
    const { button, onChange } = setup();
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('click on an option selects it', () => {
    const { button, onChange } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('Escape closes and returns focus', () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('outside mousedown closes', () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('disabled blocks opening', () => {
    const { button } = setup({ disabled: true });
    fireEvent.click(button);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('on open focuses the listbox, sets activedescendant and marks the selected option', () => {
    const { button } = setup({ valueLabel: 'Beta', value: 'b' });
    fireEvent.click(button);
    const list = screen.getByRole('listbox');
    expect(list).toHaveFocus();
    const beta = screen.getByRole('option', { name: 'Beta' });
    expect(beta).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false');
    expect(list.getAttribute('aria-activedescendant')).toBe(beta.id);
  });

  it('ArrowUp, Home, End move the active option; Space picks', () => {
    const { button, onChange } = setup({ valueLabel: 'Beta', value: 'b' });
    fireEvent.click(button);
    const list = screen.getByRole('listbox');
    const active = () => document.getElementById(list.getAttribute('aria-activedescendant')!)?.textContent;
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(active()).toBe('Alpha');
    fireEvent.keyDown(list, { key: 'End' });
    expect(active()).toBe('Gamma');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(active()).toBe('All');
    fireEvent.keyDown(list, { key: 'End' });
    fireEvent.keyDown(list, { key: ' ' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('Tab closes and returns focus to the button', () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
