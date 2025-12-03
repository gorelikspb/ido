// Состояние приложения
let todos = [];
let currentFilter = 'all';
let syncEnabled = false;
let userId = null;

// Конфигурация Cloudflare Workers API
// URL вашего Worker (будет после деплоя)
const API_URL = window.location.origin + '/api/todos';

// DOM элементы
const todoInput = document.getElementById('todo-input');
const addBtn = document.getElementById('add-btn');
const todoList = document.getElementById('todo-list');
const totalCount = document.getElementById('total-count');
const filterBtns = document.querySelectorAll('.filter-btn');
const clearCompletedBtn = document.getElementById('clear-completed');

// Получение или создание User ID
function getUserId() {
    if (!userId) {
        userId = localStorage.getItem('todoUserId');
        if (!userId) {
            userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('todoUserId', userId);
        }
    }
    return userId;
}

// Загрузка данных из Cloudflare KV
async function loadTodos() {
    // Сначала загружаем из localStorage для быстрого отображения
    const saved = localStorage.getItem('todos');
    if (saved) {
        todos = JSON.parse(saved);
        renderTodos();
        updateStats();
    }

    // Затем синхронизируем с Cloudflare
    try {
        const response = await fetch(`${API_URL}?userId=${getUserId()}`);
        if (response.ok) {
            const cloudTodos = await response.json();
            if (cloudTodos && Array.isArray(cloudTodos) && cloudTodos.length > 0) {
                // Объединяем локальные и облачные данные
                todos = mergeTodos(todos, cloudTodos);
                saveTodosLocal();
                renderTodos();
                updateStats();
            }
            syncEnabled = true;
        }
    } catch (error) {
        console.log('Синхронизация недоступна, используем локальные данные:', error.message);
        syncEnabled = false;
    }
}

// Объединение локальных и облачных данных
function mergeTodos(localTodos, cloudTodos) {
    const merged = {};
    
    // Добавляем локальные задачи
    localTodos.forEach(todo => {
        merged[todo.id] = todo;
    });
    
    // Добавляем облачные задачи (приоритет у более новых)
    cloudTodos.forEach(todo => {
        const localTodo = merged[todo.id];
        if (!localTodo || new Date(todo.updatedAt || todo.createdAt || 0) > 
                          new Date(localTodo.updatedAt || localTodo.createdAt || 0)) {
            merged[todo.id] = todo;
        }
    });
    
    return Object.values(merged).sort((a, b) => 
        new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
}

// Сохранение данных в localStorage
function saveTodosLocal() {
    localStorage.setItem('todos', JSON.stringify(todos));
    updateStats();
}

// Debounce для экономии операций KV (сохраняем через 2 секунды после последнего изменения)
let saveTimeout = null;

// Сохранение данных (локально + Cloudflare)
async function saveTodos() {
    // Сохраняем локально сразу для быстрого отклика
    saveTodosLocal();
    
    // Отменяем предыдущий таймер
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    
    // Синхронизируем с Cloudflare с задержкой (debounce)
    if (syncEnabled) {
        saveTimeout = setTimeout(async () => {
            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        userId: getUserId(),
                        todos: todos.map(todo => ({
                            ...todo,
                            updatedAt: todo.updatedAt || new Date().toISOString()
                        }))
                    })
                });
                
                if (response.ok) {
                    console.log('✓ Данные синхронизированы с Cloudflare');
                } else {
                    console.log('⚠ Ошибка синхронизации:', response.status);
                }
            } catch (error) {
                console.log('⚠ Не удалось синхронизировать с Cloudflare:', error.message);
                // Продолжаем работать локально
            }
        }, 2000); // Сохраняем через 2 секунды после последнего изменения
    }
}

// Обновление статистики
function updateStats() {
    const activeCount = todos.filter(t => !t.completed).length;
    totalCount.textContent = activeCount;
}

