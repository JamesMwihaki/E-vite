const createEventEndpoint = "/api/create_event";
const invitationsEndpoint = "/api/invitations";

const pickerMetaEl = document.getElementById('picker-meta');

// Unified add-people field (shared invite-picker component): platform users
// arrive as chips via name/@username suggestions, emails as email chips.
const invitePicker = createInvitePicker({
    inputEl: document.getElementById('invite-input'),
    chipsEl: document.getElementById('invite-chips'),
    suggestEl: document.getElementById('invite-suggest'),
    onChange: () => {
        const { users, emails } = invitePicker.counts();
        const parts = [];
        if (users) parts.push(`${users} on E-vite`);
        if (emails) parts.push(`${emails} by email`);
        pickerMetaEl.textContent = parts.join(' · ');
    },
});

// When arriving via "create exclusive e-vite from this" on a public event,
// ?from=<id> pre-fills the form. Only set once the source is fetched and
// confirmed, so a bogus param can't end up on the created event.
let sourceEventId = null;

(async function init() {
    const user = await checkAuth();
    if (!user) return;

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    setupDateTimeGuards();

    const fromParam = Number(new URLSearchParams(window.location.search).get('from'));
    if (Number.isInteger(fromParam) && fromParam > 0) {
        prefillFromSource(fromParam);
    }
})();

/* Events can only be scheduled from this moment forward: the date picker
   won't offer past days, the time picker's minimum tracks "now" while
   today is selected, and the form defaults to today at the next full hour. */

function localISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setupDateTimeGuards() {
    const dateInput = document.getElementById('event_date');
    const timeInput = document.getElementById('eventTime');

    const today = localISODate(new Date());
    dateInput.min = today;

    if (!dateInput.value) {
        const nextHour = new Date();
        nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
        dateInput.value = localISODate(nextHour); // rolls to tomorrow at 23:xx
        timeInput.value = `${String(nextHour.getHours()).padStart(2, '0')}:00`;
    }

    const syncTimeMin = () => {
        const now = new Date();
        timeInput.min = dateInput.value === localISODate(now)
            ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
            : '';
    };
    syncTimeMin();
    dateInput.addEventListener('input', syncTimeMin);
}

function showFormError(text) {
    const message = document.getElementById('create_message');
    message.textContent = text;
    message.className = text ? 'message error' : 'message';
}

async function prefillFromSource(fromId) {
    try {
        const res = await fetch(`/api/events/${fromId}`, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { event } = await res.json();
        if (event.event_type !== 'public') return; // only public events can be forked

        document.getElementById('event_name').value = event.title || '';
        document.getElementById('eventDescription').value = event.description || '';
        document.getElementById('event_date').value = (event.event_date || '').slice(0, 10);
        document.getElementById('eventTime').value = (event.event_time || '').slice(0, 5);
        document.getElementById('event_location').value = event.location || '';
        document.getElementById('private').checked = true;

        sourceEventId = event.id;
        const note = document.getElementById('prefill-note');
        note.textContent = `Creating an exclusive e-vite based on "${event.title}" — tweak anything you like, then invite your tree.`;
        note.classList.remove('hidden');
    } catch (error) {
        console.error('Could not prefill from source event:', error);
    }
}

document.getElementById('create_event').addEventListener('click', handleCreateEvent);

function readEventData() {
    const checkedType = document.querySelector('input[name="eventType"]:checked');
    return {
        title: document.getElementById('event_name').value,
        description: document.getElementById('eventDescription').value,
        date: document.getElementById('event_date').value,
        time: document.getElementById('eventTime').value,
        location: document.getElementById('event_location').value,
        type: checkedType ? checkedType.value : 'public',
        source_event_id: sourceEventId,
    };
}

async function createEvent(eventData) {
    const response = await fetch(createEventEndpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }
    return data;
}

async function handleCreateEvent() {
    const eventData = readEventData();
    const emails = invitePicker.getEmails();
    const friend_ids = invitePicker.getFriendIds();

    showFormError('');
    if (!eventData.title.trim() || !eventData.date || !eventData.time) {
        showFormError('Title, date, and time are required.');
        return;
    }
    const when = new Date(`${eventData.date}T${eventData.time}`);
    if (Number.isNaN(when.getTime()) || when < new Date()) {
        showFormError('Pick a date and time from this moment forward.');
        return;
    }

    try {
        const eventResult = await createEvent(eventData);
        const eventId = eventResult.eventID;

        // If no invitees selected, just confirm and leave.
        if (emails.length === 0 && friend_ids.length === 0) {
            flashAndGoHome(`✓ "${eventData.title}" created`);
            return;
        }

        const inviteRes = await fetch(invitationsEndpoint, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_id: eventId, emails, friend_ids }),
        });
        const inviteResult = await inviteRes.json();
        if (!inviteRes.ok) {
            throw new Error(inviteResult.error || inviteResult.message || `HTTP ${inviteRes.status}`);
        }

        const sentCount = inviteResult.created.length;
        const skippedCount = inviteResult.skipped.length;
        const text = `✓ "${eventData.title}" created · ${sentCount} e-vite${sentCount === 1 ? '' : 's'} sent`;
        let detail = null;
        if (skippedCount > 0) {
            detail = `Skipped ${skippedCount}: ` + inviteResult.skipped.map(s => {
                const target = s.email || `friend #${s.friend_id}`;
                return `${target} (${s.reason})`;
            }).join(', ');
        }
        flashAndGoHome(text, detail);
    } catch (error) {
        console.error('Create event failed:', error);
        showFormError(`Could not create event: ${error.message}`);
    }
}

// Confirmation shows as a toast on the home page (rendered by events-page.js)
// instead of a blocking browser alert.
function flashAndGoHome(text, detail) {
    try {
        sessionStorage.setItem('evite_flash', JSON.stringify({ text, detail: detail || null }));
    } catch { /* storage unavailable — skip the toast, the redirect still confirms */ }
    window.location.href = 'landing-page.html';
}
