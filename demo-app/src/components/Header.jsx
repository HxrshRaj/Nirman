import React from 'react';

export function Header({ pendingCount }) {
  return (
    <header className="app-header">
      <h1>Nirman Task Board</h1>
      <p>{pendingCount} task{pendingCount === 1 ? '' : 's'} left</p>
    </header>
  );
}
