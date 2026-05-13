package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

type apiResponse map[string]interface{}

func newTestApp(t *testing.T) (*App, http.Handler) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test-planner.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	app := &App{db: db, jwtSecret: []byte("test-secret")}
	if err := app.initDB(); err != nil {
		t.Fatalf("init db: %v", err)
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
	return app, mux
}

func performJSON(t *testing.T, handler http.Handler, method, path string, token string, body interface{}) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

func decodeBody(t *testing.T, rr *httptest.ResponseRecorder) apiResponse {
	t.Helper()
	var payload apiResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response %q: %v", rr.Body.String(), err)
	}
	return payload
}

func registerTestUser(t *testing.T, handler http.Handler, username, email string) string {
	t.Helper()
	rr := performJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]string{
		"username": username,
		"email":    email,
		"password": "Admin123!",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body = %s", rr.Code, rr.Body.String())
	}
	payload := decodeBody(t, rr)
	token, ok := payload["token"].(string)
	if !ok || token == "" {
		t.Fatalf("register response has no token: %v", payload)
	}
	return token
}

func todayAt(hour, minute int) string {
	now := time.Now()
	return time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, time.Local).Format(dateTimeLayout)
}

func TestIntegrationRegisterRejectsDuplicateEmail(t *testing.T) {
	_, handler := newTestApp(t)
	email := "duplicate@example.com"
	_ = registerTestUser(t, handler, "User One", email)

	rr := performJSON(t, handler, http.MethodPost, "/api/auth/register", "", map[string]string{
		"username": "User Two",
		"email":    email,
		"password": "Admin123!",
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("duplicate register status = %d, want %d, body = %s", rr.Code, http.StatusConflict, rr.Body.String())
	}
}

func TestIntegrationLoginUsesEmailAndReturnsToken(t *testing.T) {
	_, handler := newTestApp(t)
	email := "login@example.com"
	_ = registerTestUser(t, handler, "Login User", email)

	rr := performJSON(t, handler, http.MethodPost, "/api/auth/login", "", map[string]string{
		"email":    email,
		"password": "Admin123!",
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("login status = %d, body = %s", rr.Code, rr.Body.String())
	}
	payload := decodeBody(t, rr)
	if payload["token"] == "" {
		t.Fatalf("login response has no token: %v", payload)
	}
}

func TestIntegrationTasksAreIsolatedByUser(t *testing.T) {
	_, handler := newTestApp(t)
	tokenA := registerTestUser(t, handler, "Same Name", "user-a@example.com")
	tokenB := registerTestUser(t, handler, "Same Name", "user-b@example.com")

	createA := performJSON(t, handler, http.MethodPost, "/api/tasks", tokenA, map[string]interface{}{
		"title":            "Task A",
		"description":      "Private task A",
		"start_at":         todayAt(9, 0),
		"duration_minutes": 30,
		"priority":         "high",
	})
	if createA.Code != http.StatusCreated {
		t.Fatalf("create task A status = %d, body = %s", createA.Code, createA.Body.String())
	}
	createB := performJSON(t, handler, http.MethodPost, "/api/tasks", tokenB, map[string]interface{}{
		"title":            "Task B",
		"description":      "Private task B",
		"start_at":         todayAt(10, 0),
		"duration_minutes": 30,
		"priority":         "low",
	})
	if createB.Code != http.StatusCreated {
		t.Fatalf("create task B status = %d, body = %s", createB.Code, createB.Body.String())
	}

	date := time.Now().Format(dateLayout)
	listA := performJSON(t, handler, http.MethodGet, "/api/tasks?date="+date, tokenA, nil)
	if listA.Code != http.StatusOK {
		t.Fatalf("list A status = %d, body = %s", listA.Code, listA.Body.String())
	}
	var tasksA []Task
	if err := json.Unmarshal(listA.Body.Bytes(), &tasksA); err != nil {
		t.Fatalf("decode tasks A: %v", err)
	}
	if len(tasksA) != 1 || tasksA[0].Title != "Task A" {
		t.Fatalf("user A tasks = %+v, want only Task A", tasksA)
	}

	listB := performJSON(t, handler, http.MethodGet, "/api/tasks?date="+date, tokenB, nil)
	if listB.Code != http.StatusOK {
		t.Fatalf("list B status = %d, body = %s", listB.Code, listB.Body.String())
	}
	var tasksB []Task
	if err := json.Unmarshal(listB.Body.Bytes(), &tasksB); err != nil {
		t.Fatalf("decode tasks B: %v", err)
	}
	if len(tasksB) != 1 || tasksB[0].Title != "Task B" {
		t.Fatalf("user B tasks = %+v, want only Task B", tasksB)
	}
}

func TestIntegrationTaskCanCrossMidnightAndAppearOnBothDays(t *testing.T) {
	_, handler := newTestApp(t)
	token := registerTestUser(t, handler, "Planner", "planner@example.com")

	now := time.Now()
	start := time.Date(now.Year(), now.Month(), now.Day(), 23, 0, 0, 0, time.Local)
	rr := performJSON(t, handler, http.MethodPost, "/api/tasks", token, map[string]interface{}{
		"title":            "Night task",
		"description":      "Crosses midnight",
		"start_at":         start.Format(dateTimeLayout),
		"duration_minutes": 120,
		"priority":         "medium",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create cross-midnight task status = %d, body = %s", rr.Code, rr.Body.String())
	}

	for _, day := range []string{start.Format(dateLayout), start.Add(24 * time.Hour).Format(dateLayout)} {
		list := performJSON(t, handler, http.MethodGet, "/api/tasks?date="+day, token, nil)
		if list.Code != http.StatusOK {
			t.Fatalf("list %s status = %d, body = %s", day, list.Code, list.Body.String())
		}
		var tasks []Task
		if err := json.Unmarshal(list.Body.Bytes(), &tasks); err != nil {
			t.Fatalf("decode tasks for %s: %v", day, err)
		}
		if len(tasks) != 1 || tasks[0].Title != "Night task" {
			t.Fatalf("tasks for %s = %+v, want Night task", day, tasks)
		}
	}
}

func TestIntegrationPasswordChangeRequiresOldPassword(t *testing.T) {
	_, handler := newTestApp(t)
	token := registerTestUser(t, handler, "Profile User", "profile@example.com")

	bad := performJSON(t, handler, http.MethodPut, "/api/auth/password", token, map[string]string{
		"old_password": "Wrong123!",
		"new_password": "Newpass123!",
	})
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("bad password change status = %d, want %d, body = %s", bad.Code, http.StatusUnauthorized, bad.Body.String())
	}

	ok := performJSON(t, handler, http.MethodPut, "/api/auth/password", token, map[string]string{
		"old_password": "Admin123!",
		"new_password": "Newpass123!",
	})
	if ok.Code != http.StatusOK {
		t.Fatalf("password change status = %d, body = %s", ok.Code, ok.Body.String())
	}
}