// Добавление новой задачи
function addTodo() {
    const text = todoInput.value.trim();
    if (text === '') return;

    const newTodo = {
        id: Date.now(),
        text: text,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    todos.unshift(newTodo);
    saveTodos();
    renderTodos();
    
    todoInput.value = '';
    todoInput.focus();
}

// Удаление задачи
function deleteTodo(id) {
    todos = todos.filter(todo => todo.id !== id);
    saveTodos();
    renderTodos();
}

// Переключение статуса задачи
function toggleTodo(id) {
    todos = todos.map(todo => 
        todo.id === id ? { 
            ...todo, 
            completed: !todo.completed,
            updatedAt: new Date().toISOString()
        } : todo
    );
    saveTodos();
    renderTodos();
}

// Очистка выполненных задач
function clearCompleted() {
    todos = todos.filter(todo => !todo.completed);
    saveTodos();
    renderTodos();
}

// Фильтрация задач
function getFilteredTodos() {
    switch (currentFilter) {
        case 'active':
            return todos.filter(todo => !todo.completed);
        case 'completed':
            return todos.filter(todo => todo.completed);
        default:
            return todos;
    }
}

// Рендеринг списка задач
function renderTodos() {
    const filteredTodos = getFilteredTodos();
    
    if (filteredTodos.length === 0) {
        todoList.innerHTML = `
            <li class="empty-state">
                <div class="empty-state-icon">📋</div>
                <div class="empty-state-text">
                    ${currentFilter === 'all' 
                        ? 'Нет задач. Добавьте первую!' 
                        : currentFilter === 'active'
                        ? 'Нет активных задач'
                        : 'Нет выполненных задач'}
                </div>
            </li>
        `;
        return;
    }

    todoList.innerHTML = filteredTodos.map(todo => `
        <li class="todo-item ${todo.completed ? 'completed' : ''}" data-id="${todo.id}">
            <input 
                type="checkbox" 
                class="todo-checkbox" 
                ${todo.completed ? 'checked' : ''}
                onchange="toggleTodo(${todo.id})"
            >
            <span class="todo-text">${escapeHtml(todo.text)}</span>
            <button 
                class="todo-delete" 
                onclick="deleteTodo(${todo.id})"
                aria-label="Удалить задачу"
            >×</button>
        </li>
    `).join('');
}

// Экранирование HTML для безопасности
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Обработчики событий
addBtn.addEventListener('click', addTodo);
todoInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addTodo();
    }
});

clearCompletedBtn.addEventListener('click', clearCompleted);

// Фильтры
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderTodos();
    });
});

// Периодическая синхронизация (каждые 30 секунд)
let syncInterval = null;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    await loadTodos();
    todoInput.focus();
    
    // Периодическая синхронизация (каждые 30 секунд)
    syncInterval = setInterval(async () => {
        if (syncEnabled) {
            await loadTodos(); // Загружаем свежие данные с сервера
        }
    }, 30000);
});

// Очистка при закрытии страницы
window.addEventListener('beforeunload', () => {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    if (syncInterval) {
        clearInterval(syncInterval);
    }
    // Принудительно сохраняем перед закрытием
    saveTodosLocal();
});


// Поддержка свайпа для удаления (мобильные устройства)
let touchStartX = 0;
let touchEndX = 0;

todoList.addEventListener('touchstart', (e) => {
    if (e.target.closest('.todo-item')) {
        touchStartX = e.changedTouches[0].screenX;
    }
});

todoList.addEventListener('touchend', (e) => {
    if (e.target.closest('.todo-item')) {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe(e);
    }
});

function handleSwipe(e) {
    const swipeThreshold = 50;
    const diff = touchStartX - touchEndX;
    
    if (Math.abs(diff) > swipeThreshold) {
        const todoItem = e.target.closest('.todo-item');
        if (todoItem && diff > 0) {
            // Свайп влево = удаление
            const id = parseInt(todoItem.dataset.id);
            deleteTodo(id);
        }
    }
}

