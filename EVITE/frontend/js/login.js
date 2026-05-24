const LOGIN_ENDPOINT = "/api/login";

const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const errorEl = document.getElementById('error');

document.getElementById('login_btn').addEventListener('click', handleLogin);
passwordEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
});

async function handleLogin() {
    errorEl.textContent = '';
    const username = usernameEl.value.trim();
    const password = passwordEl.value;

    if (!username || !password) {
        errorEl.textContent = 'Username and password required.';
        return;
    }

    try {
        const response = await fetch(LOGIN_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            errorEl.textContent = data.message || `Login failed (${response.status})`;
            return;
        }

        window.location.href = 'landing-page.html';
    } catch (error) {
        console.error('Login request failed:', error);
        errorEl.textContent = 'Could not reach the server. Is the backend running?';
    }
}
