const express = require("express");
const app = express();
const PORT = 3000;

app.use(express.json());

// Разрешаем запросы с другого адреса (React на порту 5173)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

let tasks = [
  { id: 1, text: "Купить хлеб" },
  { id: 2, text: "Выучить Express" },
];

// Получить все задачи
app.get("/tasks", (req, res) => {
  res.json(tasks);
});

// Добавить задачу
app.post("/tasks", (req, res) => {
  const newTask = { id: Date.now(), text: req.body.text };
  tasks.push(newTask);
  res.status(201).json(newTask);
});

// Удалить задачу
app.delete("/tasks/:id", (req, res) => {
  const id = Number(req.params.id);
  tasks = tasks.filter((task) => task.id !== id);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log("Сервер запущен: http://localhost:" + PORT);
});
