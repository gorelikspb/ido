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
        // ВСЕГДА используем фиксированный userId для синхронизации между устройствами
        const fixedUserId = 'my_todos_user';
        
        // ВСЕГДА устанавливаем фиксированный userId (перезаписываем старый)
        userId = fixedUserId;
        localStorage.setItem('todoUserId', userId);
    }
    return userId;
}

// Проверка и миграция userId (вызывается при инициализации)
async function checkAndMigrateUserId() {
    const oldUserId = localStorage.getItem('todoUserId');
    const fixedUserId = 'my_todos_user';
    
    // Если был старый userId и он отличается от фиксированного - мигрируем данные
    if (oldUserId && oldUserId !== fixedUserId) {
        console.log('🔄 Обнаружен старый userId:', oldUserId);
        console.log('🔄 Миграция на фиксированный userId:', fixedUserId);
        // Миграция данных: загружаем данные со старого userId и сохраняем под новым
        await migrateUserData(oldUserId, fixedUserId);
    }
    
    // Устанавливаем фиксированный userId
    userId = fixedUserId;
    localStorage.setItem('todoUserId', userId);
    console.log('✅ Установлен userId:', userId);
}

// Миграция данных пользователя при смене userId
async function migrateUserData(oldUserId, newUserId) {
    try {
        console.log('📥 Загрузка данных со старого userId:', oldUserId);
        // Загружаем данные со старого userId из KV
        const oldResponse = await fetch(`${API_URL}?userId=${oldUserId}`);
        let oldTodos = [];
        
        if (oldResponse.ok) {
            const data = await oldResponse.json();
            if (data && Array.isArray(data)) {
                oldTodos = data;
                console.log('📥 Найдено задач со старого userId:', oldTodos.length);
            }
        }
        
        // Загружаем данные под новым userId (если уже есть)
        console.log('📥 Загрузка данных под новым userId:', newUserId);
        const newResponse = await fetch(`${API_URL}?userId=${newUserId}`);
        let newTodos = [];
        
        if (newResponse.ok) {
            const data = await newResponse.json();
            if (data && Array.isArray(data)) {
                newTodos = data;
                console.log('📥 Найдено задач под новым userId:', newTodos.length);
            }
        }
        
        // Объединяем данные со старого и нового userId
        if (oldTodos.length > 0 || newTodos.length > 0) {
            const mergedTodos = mergeTodos(oldTodos, newTodos);
            console.log('🔄 Объединено задач после миграции:', mergedTodos.length);
            
            // Сохраняем объединенные данные под новым userId
            const saveResponse = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: newUserId,
                    todos: mergedTodos
                })
            });
            
            if (saveResponse.ok) {
                console.log('✅ Данные мигрированы и объединены под новым userId');
                // Обновляем локальные данные
                todos = mergedTodos;
                saveTodosLocal();
                renderTodos();
                updateStats();
            } else {
                console.log('⚠ Ошибка сохранения при миграции:', saveResponse.status);
            }
        } else {
            console.log('ℹ Нет данных для миграции');
        }
    } catch (error) {
        console.log('⚠ Не удалось мигрировать данные:', error.message);
    }
}

