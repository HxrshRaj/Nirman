import React from 'react';

export function TaskItem({ task, onToggle }) {
  return (
    <li className={task.done ? 'task task-done' : 'task'}>
      <label>
        <input type="checkbox" checked={task.done} onChange={() => onToggle(task.id)} />
        <span>{task.title}</span>
      </label>
    </li>
  );
}
