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
});
