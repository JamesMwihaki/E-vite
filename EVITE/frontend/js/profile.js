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
    document.getElementById('detect_location_btn').addEventListener('click', () => detectLocation(false));

    populateFromUser(user);
    loadStats();

    // Device location is the primary source: if permission was already
    // granted, detect silently (no permission popup). An empty field is
    // filled in; a different saved city just gets a hint, never overwritten.
    // The text field stays as the manual fallback.
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' })
            .then((status) => {
                if (status.state === 'granted') detectLocation(true);
            })
            .catch(() => {});
    }
})();

// Coordinates from the last successful detection or chosen suggestion; sent
// with the save only while the field still holds that exact city, so hand
// edits don't carry stale coordinates (the server geocodes typed cities).
let detected = null;

/* ---- city typeahead ---- */

const suggestBox = document.getElementById('location-suggest');
let suggestTimer = null;
let suggestAbort = null;
let suggestItems = [];
let suggestIndex = -1;

locationInput.addEventListener('input', () => {
    const q = locationInput.value.trim();
    clearTimeout(suggestTimer);
    if (q.length < 2) { hideSuggest(); return; }
    // Debounced to stay friendly to the geocoder while typing.
    suggestTimer = setTimeout(() => fetchSuggestions(q), 350);
});

locationInput.addEventListener('keydown', (e) => {
    if (suggestBox.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        suggestIndex = (suggestIndex + dir + suggestItems.length) % suggestItems.length;
        renderSuggestHighlight();
    } else if (e.key === 'Enter' && suggestIndex >= 0) {
        e.preventDefault();
        chooseSuggestion(suggestItems[suggestIndex]);
    } else if (e.key === 'Escape') {
        hideSuggest();
    }
});

// Delay so a mousedown on a suggestion lands before the list disappears.
locationInput.addEventListener('blur', () => setTimeout(hideSuggest, 150));

async function fetchSuggestions(q) {
    if (suggestAbort) suggestAbort.abort();
    suggestAbort = new AbortController();
    try {
        const response = await fetch(`/api/geo/suggest?q=${encodeURIComponent(q)}`, {
            credentials: 'include',
            signal: suggestAbort.signal,
        });
        if (!response.ok) { hideSuggest(); return; }
        const items = await response.json();
        // Ignore stale responses if the field moved on while we fetched.
        if (locationInput.value.trim() !== q) return;
        suggestItems = items;
        suggestIndex = -1;
        if (!items.length) { hideSuggest(); return; }
        suggestBox.innerHTML = '';
        items.forEach((item, i) => {
            const row = document.createElement('div');
            row.className = 'suggest-item';
            row.textContent = item.location;
            // mousedown (not click) so it beats the input's blur handler.
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                chooseSuggestion(item);
            });
            row.addEventListener('mouseenter', () => {
                suggestIndex = i;
                renderSuggestHighlight();
            });
            suggestBox.appendChild(row);
        });
        suggestBox.hidden = false;
    } catch (error) {
        if (error.name !== 'AbortError') console.error('Suggest failed:', error);
    }
}

function renderSuggestHighlight() {
    [...suggestBox.children].forEach((el, i) =>
        el.classList.toggle('active', i === suggestIndex));
}

function chooseSuggestion(item) {
    locationInput.value = item.location;
    detected = item; // {location, latitude, longitude} — exact coords, no re-geocode
    hideSuggest();
    setMsg(profileMsgEl, `${item.location} selected — click SAVE CHANGES to apply.`, 'success');
}

function hideSuggest() {
    suggestBox.hidden = true;
    suggestBox.innerHTML = '';
    suggestItems = [];
    suggestIndex = -1;
}

function detectLocation(silent) {
    if (!navigator.geolocation) {
        if (!silent) setMsg(profileMsgEl, 'Geolocation is not supported by this browser — type your city instead.', 'error');
        return;
    }
    if (!silent) setMsg(profileMsgEl, 'Locating…');
    navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            const response = await fetch(
                `/api/geo/locate?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`,
                { credentials: 'include' }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (!silent) setMsg(profileMsgEl, data.message || 'Could not detect your city — type it instead.', 'error');
                return;
            }
            detected = {
                location: data.location,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
            };
            const current = locationInput.value.trim();
            if (silent && current && current.toLowerCase() !== data.location.toLowerCase()) {
                setMsg(profileMsgEl, `⌖ You appear to be in ${data.location} — tap USE MY LOCATION to update.`);
                return;
            }
            locationInput.value = data.location;
            if (current.toLowerCase() !== data.location.toLowerCase()) {
                setMsg(profileMsgEl, `Detected ${data.location} — click SAVE CHANGES to apply.`, 'success');
            }
        } catch (error) {
            console.error('Location detect failed:', error);
            if (!silent) setMsg(profileMsgEl, 'Could not detect your city — type it instead.', 'error');
        }
    }, () => {
        if (!silent) setMsg(profileMsgEl, 'Location permission denied — type your city instead.', 'error');
    }, { timeout: 10000 });
}

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
    const locationValue = locationInput.value.trim() || null;
    const useDetected = detected && locationValue
        && locationValue.toLowerCase() === detected.location.toLowerCase();
    const payload = {
        first_name: firstNameInput.value.trim() || null,
        last_name: lastNameInput.value.trim() || null,
        email: emailInput.value.trim(),
        location: locationValue,
        latitude: useDetected ? detected.latitude : null,
        longitude: useDetected ? detected.longitude : null,
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
        cacheUser(data.user); // keep the cached greeting/name in sync
        setMsg(profileMsgEl, data.scouting
            ? 'Saved. ⚡ The scout is searching for events near you — check the events page in a few minutes.'
            : 'Saved.', 'success');
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
