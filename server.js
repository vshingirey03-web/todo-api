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
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE");
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

// Получить задачи текущего пользователя
app.get("/tasks", auth, (req, res) => {
  const tasks = db.prepare("SELECT id, text FROM tasks WHERE user_id = ?").all(req.userId);
  res.json(tasks);
});

// Добавить задачу
app.post("/tasks", auth, (req, res) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";

  // Проверка входных данных: пустой текст не принимаем
  if (text.length === 0) {
    return res.status(400).json({ error: "Текст задачи не может быть пустым" });
  }

  // ...и слишком длинный тоже
  if (text.length > MAX_TASK_LENGTH) {
    return res.status(400).json({ error: "Слишком длинный текст (максимум " + MAX_TASK_LENGTH + " символов)" });
  }

  const result = db.prepare("INSERT INTO tasks (text, user_id) VALUES (?, ?)").run(text, req.userId);
  res.status(201).json({ id: Number(result.lastInsertRowid), text: text });
});

// Удалить свою задачу (чужую удалить нельзя)
app.delete("/tasks/:id", auth, (req, res) => {
  db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.userId);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log("Сервер запущен: http://localhost:" + PORT);
});
