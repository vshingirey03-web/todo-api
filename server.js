const path = require("path");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const PORT = 3000;

// Открываем (или создаём) файл базы данных рядом с сервером
const db = new DatabaseSync(path.join(__dirname, "tasks.db"));

// Создаём таблицу, если её ещё нет
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL
  )
`);

// Если таблица пустая, добавим две стартовые задачи
const count = db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n;
if (count === 0) {
  const insert = db.prepare("INSERT INTO tasks (text) VALUES (?)");
  insert.run("Купить хлеб");
  insert.run("Выучить Express");
}

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// Получить все задачи
app.get("/tasks", (req, res) => {
  const tasks = db.prepare("SELECT id, text FROM tasks").all();
  res.json(tasks);
});

// Добавить задачу
app.post("/tasks", (req, res) => {
  const result = db.prepare("INSERT INTO tasks (text) VALUES (?)").run(req.body.text);
  res.status(201).json({ id: Number(result.lastInsertRowid), text: req.body.text });
});

// Удалить задачу
app.delete("/tasks/:id", (req, res) => {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(Number(req.params.id));
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log("Сервер запущен: http://localhost:" + PORT);
});
