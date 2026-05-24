const ME_ENDPOINT = "/api/me";
const LOGOUT_ENDPOINT = "/api/logout";

// Resolves to the current user, or redirects to login and returns null if not authenticated.
async function checkAuth() {
    try {
        const response = await fetch(ME_ENDPOINT, { credentials: 'include' });
        if (response.status === 401) {
            window.location.href = 'login.html';
            return null;
        }
        if (!response.ok) {
            console.error('/api/me failed:', response.status);
            window.location.href = 'login.html';
            return null;
        }
        const { user } = await response.json();
        return user;
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = 'login.html';
        return null;
    }
}

async function logout() {
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
