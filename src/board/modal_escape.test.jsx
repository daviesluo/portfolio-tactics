// @vitest-environment jsdom
// Escape closes the newest modal alone (src/board/modals.jsx; Davies, 2026-11-23: "Transaction history里的ticker点进去后再退出应该是
// Transaction history页而不是主页"): a ticker's page over a list closes back onto the list, where every open modal used to close at once.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { Modal } from './modals.jsx';

afterEach(() => { cleanup(); });

function Two() {
  const [list, setList] = React.useState(true);
  const [page, setPage] = React.useState(true);
  return (
    <>
      {list && <Modal onClose={() => setList(false)}><div>the list</div></Modal>}
      {page && <Modal onClose={() => setPage(false)}><div>the page</div></Modal>}
    </>
  );
}

describe('Escape over stacked modals', () => {
  it('closes the newest alone, then the one under it', () => {
    const { queryByText } = render(<Two />);
    expect(queryByText('the list')).not.toBe(null);
    expect(queryByText('the page')).not.toBe(null);
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(queryByText('the page')).toBe(null);
    expect(queryByText('the list')).not.toBe(null);
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(queryByText('the list')).toBe(null);
  });
});
