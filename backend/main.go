package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

type contextKey string

const userIDKey contextKey = "userID"

const dateLayout = "2006-01-02"
const dateTimeLayout = "2006-01-02T15:04:05"

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)

type App struct {
	db        *sql.DB
	jwtSecret []byte
}

type User struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	CreatedAt string `json:"created_at"`
}

type Task struct {
	ID              int64  `json:"id"`
	UserID          int64  `json:"-"`
	Title           string `json:"title"`
	Description     string `json:"description"`
	StartAt         string `json:"start_at"`
	EndAt           string `json:"end_at"`
	DurationMinutes int    `json:"duration_minutes"`
	Priority        string `json:"priority"`
	Completed       bool   `json:"completed"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

type CalendarDaySummary struct {
	Date           string `json:"date"`
	TasksCount     int    `json:"tasks_count"`
	CompletedCount int    `json:"completed_count"`
	MaxPriority    string `json:"max_priority"`
}

func main() {
	dbPath := getEnv("DB_PATH", "planner.db")
	jwtSecret := []byte(getEnv("JWT_SECRET", "dev-secret-change-me"))

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := &App{db: db, jwtSecret: jwtSecret}
	if err := app.initDB(); err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", app.withCORS(app.healthHandler))
	mux.HandleFunc("/api/auth/register", app.withCORS(app.registerHandler))
	mux.HandleFunc("/api/auth/login", app.withCORS(app.loginHandler))
	mux.HandleFunc("/api/auth/me", app.withCORS(app.requireAuth(app.meHandler)))
	mux.HandleFunc("/api/auth/password", app.withCORS(app.requireAuth(app.passwordHandler)))
	mux.HandleFunc("/api/tasks", app.withCORS(app.requireAuth(app.tasksHandler)))
	mux.HandleFunc("/api/tasks/", app.withCORS(app.requireAuth(app.taskByIDHandler)))
	mux.HandleFunc("/api/calendar/summary", app.withCORS(app.requireAuth(app.calendarSummaryHandler)))

	addr := ":8080"
	log.Printf("Backend started at http://localhost%s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func (a *App) initDB() error {
	queries := []string{
		`PRAGMA foreign_keys = ON;`,
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS tasks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			start_at TEXT NOT NULL,
			end_at TEXT NOT NULL,
			duration_minutes INTEGER NOT NULL,
			priority TEXT NOT NULL DEFAULT 'medium',
			completed INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_user_start ON tasks(user_id, start_at);`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_user_end ON tasks(user_id, end_at);`,
	}
	for _, q := range queries {
		if _, err := a.db.Exec(q); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := getEnv("CORS_ORIGIN", "http://localhost:5173")
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func (a *App) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			writeError(w, http.StatusUnauthorized, "Необходима авторизация")
			return
		}
		tokenString := strings.TrimPrefix(auth, "Bearer ")
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, errors.New("invalid signing method")
			}
			return a.jwtSecret, nil
		})
		if err != nil || !token.Valid {
			writeError(w, http.StatusUnauthorized, "Недействительный токен")
			return
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			writeError(w, http.StatusUnauthorized, "Недействительный токен")
			return
		}
		userFloat, ok := claims["user_id"].(float64)
		if !ok {
			writeError(w, http.StatusUnauthorized, "Недействительный токен")
			return
		}
		ctx := context.WithValue(r.Context(), userIDKey, int64(userFloat))
		next(w, r.WithContext(ctx))
	}
}

func (a *App) healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *App) registerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Метод не поддерживается")
		return
	}
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Некорректный JSON")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if err := validateUsername(req.Username); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !emailPattern.MatchString(req.Email) {
		writeError(w, http.StatusBadRequest, "Введите корректный email")
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var exists int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM users WHERE lower(email)=?`, req.Email).Scan(&exists)
	if exists > 0 {
		writeError(w, http.StatusConflict, "Пользователь с таким email уже зарегистрирован")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ошибка хеширования пароля")
		return
	}
	now := nowString()
	res, err := a.db.Exec(`INSERT INTO users(username, email, password_hash, created_at) VALUES (?, ?, ?, ?)`, req.Username, req.Email, string(hash), now)
	if err != nil {
		writeError(w, http.StatusConflict, "Пользователь с таким email уже зарегистрирован")
		return
	}
	id, _ := res.LastInsertId()
	token, _ := a.createToken(id)
	writeJSON(w, http.StatusCreated, map[string]interface{}{"token": token, "user": User{ID: id, Username: req.Username, Email: req.Email, CreatedAt: now}})
}

