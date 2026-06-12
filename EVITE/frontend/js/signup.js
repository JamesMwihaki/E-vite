const SIGNUP_ENDPOINT = "/api/signup";

const errorEl = document.getElementById('error');

// Arriving from an email invitation ("Create an E-vite account" on the
// invite page) prefills the invited address — signing up with it is what
// links the invitation to the new account.
const prefillEmail = new URLSearchParams(window.location.search).get('email');
if (prefillEmail) document.getElementById('email').value = prefillEmail;

document.getElementById('signup_btn').addEventListener('click', handleSignup);
document.getElementById('password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSignup();
});

async function handleSignup() {
    errorEl.textContent = '';
    const payload = {
        first_name: document.getElementById('first_name').value.trim() || null,
        last_name: document.getElementById('last_name').value.trim() || null,
        username: document.getElementById('username').value.trim(),
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value,
    };

    if (!payload.username || !payload.email || !payload.password) {
        errorEl.textContent = 'Username, email, and password are required.';
        return;
    }

    try {
        const response = await fetch(SIGNUP_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            errorEl.textContent = data.message || `Signup failed (${response.status})`;
            return;
        }

        // Seed the auth cache (same key auth.js reads) so the landing page
        // renders without waiting on a /api/me round trip.
        try { sessionStorage.setItem('evite_user', JSON.stringify(data.user)); } catch {}
        window.location.href = 'landing-page.html';
    } catch (error) {
        console.error('Signup request failed:', error);
        errorEl.textContent = 'Could not reach the server. Is the backend running?';
    }
}
