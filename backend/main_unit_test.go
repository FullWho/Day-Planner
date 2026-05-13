package main

import (
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestUnitValidateUsername(t *testing.T) {
	tests := []struct {
		name     string
		username string
		wantErr  bool
	}{
		{name: "valid 3 chars", username: "usr", wantErr: false},
		{name: "valid cyrillic", username: "Иван", wantErr: false},
		{name: "too short", username: "ab", wantErr: true},
		{name: "too long", username: strings.Repeat("a", 21), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateUsername(tt.username)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateUsername(%q) error = %v, wantErr %v", tt.username, err, tt.wantErr)
			}
		})
	}
}

func TestUnitEmailPattern(t *testing.T) {
	tests := []struct {
		email string
		want  bool
	}{
		{"user@example.com", true},
		{"admin.test@gmail.com", true},
		{"bad-email", false},
		{"test@", false},
		{"@mail.com", false},
		{"test@mail", false},
		{"test mail@example.com", false},
	}

	for _, tt := range tests {
		t.Run(tt.email, func(t *testing.T) {
			got := emailPattern.MatchString(tt.email)
			if got != tt.want {
				t.Fatalf("emailPattern.MatchString(%q) = %v, want %v", tt.email, got, tt.want)
			}
		})
	}
}

func TestUnitValidatePassword(t *testing.T) {
	tests := []struct {
		name     string
		password string
		wantErr  bool
	}{
		{name: "valid", password: "Admin123!", wantErr: false},
		{name: "too short", password: "A1!a", wantErr: true},
		{name: "no upper", password: "admin123!", wantErr: true},
		{name: "no lower", password: "ADMIN123!", wantErr: true},
		{name: "no digit", password: "Adminpass!", wantErr: true},
		{name: "no special", password: "Admin123", wantErr: true},
		{name: "cyrillic forbidden", password: "Админ123!", wantErr: true},
		{name: "space forbidden", password: "Admin 123!", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validatePassword(tt.password)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validatePassword(%q) error = %v, wantErr %v", tt.password, err, tt.wantErr)
			}
		})
	}
}

func TestUnitDecodeTaskRequestDurationLimits(t *testing.T) {
	tests := []struct {
		name     string
		duration int
		wantErr  bool
	}{
		{name: "minimum 5 minutes", duration: 5, wantErr: false},
		{name: "below minimum", duration: 4, wantErr: true},
		{name: "one day", duration: 24 * 60, wantErr: false},
		{name: "seven days", duration: 7 * 24 * 60, wantErr: false},
		{name: "above seven days", duration: 7*24*60 + 1, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := strings.NewReader(`{
				"title":"Task",
				"description":"Description",
				"start_at":"2026-01-01T10:00:00",
				"duration_minutes":` + strconv.Itoa(tt.duration) + `,
				"priority":"high"
			}`)
			req := httptest.NewRequest("POST", "/api/tasks", body)
			_, err := decodeTaskRequest(req)
			if (err != nil) != tt.wantErr {
				t.Fatalf("decodeTaskRequest(duration=%d) error = %v, wantErr %v", tt.duration, err, tt.wantErr)
			}
		})
	}
}