// Загрузка данных из Cloudflare KV
async function loadTodos() {
    // Сначала загружаем из localStorage для быстрого отображения
    const saved = localStorage.getItem('todos');
    const localTodos = saved ? JSON.parse(saved) : [];
    if (localTodos.length > 0) {
        todos = localTodos;
        renderTodos();
        updateStats();
    }

    // Затем синхронизируем с Cloudflare (приоритет у облачных данных)
    try {
        const currentUserId = getUserId();
        console.log('📡 Загрузка данных для userId:', currentUserId);
        console.log('📱 Локальные данные:', localTodos.length, 'задач');
        
        const response = await fetch(`${API_URL}?userId=${currentUserId}`);
        
        if (response.ok) {
            const cloudTodos = await response.json();
            console.log('☁️ Данные из облака:', cloudTodos);
            
            if (cloudTodos && Array.isArray(cloudTodos)) {
                // ВАЖНО: Приоритет у облачных данных
                // Если в облаке есть данные - используем их (объединяем с локальными)
                // Если в облаке пусто - это значит действительно пусто, используем локальные только если они есть
                if (cloudTodos.length > 0) {
                    // Объединяем локальные и облачные данные (приоритет у более новых)
                    todos = mergeTodos(localTodos, cloudTodos);
                    console.log('✅ Объединенные задачи:', todos.length, '(локальных:', localTodos.length, ', облачных:', cloudTodos.length, ')');
                } else {
                    // В облаке пусто - используем локальные данные (если есть)
                    if (localTodos.length > 0) {
                        todos = localTodos;
                        console.log('ℹ️ В облаке пусто, используем локальные данные:', localTodos.length, 'задач');
                    } else {
                        todos = [];
                        console.log('ℹ️ В облаке и локально пусто');
                    }
                }
                
                // Сохраняем объединенные данные локально
                saveTodosLocal();
                renderTodos();
                updateStats();
                syncEnabled = true;
                console.log('✅ Синхронизация включена');
            } else {
                console.log('⚠️ Неверный формат данных из облака, используем локальные');
                syncEnabled = false;
            }
        } else {
            const errorText = await response.text();
            console.log('⚠️ Ошибка загрузки:', response.status, response.statusText, errorText);
            // При ошибке используем локальные данные
            if (localTodos.length > 0) {
                todos = localTodos;
                console.log('📱 Используем локальные данные из-за ошибки API');
            }
            syncEnabled = false;
        }
    } catch (error) {
        console.log('⚠️ Синхронизация недоступна:', error.message);
        console.log('📱 Используем локальные данные:', localTodos.length, 'задач');
        // При ошибке сети используем локальные данные
        if (localTodos.length > 0) {
            todos = localTodos;
        }
        syncEnabled = false;
    }
}

// Объединение локальных и облачных данных
function mergeTodos(localTodos, cloudTodos) {
    // Если локально пусто, просто возвращаем облачные данные
    if (!localTodos || localTodos.length === 0) {
        console.log('📥 Локально пусто, используем только облачные данные');
        return cloudTodos.sort((a, b) => 
            new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
        );
    }
    
    // Если в облаке пусто, возвращаем локальные
    if (!cloudTodos || cloudTodos.length === 0) {
        console.log('📤 В облаке пусто, используем только локальные данные');
        return localTodos;
    }
    
    // Объединяем обе коллекции (приоритет у более новых по updatedAt)
    const merged = {};
    
    // Сначала добавляем локальные задачи
    localTodos.forEach(todo => {
        merged[todo.id] = todo;
    });
    
    // Затем добавляем/обновляем облачными (приоритет у более новых)
    cloudTodos.forEach(todo => {
        const localTodo = merged[todo.id];
        const cloudTime = new Date(todo.updatedAt || todo.createdAt || 0).getTime();
        const localTime = localTodo ? new Date(localTodo.updatedAt || localTodo.createdAt || 0).getTime() : 0;
        
        if (!localTodo || cloudTime >= localTime) {
            merged[todo.id] = todo;
        }
    });
    
    const result = Object.values(merged).sort((a, b) => 
        new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    
    console.log('🔄 Объединено:', result.length, 'задач (локальных:', localTodos.length, ', облачных:', cloudTodos.length, ')');
    return result;
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
                const currentUserId = getUserId();
                const todosToSave = todos.map(todo => ({
                    ...todo,
                    updatedAt: todo.updatedAt || new Date().toISOString()
                }));
                
                console.log('💾 Сохранение в облако:', {
                    userId: currentUserId,
                    todosCount: todosToSave.length,
                    url: API_URL
                });
                
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        userId: currentUserId,
                        todos: todosToSave
                    })
                });
                
                if (response.ok) {
                    const result = await response.json();
                    console.log('✅ Данные синхронизированы с Cloudflare:', result);
                } else {
                    const errorText = await response.text();
                    console.log('⚠ Ошибка синхронизации:', response.status, response.statusText, errorText);
                }
            } catch (error) {
                console.log('⚠ Не удалось синхронизировать с Cloudflare:', error.message, error.stack);
                // Продолжаем работать локально
            }
        }, 2000); // Сохраняем через 2 секунды после последнего изменения
    } else {
        console.log('⚠ Синхронизация отключена, сохраняем только локально');
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
    console.log('🚀 Инициализация приложения');
    console.log('📍 URL:', window.location.href);
    console.log('🔗 API URL:', API_URL);
    console.log('📱 User Agent:', navigator.userAgent);
    
    // Проверяем и мигрируем userId перед загрузкой данных
    await checkAndMigrateUserId();
    const currentUserId = getUserId();
    console.log('👤 User ID:', currentUserId);
    
    // Загружаем данные (сначала локальные для быстрого отображения, затем синхронизируем)
    await loadTodos();
    todoInput.focus();
    
    // Периодическая синхронизация (каждые 30 секунд)
    syncInterval = setInterval(async () => {
        if (syncEnabled) {
            console.log('🔄 Периодическая синхронизация...');
            await loadTodos(); // Загружаем свежие данные с сервера
        } else {
            console.log('⚠ Периодическая синхронизация пропущена (syncEnabled = false)');
        }
    }, 30000);
    
    // Показываем статус синхронизации в консоли
    setTimeout(() => {
        console.log('📊 Статус после инициализации:', {
            syncEnabled,
            todosCount: todos.length,
            userId: currentUserId
        });
    }, 1000);
});

