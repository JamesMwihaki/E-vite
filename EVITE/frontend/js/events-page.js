const EVENTS_ENDPOINT = "/api/create_event";
const RSVP_ENDPOINT = "/api/rsvp";
const RSVPS_ENDPOINT = "/api/rsvps";

(async function init() {
    const user = await checkAuth();
    if (!user) return;

    const welcomeEl = document.getElementById('welcome-text');
    if (welcomeEl) welcomeEl.textContent = greetingFor(user);

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    loadEvents();
})();

async function loadEvents() {
    const exclusiveList = document.getElementById('exclusive-list');
    const publicList = document.getElementById('public-list');

    try {
        const [eventsRes, rsvpsRes] = await Promise.all([
            fetch(EVENTS_ENDPOINT, { credentials: 'include' }),
            fetch(RSVPS_ENDPOINT, { credentials: 'include' }),
        ]);

        if (!eventsRes.ok) {
            throw new Error(`Events fetch failed: ${eventsRes.status}`);
        }

        const events = await eventsRes.json();
        const rsvps = rsvpsRes.ok ? await rsvpsRes.json() : [];
        const rsvpMap = new Map(rsvps.map(r => [r.event_id, r.status]));

        // Passed events are hidden from all lists (still reachable by link).
        const upcoming = events.filter(e => !isPastEvent(e));
        const exclusive = upcoming.filter(e => e.event_type === 'private');
        const publicEvents = upcoming.filter(e => e.event_type === 'public');

        renderList(exclusiveList, exclusive, rsvpMap, 'No upcoming exclusive e-vites');
        renderList(publicList, publicEvents, rsvpMap, 'No upcoming public e-vites');
    } catch (error) {
        console.error('Failed to load events:', error);
        renderError(exclusiveList, 'Error loading events');
        renderError(publicList, '');
    }
}

function renderList(container, events, rsvpMap, emptyText) {
    if (!container) return;
    container.innerHTML = '';
    if (events.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'event-empty';
        empty.textContent = emptyText;
        container.appendChild(empty);
        return;
    }
    for (const event of events) {
        container.appendChild(buildEventCard(event, rsvpMap.get(event.id)));
    }
}

function renderError(container, message) {
    if (!container) return;
    container.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'event-empty';
    empty.textContent = message;
    container.appendChild(empty);
}

function buildEventCard(event, rsvpStatus) {
    const card = document.createElement('div');
    card.className = 'ascii-frame event-card';
    card.dataset.eventId = event.id;

    const showRsvp = event.event_type === 'private';
    card.innerHTML = `
        <span class="corner tl">+</span>
        <span class="corner tr">+</span>
        <span class="corner bl">+</span>
        <span class="corner br">+</span>
        <span class="field event-title"></span>
        <span class="field event-location"></span>
        <span class="field event-date"></span>
        <span class="field event-description"></span>
        ${showRsvp ? `
            <div class="rsvp-block">
                <div class="rsvp-label">[ RSVP ]</div>
                <div class="rsvp-buttons">
                    <button type="button" class="rsvp-btn rsvp-yes">[ GOING ]</button>
                    <button type="button" class="rsvp-btn rsvp-no">[ NOT GOING ]</button>
                </div>
                <div class="rsvp-status"></div>
            </div>
        ` : ''}
    `;

    // The whole card opens the detail page; clicks on the RSVP buttons don't.
    card.addEventListener('click', (e) => {
        if (e.target.closest('.rsvp-btn')) return;
        window.location.href = `event.html?id=${event.id}`;
    });
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'link');
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') window.location.href = `event.html?id=${event.id}`;
    });

    card.querySelector('.event-title').textContent = event.title || '';
    card.querySelector('.event-location').textContent = `Location: ${event.location || ''}`;
    card.querySelector('.event-date').textContent = formatEventDate(event.event_date);
    card.querySelector('.event-description').textContent = `Description: ${event.description || ''}`;

    if (showRsvp) {
        const yesBtn = card.querySelector('.rsvp-yes');
        const noBtn  = card.querySelector('.rsvp-no');
        const statusEl = card.querySelector('.rsvp-status');

        if (rsvpStatus === 'going') {
            yesBtn.classList.add('selected');
            statusEl.textContent = 'Going';
        } else if (rsvpStatus === 'not_going') {
            noBtn.classList.add('selected');
            statusEl.textContent = 'Not going';
        }

        yesBtn.addEventListener('click', () => sendRsvp(event.id, 'going', yesBtn, noBtn, statusEl));
        noBtn.addEventListener('click', () => sendRsvp(event.id, 'not_going', noBtn, yesBtn, statusEl));
    }

    return card;
}

async function sendRsvp(eventId, status, clickedBtn, otherBtn, statusEl) {
    if (clickedBtn.classList.contains('selected')) return;
    clickedBtn.classList.add('selected');
    otherBtn.classList.remove('selected');
    statusEl.textContent = 'Sending...';

    const ok = await saveRsvp(eventId, status);
    if (!ok) {
        clickedBtn.classList.remove('selected');
        statusEl.textContent = '';
        return;
    }

    statusEl.textContent = '✓ Sent';
    const settledLabel = status === 'going' ? 'Going' : 'Not going';
    setTimeout(() => {
        // Only update if the "Sent" message is still showing (otherwise the
        // user clicked again and a newer state is in progress).
        if (statusEl.textContent === '✓ Sent') statusEl.textContent = settledLabel;
    }, 1500);
}

async function saveRsvp(eventId, status) {
    try {
        const response = await fetch(RSVP_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_id: eventId, status }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            alert(`RSVP failed: ${err.message || response.status}`);
            return false;
        }
        return true;
    } catch (error) {
        console.error('RSVP save failed:', error);
        alert('Could not save RSVP. Is the backend running?');
        return false;
    }
}

function isPastEvent(event) {
    if (!event.event_date) return false;
    const datePart = String(event.event_date).slice(0, 10);
    const timePart = (event.event_time || '23:59:59').slice(0, 8);
    const dt = new Date(`${datePart}T${timePart}`);
    return !Number.isNaN(dt.getTime()) && dt < new Date();
}

function formatEventDate(eventTime) {
    if (!eventTime) return '';
    const date = new Date(eventTime);
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}
