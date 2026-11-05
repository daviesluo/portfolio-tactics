// The Agents page as the public mirror carries it. The real page, its strategies, its Edge Functions
// and its records are not part of this repository; this stub keeps the menu entry and the app's lazy
// import of the page whole, so the app builds and its tests run without them.
import React from 'react';
import { Modal } from '../board/modals.jsx';

/** @param {{ hideValues?: boolean, onClose: () => void }} props */
export function AgentsModal({ onClose }) {
  return (
    <Modal onClose={onClose} size="lg">
      <header className="modal-head">
        <div><h2 className="modal-title mono">Agents (beta)</h2></div>
        <div className="modal-head-actions">
          <button className="btn-ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </header>
      <div className="modal-body ag-body">
        <div className="ag-empty dim">This page is not part of the public code.</div>
      </div>
    </Modal>
  );
}
