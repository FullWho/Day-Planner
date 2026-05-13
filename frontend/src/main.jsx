import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  LogOut,
  KeyRound,
  Moon,
  NotebookTabs,
  Pencil,
  Plus,
  Sun,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { api, clearToken, getToken, setToken } from './api/client';
import './styles.css';

const DAY_MINUTES = 24 * 60;
const PX_PER_MINUTE = 1.25;
const TIMELINE_HEIGHT = DAY_MINUTES * PX_PER_MINUTE;
const SHORT_TASK_MINUTES = 76;
const priorities = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
};

function pad(value) {
  return String(value).padStart(2, '0');
}

function toDateInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toDateTimeInput(date) {
  return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toBackendDateTime(value) {
  return value.length === 16 ? `${value}:00` : value;
}

function formatHumanDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTime(value) {
  const date = new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  return `${m} мин`;
}

function dateAllowed(dateStr) {
  const today = new Date();
  const current = new Date(`${dateStr}T00:00:00`);
  const min = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
  const max = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
  return current >= min && current <= max;
}

function taskDisplaySegment(task, selectedDate) {
  const dayStart = new Date(`${selectedDate}T00:00:00`);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const start = new Date(task.start_at);
  const end = new Date(task.end_at);
  const rawStart = Math.round((start - dayStart) / 60000);
  const rawEnd = Math.round((end - dayStart) / 60000);
  const displayStart = Math.max(0, Math.min(DAY_MINUTES, rawStart));
  const displayEnd = Math.max(displayStart + 1, Math.min(DAY_MINUTES, rawEnd));
  const visibleStart = rawStart < 0 ? dayStart : start;
  const visibleEnd = rawEnd > DAY_MINUTES ? dayEnd : end;
  const displayDuration = Math.max(1, displayEnd - displayStart);
  const visualEnd = Math.min(DAY_MINUTES, Math.max(displayEnd, displayStart + SHORT_TASK_MINUTES));
  return {
    ...task,
    rawStart,
    rawEnd,
    displayStart,
    displayEnd,
    visualStart: displayStart,
    visualEnd,
    startMinutes: displayStart,
    endMinutes: displayEnd,
    visibleStart,
    visibleEnd,
    displayDuration,
    visualDuration: Math.max(displayDuration, visualEnd - displayStart),
    startsBeforeDay: rawStart < 0,
    endsAfterDay: rawEnd > DAY_MINUTES,
  };
}

function priorityRank(priority) {
  return { high: 0, medium: 1, low: 2 }[priority] ?? 1;
}

function layoutTasks(tasks, selectedDate) {
  const segments = tasks.map((task) => taskDisplaySegment(task, selectedDate));
  segments.sort((a, b) => (
    a.displayStart - b.displayStart
    || priorityRank(a.priority) - priorityRank(b.priority)
    || b.displayEnd - a.displayEnd
    || a.id - b.id
  ));

  const groups = [];
  for (const task of segments) {
    const group = groups.find((g) => task.visualStart < g.end && task.visualEnd > g.start);
    if (!group) {
      groups.push({ tasks: [task], start: task.visualStart, end: task.visualEnd });
    } else {
      group.tasks.push(task);
      group.start = Math.min(group.start, task.visualStart);
      group.end = Math.max(group.end, task.visualEnd);
    }
  }

  const result = [];
  for (const group of groups) {
    const columns = [];
    const ordered = [...group.tasks].sort((a, b) => (
      priorityRank(a.priority) - priorityRank(b.priority)
      || a.displayStart - b.displayStart
      || b.displayEnd - a.displayEnd
      || a.id - b.id
    ));

    for (const task of ordered) {
      let colIndex = 0;
      while (true) {
        const colTasks = columns[colIndex] || [];
        const hasConflict = colTasks.some((other) => task.visualStart < other.visualEnd && task.visualEnd > other.visualStart);
        if (!hasConflict) {
          columns[colIndex] = colTasks;
          colTasks.push(task);
          result.push({ ...task, column: colIndex, columns: 1 });
          break;
        }
        colIndex += 1;
      }
    }

    const maxColumns = Math.max(1, columns.length);
    for (const item of result) {
      if (group.tasks.some((task) => task.id === item.id)) item.columns = maxColumns;
    }
  }

  return result;
}

function formatDateShort(date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

function formatDateWithYear(date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function formatTaskRange(task) {
  const start = new Date(task.start_at);
  const end = new Date(task.end_at);
  const sameDay = toDateInput(start) === toDateInput(end);
  if (sameDay) return `${formatTime(task.start_at)} — ${formatTime(task.end_at)}`;
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameYear) return `${formatDateShort(start)} ${formatTime(task.start_at)} — ${formatDateShort(end)} ${formatTime(task.end_at)}`;
  return `${formatDateWithYear(start)} ${formatTime(task.start_at)} — ${formatDateWithYear(end)} ${formatTime(task.end_at)}`;
}

function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

function getPasswordError(password) {
  if (password.length < 8) return 'Пароль должен содержать минимум 8 символов';
  if (!/^[A-Za-z0-9!@#$%^&*()_+\-=\[\]{};:'",.<>/?\\|`~]+$/.test(password)) {
    return 'Пароль может содержать только английские буквы, цифры и специальные символы';
  }
  if (!/[A-Z]/.test(password)) return 'Пароль должен содержать минимум 1 заглавную английскую букву';
  if (!/[a-z]/.test(password)) return 'Пароль должен содержать минимум 1 строчную английскую букву';
  if (!/\d/.test(password)) return 'Пароль должен содержать минимум 1 цифру';
  if (!/[!@#$%^&*()_+\-=\[\]{};:'",.<>/?\\|`~]/.test(password)) return 'Пароль должен содержать минимум 1 специальный символ';
  return '';
}

function taskWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'задача';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'задачи';
  return 'задач';
}

function AuthPage({ onLogin, theme, setTheme }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', email: '', login: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function changeMode(nextMode) {
    setMode(nextMode);
    setError('');
    setShowPassword(false);
  }

  function validateForm() {
    if (mode === 'register') {
      if (form.username.trim().length < 3) return 'Имя пользователя должно содержать минимум 3 символа';
      if (form.username.trim().length > 20) return 'Имя пользователя должно быть не длиннее 20 символов';
      if (!isEmailValid(form.email)) return 'Введите корректный email, например example@gmail.com';
      const passwordError = getPasswordError(form.password);
      if (passwordError) return passwordError;
    }
    if (mode === 'login') {
      if (!isEmailValid(form.login)) return 'Введите корректный email';
      if (!form.password) return 'Введите пароль';
    }
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    try {
      const data = mode === 'login'
        ? await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: form.login, password: form.password }) })
        : await api('/auth/register', { method: 'POST', body: JSON.stringify({ username: form.username, email: form.email, password: form.password }) });
      setToken(data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-topline">
          <div className="brand big">
            <div className="brand-icon"><NotebookTabs size={28} /></div>
            <div>
              <h1>Планировщик дня</h1>
              <p>Личная среда для задач, времени и приоритетов</p>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn auth-theme-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <div className="auth-tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => changeMode('login')} type="button">Вход</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => changeMode('register')} type="button">Регистрация</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <>
              <label>Имя пользователя<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
              <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="example@gmail.com" /></label>
            </>
          )}
          {mode === 'login' && (
            <label>Email<input type="email" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} /></label>
          )}
          <label>
            Пароль
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={mode === 'register' ? 'Минимум 8 символов' : ''}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-btn" disabled={loading}>{loading ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
        </form>
      </div>
    </div>
  );
}

