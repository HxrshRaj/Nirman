import React, { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { TaskList } from './components/TaskList';
import { fetchTasks, toggleTaskOnServer } from './api';
import './app.css';

export function App() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchTasks().then((result) => {
      if (!cancelled) {
        setTasks(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = (id) => {
    const task = tasks.find((t) => t.id === id);
    const nextDone = !task.done;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: nextDone } : t)));
    toggleTaskOnServer(id, nextDone);
  };

  const pendingCount = tasks.filter((t) => !t.done).length;

  return (
    <div className="app">
      <Header pendingCount={pendingCount} />
      {loading ? <p className="loading">Loading tasks...</p> : <TaskList tasks={tasks} onToggle={handleToggle} />}
      <footer className="app-footer">
        Bundled by <a href="https://github.com/HarshRaj-1509/Nirman">Nirman</a>, a build tool written from scratch.
      </footer>
    </div>
  );
}
