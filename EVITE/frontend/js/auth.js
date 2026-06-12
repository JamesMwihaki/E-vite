const ME_ENDPOINT = "/api/me";
const LOGOUT_ENDPOINT = "/api/logout";
const USER_CACHE_KEY = "evite_user";

// The user is cached in sessionStorage so page navigation renders instantly
// instead of blocking on a /api/me round trip (slow on serverless cold
// starts). The cache is a UX hint only — every API call is still session-
// checked server-side; a dead session gets caught by the background
// revalidation (or by any data fetch) and redirects to login.
function cachedUser() {
    try {
        return JSON.parse(sessionStorage.getItem(USER_CACHE_KEY));
    } catch {
        return null;
    }
}

function cacheUser(user) {
    try {
        if (user) sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
        else sessionStorage.removeItem(USER_CACHE_KEY);
    } catch { /* storage unavailable — fall back to network checks */ }
}

// Resolves to the current user, or redirects to login and returns null if not
// authenticated. Returns the cached user immediately when available and
// revalidates the session in the background.
async function checkAuth() {
    const cached = cachedUser();
    if (cached) {
        revalidateAuth();
        return cached;
    }
    return fetchCurrentUser();
}

async function fetchCurrentUser() {
    try {
        const response = await fetch(ME_ENDPOINT, { credentials: 'include' });
        if (!response.ok) {
            if (response.status !== 401) console.error('/api/me failed:', response.status);
            cacheUser(null);
            window.location.href = 'login.html';
            return null;
        }
        const { user } = await response.json();
        cacheUser(user);
        return user;
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = 'login.html';
        return null;
    }
}

async function revalidateAuth() {
    try {
        const response = await fetch(ME_ENDPOINT, { credentials: 'include' });
        if (!response.ok) {
            cacheUser(null);
            window.location.href = 'login.html';
            return;
        }
        const { user } = await response.json();
        cacheUser(user); // keep the cache fresh (name/location edits, etc.)
    } catch {
        // Network blip — keep showing the cached view; the next data fetch
        // or navigation will surface a real outage.
    }
}

async function logout() {
    cacheUser(null);
    try {
        await fetch(LOGOUT_ENDPOINT, { method: 'POST', credentials: 'include' });
    } catch (error) {
        console.error('Logout request failed:', error);
    }
    window.location.href = 'login.html';
}

function greetingFor(user) {
    if (!user) return '';
    const name = user.first_name || user.username || '';
    return name ? `Welcome back, ${name}!` : 'Welcome back!';
}