function Header({ selectedDate, setSelectedDate, setPage, page, theme, setTheme, user, onLogout, onProfile }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  function shift(days) {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setSelectedDate(toDateInput(d));
  }
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Расписание дня</p>
        <h2>{formatHumanDate(selectedDate)}</h2>
      </div>
      <div className="topbar-actions">
        <button className="icon-btn" onClick={() => shift(-1)}><ChevronLeft size={18} /></button>
        <input className="date-input" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        <button className="icon-btn" onClick={() => shift(1)}><ChevronRight size={18} /></button>
        <button className="ghost-btn" onClick={() => { setSelectedDate(toDateInput(new Date())); setPage('planner'); }}>Сегодня</button>
        <button className={page === 'calendar' ? 'ghost-btn active' : 'ghost-btn'} onClick={() => { setSelectedDate(toDateInput(new Date())); setPage('calendar'); }}><CalendarDays size={17} /> Календарь</button>
        <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        <div className="clock-box"><Clock3 size={18} /> {pad(now.getHours())}:{pad(now.getMinutes())}</div>
        <button className="user-chip profile-btn" onClick={onProfile}><User size={16} /> {user?.username}</button>
        <button className="icon-btn" onClick={onLogout}><LogOut size={18} /></button>
      </div>
    </header>
  );
}

