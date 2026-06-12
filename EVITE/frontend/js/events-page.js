const EVENTS_ENDPOINT = "/api/create_event";
const RSVP_ENDPOINT = "/api/rsvp";
const RSVPS_ENDPOINT = "/api/rsvps";

// Fetched once; re-rendered whenever the date filter changes.
let allEvents = [];
let rsvpMap = new Map();
const dateFilter = { from: null, to: null }; // YYYY-MM-DD strings

(async function init() {
    const user = await checkAuth();
    if (!user) return;

    const welcomeEl = document.getElementById('welcome-text');
    if (welcomeEl) welcomeEl.textContent = greetingFor(user);

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    wireDateFilter();
    loadEvents();
})();

async function loadEvents() {
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
        rsvpMap = new Map(rsvps.map(r => [r.event_id, r.status]));

        // Passed events are hidden from all lists (still reachable by link).
        allEvents = events.filter(e => !isPastEvent(e));
        renderLists();
    } catch (error) {
        console.error('Failed to load events:', error);
        renderError(document.getElementById('exclusive-list'), 'Error loading events');
        renderError(document.getElementById('public-list'), '');
    }
}

function renderLists() {
    const exclusiveSection = document.getElementById('exclusive-section');
    const publicSection = document.getElementById('public-section');
    const exclusiveList = document.getElementById('exclusive-list');
    const publicList = document.getElementById('public-list');

    // Closest date first; the date filter applies to both lists.
    const visible = allEvents
        .filter(inDateFilter)
        .sort((a, b) => (eventDateValue(a) ?? 0) - (eventDateValue(b) ?? 0));
    const exclusive = visible.filter(e => e.event_type === 'private');
    const publicEvents = visible.filter(e => e.event_type === 'public');

    // When one side has nothing to show, give the other the whole page.
    // Optional chaining: my-evites.html shares this script but only has the
    // exclusive list, no section wrappers.
    const onlyPublic = exclusive.length === 0 && publicEvents.length > 0;
    const onlyExclusive = publicEvents.length === 0 && exclusive.length > 0;
    exclusiveSection?.classList.toggle('hidden', onlyPublic);
    publicSection?.classList.toggle('hidden', onlyExclusive);
    exclusiveList?.classList.toggle('expanded', onlyExclusive);
    publicList?.classList.toggle('expanded', onlyPublic);

    const filtered = dateFilter.from || dateFilter.to;
    renderList(exclusiveList, exclusive, rsvpMap,
        filtered ? 'No exclusive e-vites in this date range' : 'No upcoming exclusive e-vites');
    renderList(publicList, publicEvents, rsvpMap,
        filtered ? 'No public e-vites in this date range' : 'No upcoming public e-vites');
}

/* ---- date filter ---- */

function wireDateFilter() {
    const fromInput = document.getElementById('filter-from');
    const toInput = document.getElementById('filter-to');
    if (!fromInput || !toInput) return; // page without the filter bar

    document.querySelectorAll('.filter-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const today = localISODate(new Date());
            const ranges = {
                all: [null, null],
                today: [today, today],
                week: [today, localISODate(addDays(new Date(), 7))],
                month: [today, localISODate(addDays(new Date(), 30))],
            };
            const [from, to] = ranges[btn.dataset.range] || [null, null];
            dateFilter.from = from;
            dateFilter.to = to;
            fromInput.value = from || '';
            toInput.value = to || '';
            setActiveFilterBtn(btn);
            renderLists();
        });
    });

    const onDateInput = () => {
        dateFilter.from = fromInput.value || null;
        dateFilter.to = toInput.value || null;
        setActiveFilterBtn(null); // custom range — no preset highlighted
        renderLists();
    };
    // Both events: 'input' fires as soon as a typed date becomes valid;
    // 'change' covers browsers that only commit date fields on blur.
    for (const input of [fromInput, toInput]) {
        input.addEventListener('input', onDateInput);
        input.addEventListener('change', onDateInput);
    }
}

function setActiveFilterBtn(activeBtn) {
    document.querySelectorAll('.filter-btn').forEach((btn) =>
        btn.classList.toggle('active', btn === activeBtn));
}

function inDateFilter(event) {
    const day = String(event.event_date || '').slice(0, 10);
    if (!day) return true;
    if (dateFilter.from && day < dateFilter.from) return false;
    if (dateFilter.to && day > dateFilter.to) return false;
    return true;
}

function localISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, days) {
    d.setDate(d.getDate() + days);
    return d;
}

function eventDateValue(event) {
    if (!event.event_date) return null;
    const datePart = String(event.event_date).slice(0, 10);
    const timePart = (event.event_time || '00:00:00').slice(0, 8);
    const dt = new Date(`${datePart}T${timePart}`);
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
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
        ${event.discovered ? '<span class="field event-discovered">[ ⚡ FOUND NEARBY ]</span>' : ''}
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
    card.querySelector('.event-date').textContent = formatEventDate(event);
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
    if (Number.isNaN(dt.getTime())) return false;
    // Public events linger for an hour after start ("it just started, head
    // over"); exclusive ones drop off at start time as before.
    if (event.event_type === 'public') {
        dt.setHours(dt.getHours() + 1);
    }
    return dt < new Date();
}

// Built from the date string + event_time, like the detail page does.
// Parsing the raw event_date timestamp shifts the day for viewers west of
// UTC (a June 20 event renders as June 19, 7:00 PM in Central).
function formatEventDate(event) {
    if (!event.event_date) return '';
    const datePart = String(event.event_date).slice(0, 10);
    const timePart = (event.event_time || '00:00:00').slice(0, 8);
    const dt = new Date(`${datePart}T${timePart}`);
    if (Number.isNaN(dt.getTime())) return '';
    const dateStr = dt.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
    });
    if (!event.event_time) return dateStr;
    return `${dateStr} · ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
