// Cloudflare Worker для синхронизации туду-листа
// Работает с Cloudflare KV для хранения данных
// 
// API endpoints:
// GET /api/todos?userId=xxx - получить задачи пользователя
// POST /api/todos - сохранить задачи пользователя

export async function onRequest(context) {
    const { request, env } = context;
    const { method } = request;
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    // Получаем KV namespace (должен быть создан и привязан в Cloudflare Dashboard)
    const TODOS_KV = env.TODOS_KV;

    if (!TODOS_KV) {
        return new Response(JSON.stringify({ 
            error: 'KV namespace not configured',
            hint: 'Create KV namespace and bind it in Cloudflare Dashboard → Functions → KV Namespace Bindings'
        }), {
            status: 500,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    try {
        if (method === 'GET') {
            // Получение задач пользователя
            if (!userId) {
                return new Response(JSON.stringify({ error: 'userId required' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const data = await TODOS_KV.get(`todos:${userId}`);
            const todos = data ? JSON.parse(data) : [];
            
            return new Response(JSON.stringify(todos), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            });
        }

        if (method === 'POST') {
            // Сохранение задач пользователя
            const body = await request.json();
            
            if (!body.userId || !Array.isArray(body.todos)) {
                return new Response(JSON.stringify({ error: 'Invalid request body' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            await TODOS_KV.put(`todos:${body.userId}`, JSON.stringify(body.todos));
            
            return new Response(JSON.stringify({ success: true }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            });
        }

        if (method === 'OPTIONS') {
            // CORS preflight
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            });
        }

        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