function Sidebar({ tasks, currentTasks, onCreate, selectedDate, onEdit, onComplete }) {
  const [expanded, setExpanded] = useState({});
  const total = tasks.length;
  const completed = tasks.filter((t) => t.completed).length;
  const now = new Date();
  const nextTasks = useMemo(() => {
    const future = tasks
      .filter((t) => new Date(t.start_at) > now && !t.completed)
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at) || priorityRank(a.priority) - priorityRank(b.priority));
    if (future.length === 0) return [];
    const firstStart = new Date(future[0].start_at).getTime();
    return future.filter((t) => new Date(t.start_at).getTime() === firstStart);
  }, [tasks]);
  const overdueTasks = useMemo(() => (
    tasks
      .filter((t) => !t.completed && new Date(t.end_at) < now)
      .sort((a, b) => new Date(a.end_at) - new Date(b.end_at) || priorityRank(a.priority) - priorityRank(b.priority))
  ), [tasks]);

  function toggleExpanded(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function taskList(list, emptyText = '') {
    if (list.length === 0) return emptyText ? <p>{emptyText}</p> : null;
    return (
      <div className="current-list spaced">
        {list.map((task) => (
          <div key={task.id} className={`current-item ${task.priority}`}>
            <div className="current-item-head">
              <div>
                <strong>{task.title}</strong>
                <span>{formatTaskRange(task)}</span>
              </div>
              <button type="button" className={`expand-btn ${expanded[task.id] ? 'open' : ''}`} onClick={() => toggleExpanded(task.id)} aria-label={expanded[task.id] ? 'Свернуть задачу' : 'Развернуть задачу'} title={expanded[task.id] ? 'Свернуть' : 'Развернуть'}><ChevronDown size={16} /></button>
            </div>
            {expanded[task.id] && (
              <div className="current-expanded">
                <p>{task.description || 'Без описания'}</p>
                <div className="current-expanded-actions">
                  <button type="button" onClick={() => onComplete(task)}>{task.completed ? 'Вернуть' : 'Готово'}</button>
                  <button type="button" onClick={() => onEdit(task)}><Pencil size={14} /> Редактировать</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon"><NotebookTabs size={25} /></div>
        <div><h1>Планировщик дня</h1><p>Задачи, приоритеты и фокус на текущем деле</p></div>
      </div>
      <div className="current-card">
        <p className="eyebrow light">Текущие задачи</p>
        {currentTasks.length === 0 ? (
          <>
            <h2>Свободное время</h2>
            <p>На выбранный момент активных задач нет</p>
          </>
        ) : taskList(currentTasks)}
        <div className="sidebar-subsection">
          <p className="eyebrow light small-title">Следующие задачи</p>
          {taskList(nextTasks, 'Ближайших задач нет')}
        </div>
      </div>
      <div className="current-card overdue-card">
        <p className="eyebrow light">Просроченные задачи</p>
        {taskList(overdueTasks, 'Таких задач нет')}
      </div>
      <div className="stats-grid">
        <div className="stat"><strong>{total}</strong><span>Всего задач</span></div>
        <div className="stat"><strong>{completed}</strong><span>Выполнено</span></div>
      </div>
      <TaskForm selectedDate={selectedDate} onSubmit={onCreate} />
    </aside>
  );
}

function TaskForm({ selectedDate, onSubmit }) {
  const [form, setForm] = useState({
    title: '', description: '', time: '09:00', hours: 1, minutes: 0, priority: 'medium'
  });
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    setError('');
    const duration = Number(form.hours) * 60 + Number(form.minutes);
    if (duration < 5) {
      setError('Минимальное время для задачи - 5 минут');
      return;
    }
    if (duration > 10080) {
      setError('Длительность задачи не должна превышать 7 суток');
      return;
    }
    if (Number(form.hours) === 168 && Number(form.minutes) !== 0) {
      setError('При длительности 168 часов количество минут должно быть 0');
      return;
    }
    await onSubmit({
      title: form.title,
      description: form.description,
      start_at: `${selectedDate}T${form.time}:00`,
      duration_minutes: duration,
      priority: form.priority,
    });
    setForm({ title: '', description: '', time: form.time, hours: 1, minutes: 0, priority: 'medium' });
  }
  return (
    <form className="task-form" onSubmit={submit}>
      <h3><Plus size={18} /> Добавить задачу</h3>
      <label>Название<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Например: Подготовить отчёт" /></label>
      <label>Описание<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Краткое описание" /></label>
      <div className="form-row">
        <label>Время<input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
        <label>Приоритет<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option></select></label>
      </div>
      <div className="form-row">
        <label>Часы<input min="0" max="168" type="number" value={form.hours} onChange={(e) => { const hours = Math.min(168, Math.max(0, Number(e.target.value))); setForm({ ...form, hours, minutes: hours === 168 ? 0 : form.minutes }); }} /></label>
        <label>Минуты<input min="0" max="59" type="number" value={form.minutes} disabled={Number(form.hours) === 168} onChange={(e) => setForm({ ...form, minutes: Math.min(59, Math.max(0, Number(e.target.value))) })} /></label>
      </div>
      {Number(form.hours) === 0 && Number(form.minutes) < 5 && <div className="error-box small">Минимальное время для задачи - 5 минут</div>}
      {error && <div className="error-box small">{error}</div>}
      <button className="primary-btn">Добавить</button>
    </form>
  );
}

function Timeline({ tasks, selectedDate, onEdit, onComplete }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const laidOut = layoutTasks(tasks, selectedDate);
  const isToday = selectedDate === toDateInput(new Date());
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const hours = Array.from({ length: 25 }, (_, i) => i);
  const timelineHeight = TIMELINE_HEIGHT + 48;

  return (
    <section className="timeline-shell">
      <div className="timeline" style={{ height: timelineHeight }}>
        {hours.map((hour) => (
          <div className="hour-row" key={hour} style={{ top: hour * 60 * PX_PER_MINUTE + 16 }}>
            <span>{`${pad(hour)}:00`}</span>
          </div>
        ))}
        {isToday && (
          <div className="now-line" style={{ top: nowMinutes * PX_PER_MINUTE + 16 }}><span>сейчас</span></div>
        )}
        {laidOut.map((task) => {
          const top = task.displayStart * PX_PER_MINUTE + 16;
          const isShort = task.displayDuration <= 60;
          const height = Math.max(isShort ? 94 : 78, task.displayDuration * PX_PER_MINUTE - 4);
          const gap = 10;
          const width = `calc((100% - ${gap * (task.columns - 1)}px) / ${task.columns})`;
          const left = `calc(${task.column} * ((100% - ${gap * (task.columns - 1)}px) / ${task.columns} + ${gap}px))`;
          return (
            <article
              key={`${task.id}-${task.displayStart}`}
              className={`task-card ${task.priority} ${task.completed ? 'completed' : ''} ${isShort ? 'short' : ''}`}
              style={{ top, height, left, width }}
              onDoubleClick={() => onEdit(task)}
            >
              <div className="task-card-content">
                <div className="task-main-text">
                  <h4>{task.title}</h4>
                  <p>{task.description || 'Без описания'}</p>
                  <span className="task-meta">{formatTaskRange(task)} · {formatDuration(task.duration_minutes)}</span>
                </div>
                <div className="task-actions">
                  <button onClick={() => onComplete(task)}>{task.completed ? 'Вернуть' : 'Готово'}</button>
                  <button onClick={() => onEdit(task)} aria-label="Редактировать"><Pencil size={14} /></button>
                </div>
              </div>
              {task.startsBeforeDay && <span className="carry-label">началась раньше</span>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EditModal({ task, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (!task) return;
    const start = toDateTimeInput(new Date(task.start_at));
    setForm({
      title: task.title,
      description: task.description,
      start_at: start,
      hours: Math.floor(task.duration_minutes / 60),
      minutes: task.duration_minutes % 60,
      priority: task.priority,
    });
  }, [task]);
  if (!task || !form) return null;
  async function submit(e) {
    e.preventDefault();
    const duration = Number(form.hours) * 60 + Number(form.minutes);
    if (duration < 5) return;
    if (duration > 10080) return;
    if (Number(form.hours) === 168 && Number(form.minutes) !== 0) return;
    await onSave(task.id, {
      title: form.title,
      description: form.description,
      start_at: toBackendDateTime(form.start_at),
      duration_minutes: duration,
      priority: form.priority,
    });
  }
  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <div className="modal-head"><h3>Редактирование задачи</h3><button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <label>Название<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>Описание<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label>Дата и время начала<input type="datetime-local" value={form.start_at} onChange={(e) => setForm({ ...form, start_at: e.target.value })} /></label>
        <div className="form-row">
          <label>Часы<input type="number" min="0" max="168" value={form.hours} onChange={(e) => { const hours = Math.min(168, Math.max(0, Number(e.target.value))); setForm({ ...form, hours, minutes: hours === 168 ? 0 : form.minutes }); }} /></label>
          <label>Минуты<input type="number" min="0" max="59" value={form.minutes} disabled={Number(form.hours) === 168} onChange={(e) => setForm({ ...form, minutes: Math.min(59, Math.max(0, Number(e.target.value))) })} /></label>
        </div>
        {Number(form.hours) === 0 && Number(form.minutes) < 5 && <div className="error-box small">Минимальное время для задачи - 5 минут</div>}
        <label>Приоритет<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option></select></label>
        <div className="modal-actions"><button className="primary-btn">Сохранить</button><button type="button" className="danger-btn" onClick={() => onDelete(task.id)}><Trash2 size={16} />Удалить</button></div>
      </form>
    </div>
  );
}

function CalendarPage({ selectedDate, setSelectedDate, setPage }) {
  const [cursor, setCursor] = useState(new Date(`${selectedDate}T00:00:00`));
  const [summary, setSummary] = useState({});
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));
  const grid = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  useEffect(() => {
    setCursor(new Date(`${selectedDate}T00:00:00`));
  }, [selectedDate]);

  useEffect(() => {
    const from = toDateInput(grid[0]);
    const to = toDateInput(grid[41]);
    api(`/calendar/summary?from=${from}&to=${to}`).then((data) => {
      const map = {};
      data.forEach((item) => { map[item.date] = item; });
      setSummary(map);
    }).catch(() => setSummary({}));
  }, [cursor]);

  function pick(date) {
    const value = toDateInput(date);
    if (!dateAllowed(value)) return;
    setSelectedDate(value);
    setPage('planner');
  }

  return (
    <div className="calendar-page">
      <div className="calendar-head">
        <button className="icon-btn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft /></button>
        <h2>{cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</h2>
        <button className="icon-btn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight /></button>
      </div>
      <p className="calendar-note">Для создания и просмотра задач доступны последние 30 и следующие 365 дней</p>
      <div className="calendar-grid weekdays">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="calendar-grid">
        {grid.map((date) => {
          const key = toDateInput(date);
          const item = summary[key];
          const disabled = !dateAllowed(key);
          const out = date.getMonth() !== cursor.getMonth();
          return <button key={key} onClick={() => pick(date)} className={`calendar-day ${item?.max_priority || ''} ${disabled ? 'disabled' : ''} ${out ? 'out' : ''} ${key === selectedDate ? 'selected' : ''}`}>
            <strong>{date.getDate()}</strong>
            {item && <span>{item.tasks_count} {taskWord(item.tasks_count)}</span>}
          </button>;
        })}
      </div>
    </div>
  );
}

function ProfileModal({ user, onClose, onSave }) {
  const [username, setUsername] = useState(user?.username || '');
  const [currentEmail, setCurrentEmail] = useState(user?.email || '');
  const [email, setEmail] = useState(user?.email || '');
  const [passwords, setPasswords] = useState({ old_password: '', new_password: '', repeat_password: '' });
  const [showPasswords, setShowPasswords] = useState({ old: false, next: false, repeat: false });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (username.trim().length < 3) { setError('Имя пользователя должно содержать минимум 3 символа'); return; }
    if (username.trim().length > 20) { setError('Имя пользователя должно быть не длиннее 20 символов'); return; }
    if (!isEmailValid(email)) { setError('Введите корректный email'); return; }
    setLoading(true);
    try {
      const updated = await api('/auth/me', { method: 'PUT', body: JSON.stringify({ username: username.trim(), email: email.trim().toLowerCase() }) });
      onSave(updated);
      setCurrentEmail(updated.email);
      setEmail(updated.email);
      setSuccess('Данные успешно обновлены');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPasswordError('');
    if (!passwords.old_password) { setPasswordError('Введите старый пароль'); return; }
    const validationError = getPasswordError(passwords.new_password);
    if (validationError) { setPasswordError(validationError); return; }
    if (passwords.new_password !== passwords.repeat_password) { setPasswordError('Новый пароль и повтор пароля не совпадают'); return; }
    setPasswordLoading(true);
    try {
      await api('/auth/password', { method: 'PUT', body: JSON.stringify({ old_password: passwords.old_password, new_password: passwords.new_password }) });
      setPasswords({ old_password: '', new_password: '', repeat_password: '' });
      setPasswordError('Пароль успешно изменён');
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordLoading(false);
    }
  }

  function passwordInput(key, label, valueKey, visibleKey, autoComplete) {
    return (
      <label>{label}
        <div className="password-field">
          <input
            type={showPasswords[visibleKey] ? 'text' : 'password'}
            value={passwords[valueKey]}
            autoComplete={autoComplete}
            onChange={(e) => setPasswords({ ...passwords, [valueKey]: e.target.value })}
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPasswords((prev) => ({ ...prev, [visibleKey]: !prev[visibleKey] }))}
            aria-label={showPasswords[visibleKey] ? 'Скрыть пароль' : 'Показать пароль'}
          >
            {showPasswords[visibleKey] ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </label>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal profile-modal">
        <div className="modal-head"><h3>Профиль</h3><button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <form className="profile-section" onSubmit={submit}>
          <label>Имя пользователя<input maxLength="20" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
          <label>Текущий Email<input value={currentEmail} disabled /></label>
          <label>Новый Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@gmail.com" /></label>
          {error && <div className="error-box">{error}</div>}
          {success && <div className="success-box">{success}</div>}
          <div className="modal-actions"><button className="primary-btn" disabled={loading}>{loading ? 'Сохранение...' : 'Сохранить изменения'}</button></div>
        </form>
        <form className="profile-section password-change" onSubmit={changePassword}>
          <h4><KeyRound size={17} /> Смена пароля</h4>
          {passwordInput('old', 'Старый пароль', 'old_password', 'old', 'current-password')}
          {passwordInput('next', 'Новый пароль', 'new_password', 'next', 'new-password')}
          {passwordInput('repeat', 'Повторите новый пароль', 'repeat_password', 'repeat', 'new-password')}
          {passwordError && <div className={passwordError === 'Пароль успешно изменён' ? 'success-box' : 'error-box'}>{passwordError}</div>}
          <div className="modal-actions"><button className="primary-btn" disabled={passwordLoading}>{passwordLoading ? 'Сохранение...' : 'Изменить пароль'}</button></div>
        </form>
      </div>
    </div>
  );
}

function PlannerApp() {
  const [theme, setTheme] = useState(localStorage.getItem('day_planner_theme') || 'light');
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedDate, setSelectedDate] = useState(toDateInput(new Date()));
  const [page, setPage] = useState('planner');
  const [tasks, setTasks] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('day_planner_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!getToken()) { setAuthChecked(true); return; }
    api('/auth/me').then((me) => setUser(me)).catch(() => clearToken()).finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  async function loadTasks() {
    if (!user || !dateAllowed(selectedDate)) { setTasks([]); return; }
    try {
      setError('');
      setTasks(await api(`/tasks?date=${selectedDate}`));
    } catch (err) {
      setError(err.message);
      setTasks([]);
    }
  }

  useEffect(() => { loadTasks(); }, [user, selectedDate]);

  const currentTasks = useMemo(() => {
    if (selectedDate !== toDateInput(new Date())) return [];
    return tasks.filter((t) => new Date(t.start_at) <= now && new Date(t.end_at) > now && !t.completed);
  }, [tasks, now, selectedDate]);

  async function createTask(payload) { await api('/tasks', { method: 'POST', body: JSON.stringify(payload) }); await loadTasks(); }
  async function saveTask(id, payload) { await api(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(payload) }); setEditingTask(null); await loadTasks(); }
  async function deleteTask(id) { await api(`/tasks/${id}`, { method: 'DELETE' }); setEditingTask(null); await loadTasks(); }
  async function completeTask(task) { await api(`/tasks/${task.id}/complete`, { method: 'PATCH', body: JSON.stringify({ completed: !task.completed }) }); await loadTasks(); }
  function logout() { clearToken(); setUser(null); setTasks([]); }

  if (!authChecked) return <div className="loading">Загрузка...</div>;
  if (!user) return <AuthPage onLogin={setUser} theme={theme} setTheme={setTheme} />;

  return (
    <div className="app-shell">
      <Sidebar tasks={tasks} currentTasks={currentTasks} selectedDate={selectedDate} onCreate={createTask} onEdit={setEditingTask} onComplete={completeTask} />
      <main className="main-panel">
        <Header selectedDate={selectedDate} setSelectedDate={setSelectedDate} page={page} setPage={setPage} theme={theme} setTheme={setTheme} user={user} onLogout={logout} onProfile={() => setProfileOpen(true)} />
        {error && <div className="error-box page-error">{error}</div>}
        {page === 'planner' ? (
          dateAllowed(selectedDate)
            ? <Timeline tasks={tasks} selectedDate={selectedDate} onEdit={setEditingTask} onComplete={completeTask} />
            : <div className="empty-state">Эта дата недоступна для просмотра. Откройте календарь и выберите дату из разрешённого диапазона.</div>
        ) : (
          <CalendarPage selectedDate={selectedDate} setSelectedDate={setSelectedDate} setPage={setPage} />
        )}
      </main>
      <EditModal task={editingTask} onClose={() => setEditingTask(null)} onSave={saveTask} onDelete={deleteTask} />
      {profileOpen && <ProfileModal user={user} onClose={() => setProfileOpen(false)} onSave={setUser} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<PlannerApp />);
