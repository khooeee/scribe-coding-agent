import { FormEvent, useState } from "react";

type Task = {
  id: string;
  text: string;
};

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");

  function addTask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setTasks((prev) => [...prev, { id: crypto.randomUUID(), text: trimmed }]);
    setDraft("");
  }

  function deleteTask(id: string) {
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addTask(draft);
  }

  return (
    <main className="shell">
      <p className="eyebrow">To-do</p>
      <h1>Tasks</h1>
      <p className="lede">Add items, check them off your list, or remove what you no longer need.</p>

      <form className="todo-form" onSubmit={handleSubmit}>
        <input
          type="text"
          name="task"
          placeholder="Add a task"
          aria-label="Add a task"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" aria-label="Add task">
          Add
        </button>
      </form>

      {tasks.length === 0 ? (
        <p className="empty-state">No tasks yet. Add one above.</p>
      ) : (
        <ul className="todo-list" aria-label="Task list">
          {tasks.map((task) => (
            <li key={task.id} className="todo-item">
              <span>{task.text}</span>
              <button
                type="button"
                className="delete-btn"
                aria-label={`Delete ${task.text}`}
                onClick={() => deleteTask(task.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
