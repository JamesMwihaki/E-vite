const API = "";
const ME_URL = `${API}/api/me`;
const STATS_URL = `${API}/api/me/stats`;
const PASSWORD_URL = `${API}/api/me/password`;

const avatarEl = document.getElementById('avatar');
const fullNameEl = document.getElementById('full-name');
const handleEl = document.getElementById('handle');
const joinedEl = document.getElementById('joined');

const firstNameInput = document.getElementById('first_name');
const lastNameInput = document.getElementById('last_name');
const emailInput = document.getElementById('email');
const locationInput = document.getElementById('location');

const currentPwInput = document.getElementById('current_password');
const newPwInput = document.getElementById('new_password');

const profileMsgEl = document.getElementById('profile_message');
const passwordMsgEl = document.getElementById('password_message');

(async function init() {
    const user = await checkAuth();
    if (!user) return;

    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('save_profile_btn').addEventListener('click', saveProfile);
    document.getElementById('save_password_btn').addEventListener('click', savePassword);

    populateFromUser(user);
    loadStats();
})();

function populateFromUser(user) {
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
    const initial = ((user.first_name && user.first_name[0])
                  || (user.username && user.username[0])
                  || '?').toUpperCase();

    avatarEl.textContent = initial;
    fullNameEl.textContent = fullName;
    handleEl.textContent = `@${user.username}`;
    joinedEl.textContent = user.created_at ? `Joined ${formatJoinedDate(user.created_at)}` : '';

    firstNameInput.value = user.first_name || '';
    lastNameInput.value = user.last_name || '';
    emailInput.value = user.email || '';
    locationInput.value = user.location || '';
}

function formatJoinedDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadStats() {
    try {
        const response = await fetch(STATS_URL, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const stats = await response.json();
        document.getElementById('stat-friends').textContent = stats.friends ?? 0;
        document.getElementById('stat-created').textContent = stats.events_created ?? 0;
        document.getElementById('stat-going').textContent = stats.events_going ?? 0;
    } catch (error) {
        console.error('Stats load failed:', error);
    }
}

async function saveProfile() {
    setMsg(profileMsgEl, '');
    const payload = {
        first_name: firstNameInput.value.trim() || null,
        last_name: lastNameInput.value.trim() || null,
        email: emailInput.value.trim(),
        location: locationInput.value.trim() || null,
        // Sent silently so the event scout can run at 5 AM in the user's
        // local time without asking them to pick a timezone.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    };
    if (!payload.email) {
        setMsg(profileMsgEl, 'Email is required.', 'error');
        return;
    }
    try {
        const response = await fetch(ME_URL, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            setMsg(profileMsgEl, data.message || `Update failed (${response.status})`, 'error');
            return;
        }
        populateFromUser(data.user);
        setMsg(profileMsgEl, 'Saved.', 'success');
    } catch (error) {
        console.error('Save profile failed:', error);
        setMsg(profileMsgEl, 'Could not reach the server.', 'error');
    }
}

async function savePassword() {
    setMsg(passwordMsgEl, '');
    const current_password = currentPwInput.value;
    const new_password = newPwInput.value;
    if (!current_password || !new_password) {
        setMsg(passwordMsgEl, 'Both fields are required.', 'error');
        return;
    }
    if (new_password.length < 8) {
        setMsg(passwordMsgEl, 'New password must be at least 8 characters.', 'error');
        return;
    }
    try {
        const response = await fetch(PASSWORD_URL, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_password, new_password }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            setMsg(passwordMsgEl, data.message || `Update failed (${response.status})`, 'error');
            return;
        }
        currentPwInput.value = '';
        newPwInput.value = '';
        setMsg(passwordMsgEl, 'Password updated.', 'success');
    } catch (error) {
        console.error('Save password failed:', error);
        setMsg(passwordMsgEl, 'Could not reach the server.', 'error');
    }
}

function setMsg(el, text, kind) {
    el.textContent = text;
    el.classList.remove('error', 'success');
    if (kind) el.classList.add(kind);
}