func (a *App) loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Метод не поддерживается")
		return
	}
	var req struct {
		Email    string `json:"email"`
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Некорректный JSON")
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" {
		email = strings.TrimSpace(strings.ToLower(req.Login))
	}
	var user User
	var passwordHash string
	err := a.db.QueryRow(`SELECT id, username, email, password_hash, created_at FROM users WHERE lower(email)=?`, email).
		Scan(&user.ID, &user.Username, &user.Email, &passwordHash, &user.CreatedAt)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)) != nil {
		writeError(w, http.StatusUnauthorized, "Неверный email или пароль")
		return
	}
	token, _ := a.createToken(user.ID)
	writeJSON(w, http.StatusOK, map[string]interface{}{"token": token, "user": user})
}

func (a *App) meHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.getMe(w, r)
	case http.MethodPut:
		a.updateMe(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "Метод не поддерживается")
	}
}

func (a *App) getMe(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)
	var user User
	err := a.db.QueryRow(`SELECT id, username, email, created_at FROM users WHERE id=?`, uid).Scan(&user.ID, &user.Username, &user.Email, &user.CreatedAt)
	if err != nil {
		writeError(w, http.StatusNotFound, "Пользователь не найден")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (a *App) updateMe(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Некорректный JSON")
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if err := validateUsername(req.Username); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !emailPattern.MatchString(req.Email) {
		writeError(w, http.StatusBadRequest, "Введите корректный email")
		return
	}
	var exists int
	_ = a.db.QueryRow(`SELECT COUNT(*) FROM users WHERE lower(email)=? AND id<>?`, req.Email, uid).Scan(&exists)
	if exists > 0 {
		writeError(w, http.StatusConflict, "Пользователь с таким email уже зарегистрирован")
		return
	}
	res, err := a.db.Exec(`UPDATE users SET username=?, email=? WHERE id=?`, req.Username, req.Email, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ошибка обновления профиля")
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "Пользователь не найден")
		return
	}
	var user User
	_ = a.db.QueryRow(`SELECT id, username, email, created_at FROM users WHERE id=?`, uid).Scan(&user.ID, &user.Username, &user.Email, &user.CreatedAt)
	writeJSON(w, http.StatusOK, user)
}

func (a *App) passwordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "Метод не поддерживается")
		return
	}
	uid := getUserID(r)
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Некорректный JSON")
		return
	}
	if err := validatePassword(req.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var currentHash string
	err := a.db.QueryRow(`SELECT password_hash FROM users WHERE id=?`, uid).Scan(&currentHash)
	if err != nil {
		writeError(w, http.StatusNotFound, "Пользователь не найден")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.OldPassword)) != nil {
		writeError(w, http.StatusUnauthorized, "Старый пароль указан неверно")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ошибка хеширования пароля")
		return
	}
	_, err = a.db.Exec(`UPDATE users SET password_hash=? WHERE id=?`, string(newHash), uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ошибка изменения пароля")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Пароль изменён"})
}

func (a *App) tasksHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		a.getTasks(w, r)
	case http.MethodPost:
		a.createTask(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "Метод не поддерживается")
	}
}

func (a *App) getTasks(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)
	dateStr := r.URL.Query().Get("date")
	if dateStr == "" {
		dateStr = time.Now().Format(dateLayout)
	}
	day, err := time.ParseInLocation(dateLayout, dateStr, time.Local)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Дата должна быть в формате YYYY-MM-DD")
		return
	}
	if !dateAllowed(day) {
		writeError(w, http.StatusForbidden, "Можно просматривать последние 30 дней и следующие 365 дней")
		return
	}
	dayStart := day.Format(dateTimeLayout)
	dayEnd := day.Add(24 * time.Hour).Format(dateTimeLayout)
	rows, err := a.db.Query(`SELECT id, user_id, title, description, start_at, end_at, duration_minutes, priority, completed, created_at, updated_at
		FROM tasks WHERE user_id=? AND start_at < ? AND end_at > ? ORDER BY start_at, id`, uid, dayEnd, dayStart)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ошибка получения задач")
		return
	}
	defer rows.Close()
	tasks := []Task{}
	for rows.Next() {
		var t Task
		var completed int
		if err := rows.Scan(&t.ID, &t.UserID, &t.Title, &t.Description, &t.StartAt, &t.EndAt, &t.DurationMinutes, &t.Priority, &completed, &t.CreatedAt, &t.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "Ошибка чтения задач")
			return
		}
		t.Completed = completed == 1
		tasks = append(tasks, t)
	}
	writeJSON(w, http.StatusOK, tasks)
}

