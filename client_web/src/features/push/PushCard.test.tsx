// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PushCard } from './PushCard';

afterEach(cleanup);
describe('browser notification controls', () => {
  it('requests notification permission only when the user presses enable', () => {
    const enable = vi.fn(async () => undefined);
    render(
      <PushCard
        state="default"
        error=""
        enable={enable}
        retry={async () => undefined}
        disable={async () => undefined}
      />,
    );
    expect(enable).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Enable notifications' }),
    );
    expect(enable).toHaveBeenCalledTimes(1);
  });
  it('explains a denied permission', () => {
    render(
      <PushCard
        state="denied"
        error=""
        enable={async () => undefined}
        retry={async () => undefined}
        disable={async () => undefined}
      />,
    );
    expect(screen.getByText(/Notifications are blocked/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Enable notifications' }),
    ).toBeNull();
  });
});
