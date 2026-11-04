const path = require("path");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");

const app = express();

// Настройки берём из файла .env (запуск: npm start)
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || "tasks.db";
const MAX_TASK_LENGTH = Number(process.env.MAX_TASK_LENGTH) || 200;

// Открываем (или создаём) файл базы данных рядом с сервером
const db = new DatabaseSync(path.join(__dirname, DB_FILE));

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
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";

  // Проверка входных данных: пустой текст не принимаем
  if (text.length === 0) {
    return res.status(400).json({ error: "Текст задачи не может быть пустым" });
  }

  // ...и слишком длинный тоже
  if (text.length > MAX_TASK_LENGTH) {
    return res.status(400).json({ error: "Слишком длинный текст (максимум " + MAX_TASK_LENGTH + " символов)" });
  }

  const result = db.prepare("INSERT INTO tasks (text) VALUES (?)").run(text);
  res.status(201).json({ id: Number(result.lastInsertRowid), text: text });
});

// Удалить задачу
app.delete("/tasks/:id", (req, res) => {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(Number(req.params.id));
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log("Сервер запущен: http://localhost:" + PORT);
});