func (a *App) createTask(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)
	task, err := decodeTaskRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	start, _ := parseDateTime(task.StartAt)
	if !dateAllowed(start) {
		writeError(w, http.StatusForbidden, "Можно планировать только в диапазоне: последние 30 дней — следующие 365 дней")
		return
	}
	end := start.Add(time.Duration(task.DurationMinutes) * time.Minute)
	now := nowString()
	res, err := a.db.Exec(`INSERT INTO tasks(user_id, title, description, start_at, end_at, duration_minutes, priority, completed, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`, uid, task.Title, task.Description, start.Format(dateTimeLayout), end.Format(dateTimeLayout), task.DurationMinutes, task.Priority, now, now)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ошибка создания задачи")
		return
	}
	id, _ := res.LastInsertId()
	task.ID = id
	task.UserID = uid
	task.EndAt = end.Format(dateTimeLayout)
	task.CreatedAt = now
	task.UpdatedAt = now
	writeJSON(w, http.StatusCreated, task)
}

func (a *App) taskByIDHandler(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/tasks/")
	parts := strings.Split(strings.Trim(idStr, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusNotFound, "Задача не найдена")
		return
	}
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Некорректный ID задачи")
		return
	}
	if len(parts) == 2 && parts[1] == "complete" && r.Method == http.MethodPatch {
		a.completeTask(w, r, id)
		return
	}
	switch r.Method {
	case http.MethodPut:
		a.updateTask(w, r, id)
	case http.MethodDelete:
		a.deleteTask(w, r, id)
	default:
		writeError(w, http.StatusMethodNotAllowed, "Метод не поддерживается")
	}
}

func (a *App) updateTask(w http.ResponseWriter, r *http.Request, taskID int64) {
	uid := getUserID(r)
	task, err := decodeTaskRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	start, _ := parseDateTime(task.StartAt)
	if !dateAllowed(start) {
		writeError(w, http.StatusForbidden, "Можно редактировать задачи только в разрешённом диапазоне")
		return
	}
	end := start.Add(time.Duration(task.DurationMinutes) * time.Minute)
	now := nowString()
	res, err := a.db.Exec(`UPDATE tasks SET title=?, description=?, start_at=?, end_at=?, duration_minutes=?, priority=?, updated_at=? WHERE id=? AND user_id=?`,
		task.Title, task.Description, start.Format(dateTimeLayout), end.Format(dateTimeLayout), task.DurationMinutes, task.Priority, now, taskID, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ошибка обновления задачи")
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "Задача не найдена")
		return
	}
	task.ID = taskID
	task.UserID = uid
	task.EndAt = end.Format(dateTimeLayout)
	task.UpdatedAt = now
	writeJSON(w, http.StatusOK, task)
}

