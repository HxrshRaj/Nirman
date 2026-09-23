import React from 'react';
import { TaskItem } from './TaskItem';

export function TaskList({ tasks, onToggle }) {
  if (tasks.length === 0) {
    return <p className="empty">No tasks yet.</p>;
  }
  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} onToggle={onToggle} />
      ))}
    </ul>
  );
}
