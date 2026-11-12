/**
 * @vitest-environment jsdom
 */

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchableModelSelect } from '../src/options/components/SearchableModelSelect';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function renderSelect() {
  const onChange = vi.fn();
  function Harness() {
    const [model, setModel] = React.useState('chat-alpha');
    return (
      <>
        <label htmlFor="model">Model</label>
        <SearchableModelSelect
          id="model"
          models={['chat-alpha', 'chat-beta']}
          value={model}
          onChange={(value) => {
            onChange(value);
            setModel(value);
          }}
        />
        <button type="button">Outside</button>
      </>
    );
  }
  render(<Harness />);
  return { input: screen.getByRole('combobox', { name: 'Model' }), onChange };
}

describe('SearchableModelSelect', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it.each(['Enter', 'Escape', 'blur'])('preserves a manually entered model on %s', (action) => {
    const { input, onChange } = renderSelect();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'custom-unlisted-model' } });
    if (action === 'blur') fireEvent.blur(input, { relatedTarget: screen.getByRole('button') });
    else fireEvent.keyDown(input, { key: action });
    expect((input as HTMLInputElement).value).toBe('custom-unlisted-model');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('custom-unlisted-model');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('selects a filtered model with the keyboard', () => {
    const { input, onChange } = renderSelect();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'beta' } });
    expect(screen.getByRole('option', { name: 'chat-beta' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'chat-alpha' })).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('chat-beta');
    expect((input as HTMLInputElement).value).toBe('chat-beta');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('selects an available model with the mouse without losing the choice on blur', () => {
    const { input, onChange } = renderSelect();
    fireEvent.focus(input);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'chat-beta' }));
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('chat-beta');
    expect((input as HTMLInputElement).value).toBe('chat-beta');
  });
});