// Очистка при закрытии страницы
window.addEventListener('beforeunload', async () => {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    if (syncInterval) {
        clearInterval(syncInterval);
    }
    // Принудительно сохраняем перед закрытием
    saveTodosLocal();
    
    // Принудительно синхронизируем с KV перед закрытием (если синхронизация включена)
    if (syncEnabled && todos.length > 0) {
        try {
            const currentUserId = getUserId();
            const dataToSave = todos.map(todo => ({
                ...todo,
                updatedAt: todo.updatedAt || new Date().toISOString()
            }));
            
            const data = JSON.stringify({
                userId: currentUserId,
                todos: dataToSave
            });
            
            console.log('💾 Принудительное сохранение при закрытии:', {
                userId: currentUserId,
                todosCount: dataToSave.length
            });
            
            if (navigator.sendBeacon) {
                const success = navigator.sendBeacon(API_URL, new Blob([data], { type: 'application/json' }));
                console.log('📤 sendBeacon:', success ? 'отправлено' : 'не удалось');
            } else {
                // Fallback для старых браузеров
                fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: data,
                    keepalive: true
                }).then(() => console.log('📤 fetch отправлено')).catch(err => console.log('📤 fetch ошибка:', err));
            }
        } catch (error) {
            console.log('⚠ Ошибка при сохранении при закрытии:', error.message);
        }
    }
});

// Также используем visibilitychange для мобильных устройств (когда переключаются вкладки)
document.addEventListener('visibilitychange', async () => {
    if (document.hidden && syncEnabled && todos.length > 0) {
        // Страница скрыта - сохраняем данные немедленно
        try {
            const currentUserId = getUserId();
            const dataToSave = todos.map(todo => ({
                ...todo,
                updatedAt: todo.updatedAt || new Date().toISOString()
            }));
            
            console.log('💾 Сохранение при скрытии страницы:', {
                userId: currentUserId,
                todosCount: dataToSave.length
            });
            
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUserId,
                    todos: dataToSave
                })
            });
            
            if (response.ok) {
                console.log('✅ Данные сохранены при скрытии страницы');
            } else {
                console.log('⚠ Ошибка сохранения при скрытии:', response.status);
            }
        } catch (error) {
            console.log('⚠ Ошибка при сохранении при скрытии:', error.message);
        }
    }
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

