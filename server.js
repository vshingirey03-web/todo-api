const path = require("path");
const crypto = require("crypto");
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

// Миграция: добавляем в старую таблицу столбец "владелец задачи"
const columns = db.prepare("PRAGMA table_info(tasks)").all().map((c) => c.name);
if (!columns.includes("user_id")) {
  db.exec("ALTER TABLE tasks ADD COLUMN user_id INTEGER");
}
// Миграция: отметка "выполнено" и ссылка на родительскую задачу (для подпунктов)
if (!columns.includes("done")) {
  db.exec("ALTER TABLE tasks ADD COLUMN done INTEGER NOT NULL DEFAULT 0");
}
if (!columns.includes("parent_id")) {
  db.exec("ALTER TABLE tasks ADD COLUMN parent_id INTEGER");
}

// Таблицы пользователей и сессий (токенов входа)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL
  );
`);

// Пароль хранится не как есть, а в виде "соль:хэш"
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// Регистрация
app.post("/register", (req, res) => {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (username.length < 3) {
    return res.status(400).json({ error: "Имя не короче 3 символов" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Пароль не короче 6 символов" });
  }

  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) {
    return res.status(409).json({ error: "Такое имя уже занято" });
  }

  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run(username, hashPassword(password));
  res.status(201).json({ message: "Пользователь создан" });
});

// Вход
app.post("/login", (req, res) => {
  const user = db.prepare("SELECT id, password_hash FROM users WHERE username = ?")
    .get(String(req.body.username));

  if (!user || !checkPassword(String(req.body.password), user.password_hash)) {
    return res.status(401).json({ error: "Неверное имя или пароль" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(token, user.id);
  res.json({ token: token });
});

// Проверка входа: ищем токен из заголовка Authorization: Bearer <токен>
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = db.prepare("SELECT user_id FROM sessions WHERE token = ?").get(token);

  if (!session) {
    return res.status(401).json({ error: "Нужно войти" });
  }

  req.userId = session.user_id;
  next();
}

// Проверка текста задачи (одна и та же при добавлении и редактировании)
function checkText(text) {
  if (text.length === 0) {
    return "Текст задачи не может быть пустым";
  }
  if (text.length > MAX_TASK_LENGTH) {
    return "Слишком длинный текст (максимум " + MAX_TASK_LENGTH + " символов)";
  }
  return null;
}

// Превращаем строку из базы в объект для клиента (done: 0/1 -> false/true)
function toTask(row) {
  return { id: row.id, text: row.text, done: row.done === 1, parent_id: row.parent_id };
}

// Получить задачи текущего пользователя (подпункты ссылаются на родителя через parent_id)
app.get("/tasks", auth, (req, res) => {
  const rows = db
    .prepare("SELECT id, text, done, parent_id FROM tasks WHERE user_id = ? ORDER BY id")
    .all(req.userId);
  res.json(rows.map(toTask));
});

// Добавить задачу или подпункт (если передан parent_id)
app.post("/tasks", auth, (req, res) => {
  const body = req.body || {};
  const text = typeof body.text === "string" ? body.text.trim() : "";

  const error = checkText(text);
  if (error) {
    return res.status(400).json({ error: error });
  }

  let parentId = null;
  if (body.parent_id !== undefined && body.parent_id !== null) {
    parentId = Number(body.parent_id);
    if (!Number.isInteger(parentId)) {
      return res.status(400).json({ error: "Неверный parent_id" });
    }
    const parent = db
      .prepare("SELECT id, parent_id FROM tasks WHERE id = ? AND user_id = ?")
      .get(parentId, req.userId);
    if (!parent) {
      return res.status(404).json({ error: "Родительская задача не найдена" });
    }
    if (parent.parent_id !== null) {
      return res.status(400).json({ error: "Подпункт нельзя вложить в подпункт" });
    }
  }

  const result = db
    .prepare("INSERT INTO tasks (text, user_id, parent_id) VALUES (?, ?, ?)")
    .run(text, req.userId, parentId);
  res.status(201).json({ id: Number(result.lastInsertRowid), text: text, done: false, parent_id: parentId });
});

// Изменить свою задачу: текст и/или отметку "выполнено"
app.patch("/tasks/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};

  const task = db.prepare("SELECT id FROM tasks WHERE id = ? AND user_id = ?").get(id, req.userId);
  if (!task) {
    return res.status(404).json({ error: "Задача не найдена" });
  }

  // Сначала проверяем всё, потом меняем (чтобы не применить половину изменений)
  let newText = null;
  if (body.text !== undefined) {
    newText = typeof body.text === "string" ? body.text.trim() : "";
    const error = checkText(newText);
    if (error) {
      return res.status(400).json({ error: error });
    }
  }
  if (body.done !== undefined && typeof body.done !== "boolean") {
    return res.status(400).json({ error: "Поле done должно быть true или false" });
  }

  if (newText !== null) {
    db.prepare("UPDATE tasks SET text = ? WHERE id = ?").run(newText, id);
  }
  if (body.done !== undefined) {
    db.prepare("UPDATE tasks SET done = ? WHERE id = ?").run(body.done ? 1 : 0, id);
  }

  const row = db.prepare("SELECT id, text, done, parent_id FROM tasks WHERE id = ?").get(id);
  res.json(toTask(row));
});

// Удалить свою задачу вместе с её подпунктами (чужую удалить нельзя)
app.delete("/tasks/:id", auth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM tasks WHERE (id = ? OR parent_id = ?) AND user_id = ?").run(id, id, req.userId);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log("Сервер запущен: http://localhost:" + PORT);
});