func (a *App) completeTask(w http.ResponseWriter, r *http.Request, taskID int64) {
	uid := getUserID(r)
	var req struct {
		Completed bool `json:"completed"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Некорректный JSON")
		return
	}
	completed := 0
	if req.Completed {
		completed = 1
	}
	res, err := a.db.Exec(`UPDATE tasks SET completed=?, updated_at=? WHERE id=? AND user_id=?`, completed, nowString(), taskID, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ошибка обновления статуса")
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "Задача не найдена")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Статус обновлён"})
}

func (a *App) deleteTask(w http.ResponseWriter, r *http.Request, taskID int64) {
	uid := getUserID(r)
	res, err := a.db.Exec(`DELETE FROM tasks WHERE id=? AND user_id=?`, taskID, uid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ошибка удаления задачи")
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		writeError(w, http.StatusNotFound, "Задача не найдена")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Задача удалена"})
}

func (a *App) calendarSummaryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Метод не поддерживается")
		return
	}
	uid := getUserID(r)
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	from, err1 := time.ParseInLocation(dateLayout, fromStr, time.Local)
	to, err2 := time.ParseInLocation(dateLayout, toStr, time.Local)
	if err1 != nil || err2 != nil || to.Before(from) {
		writeError(w, http.StatusBadRequest, "Параметры from/to должны быть в формате YYYY-MM-DD")
		return
	}
	if to.Sub(from).Hours()/24 > 450 {
		writeError(w, http.StatusBadRequest, "Слишком большой диапазон календаря")
		return
	}
	rangeStart := from.Format(dateTimeLayout)
	rangeEnd := to.Add(24 * time.Hour).Format(dateTimeLayout)
	rows, err := a.db.Query(`SELECT start_at, end_at, priority, completed FROM tasks WHERE user_id=? AND start_at < ? AND end_at > ?`, uid, rangeEnd, rangeStart)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Ошибка получения календаря")
		return
	}
	defer rows.Close()
	summary := map[string]*CalendarDaySummary{}
	for rows.Next() {
		var startStr, endStr, priority string
		var completed int
		if err := rows.Scan(&startStr, &endStr, &priority, &completed); err != nil {
			writeError(w, http.StatusInternalServerError, "Ошибка чтения календаря")
			return
		}
		start, _ := parseDateTime(startStr)
		end, _ := parseDateTime(endStr)
		for d := truncateDay(maxTime(start, from)); d.Before(to.Add(24 * time.Hour)); d = d.Add(24 * time.Hour) {
			dayStart := d
			dayEnd := d.Add(24 * time.Hour)
			if start.Before(dayEnd) && end.After(dayStart) {
				key := d.Format(dateLayout)
				item := summary[key]
				if item == nil {
					item = &CalendarDaySummary{Date: key, MaxPriority: "low"}
					summary[key] = item
				}
				item.TasksCount++
				if completed == 1 {
					item.CompletedCount++
				}
				item.MaxPriority = maxPriority(item.MaxPriority, priority)
			}
			if !d.Before(end) {
				break
			}
		}
	}
	result := []CalendarDaySummary{}
	for d := from; !d.After(to); d = d.Add(24 * time.Hour) {
		if item := summary[d.Format(dateLayout)]; item != nil {
			result = append(result, *item)
		}
	}
	writeJSON(w, http.StatusOK, result)
}

func decodeTaskRequest(r *http.Request) (Task, error) {
	var req struct {
		Title           string `json:"title"`
		Description     string `json:"description"`
		StartAt         string `json:"start_at"`
		DurationMinutes int    `json:"duration_minutes"`
		Priority        string `json:"priority"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return Task{}, errors.New("Некорректный JSON")
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	if req.Title == "" {
		return Task{}, errors.New("Название задачи обязательно")
	}
	if _, err := parseDateTime(req.StartAt); err != nil {
		return Task{}, errors.New("Дата и время должны быть в формате YYYY-MM-DDTHH:MM:SS")
	}
	if req.DurationMinutes < 5 || req.DurationMinutes > 10080 {
		return Task{}, errors.New("Минимальное время для задачи - 5 минут")
	}
	if req.Priority != "low" && req.Priority != "medium" && req.Priority != "high" {
		req.Priority = "medium"
	}
	return Task{Title: req.Title, Description: req.Description, StartAt: normalizeDateTime(req.StartAt), DurationMinutes: req.DurationMinutes, Priority: req.Priority}, nil
}

func validateUsername(username string) error {
	if len([]rune(username)) < 3 {
		return errors.New("Имя пользователя должно содержать минимум 3 символа")
	}
	if len([]rune(username)) > 20 {
		return errors.New("Имя пользователя должно быть не длиннее 20 символов")
	}
	return nil
}

func validatePassword(password string) error {
	if len(password) < 8 {
		return errors.New("Пароль должен содержать минимум 8 символов")
	}
	if !isAllowedPasswordASCII(password) {
		return errors.New("Пароль может содержать только английские буквы, цифры и специальные символы")
	}
	if !regexp.MustCompile(`[A-Z]`).MatchString(password) {
		return errors.New("Пароль должен содержать минимум 1 заглавную английскую букву")
	}
	if !regexp.MustCompile(`[a-z]`).MatchString(password) {
		return errors.New("Пароль должен содержать минимум 1 строчную английскую букву")
	}
	if !regexp.MustCompile(`[0-9]`).MatchString(password) {
		return errors.New("Пароль должен содержать минимум 1 цифру")
	}
	if !regexp.MustCompile(`[!@#$%^&*()_+\-=\[\]{};:'",.<>/?\\|` + "`" + `~]`).MatchString(password) {
		return errors.New("Пароль должен содержать минимум 1 специальный символ")
	}
	return nil
}

func isAllowedPasswordASCII(password string) bool {
	for _, r := range password {
		if r < 33 || r > 126 {
			return false
		}
	}
	return true
}

func (a *App) createToken(userID int64) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(7 * 24 * time.Hour).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(a.jwtSecret)
}

func dateAllowed(day time.Time) bool {
	today := truncateDay(time.Now())
	minDate := today.AddDate(0, 0, -30)
	maxDate := today.AddDate(1, 0, 0)
	d := truncateDay(day)
	return !d.Before(minDate) && !d.After(maxDate)
}

func parseDateTime(value string) (time.Time, error) {
	value = normalizeDateTime(value)
	return time.ParseInLocation(dateTimeLayout, value, time.Local)
}

func normalizeDateTime(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 19 {
		return value[:19]
	}
	if len(value) == 16 {
		return value + ":00"
	}
	return value
}

func truncateDay(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.Local)
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func maxPriority(a, b string) string {
	rank := map[string]int{"low": 1, "medium": 2, "high": 3}
	if rank[b] > rank[a] {
		return b
	}
	return a
}

func getUserID(r *http.Request) int64 {
	id, _ := r.Context().Value(userIDKey).(int64)
	return id
}

func nowString() string {
	return time.Now().Format(dateTimeLayout)
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func debugf(format string, args ...interface{}) {
	if os.Getenv("DEBUG") == "1" {
		fmt.Printf(format+"\n", args...)
	}
}
