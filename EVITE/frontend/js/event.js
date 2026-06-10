const EVENT_ENDPOINT = '/api/events';
const RSVP_POST_ENDPOINT = '/api/rsvp';

const eventId = Number(new URLSearchParams(window.location.search).get('id'));
let currentEvent = null;

(async function init() {
    const user = await checkAuth();
    if (!user) return;

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    if (!Number.isInteger(eventId) || eventId <= 0) {
        showError('No event specified.');
        return;
    }
    loadEvent();
})();

async function loadEvent() {
    try {
        const res = await fetch(`${EVENT_ENDPOINT}/${eventId}`, { credentials: 'include' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            showError(err.message || `Could not load event (${res.status})`);
            return;
        }
        render(await res.json());
    } catch (error) {
        console.error('Failed to load event:', error);
        showError('Could not load event. Is the backend running?');
    }
}

function showError(message) {
    document.getElementById('loading-state').classList.add('hidden');
    const errorEl = document.getElementById('error-state');
    errorEl.classList.remove('hidden');
    errorEl.innerHTML = '';
    errorEl.append(message, document.createElement('br'));
    const back = document.createElement('a');
    back.href = 'landing-page.html';
    back.textContent = '< Back to home';
    errorEl.appendChild(back);
}

function render(data) {
    const { event, is_creator, my_rsvp, attendees, invitations } = data;
    currentEvent = event;

    const when = eventDateTime(event.event_date, event.event_time);
    const passed = when !== null && when < new Date();

    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('error-state').classList.add('hidden');
    document.getElementById('info-section').classList.remove('hidden');
    document.getElementById('attendees-section').classList.remove('hidden');

    document.title = `${event.title} · E-vite`;
    document.getElementById('event-title').textContent = event.title || '(untitled)';

    const badge = document.getElementById('type-badge');
    badge.textContent = event.event_type === 'private' ? 'PRIVATE' : 'PUBLIC';
    badge.classList.toggle('private', event.event_type === 'private');

    const hostName = [event.creator_first_name, event.creator_last_name].filter(Boolean).join(' ')
        || event.creator_username;
    document.getElementById('hosted-by').textContent =
        is_creator ? 'Hosted by you' : `Hosted by ${hostName} (@${event.creator_username})`;

    document.getElementById('event-when').textContent = formatWhen(event.event_date, event.event_time);
    document.getElementById('event-where').textContent = event.location || 'TBD';
    document.getElementById('event-desc').textContent = event.description || 'No description yet.';
    renderCountdown(event.event_date, event.event_time);

    // Forked exclusive events link back to the public event they came from.
    const basedOn = document.getElementById('based-on');
    if (event.source_event_id && event.source_title) {
        basedOn.classList.remove('hidden');
        basedOn.innerHTML = '';
        basedOn.append('Based on: ');
        const link = document.createElement('a');
        link.href = `event.html?id=${event.source_event_id}`;
        link.textContent = event.source_title;
        basedOn.appendChild(link);
    } else {
        basedOn.classList.add('hidden');
    }

    // Any viewer can fork a public event into their own exclusive e-vite —
    // unless it has already happened.
    const forkSection = document.getElementById('fork-section');
    if (event.event_type === 'public' && !passed) {
        forkSection.classList.remove('hidden');
        document.getElementById('fork-btn').href = `create-event.html?from=${event.id}`;
    } else {
        forkSection.classList.add('hidden');
    }

    renderAttendees(attendees);

    // Guests RSVP; the host doesn't RSVP to their own event.
    if (!is_creator && event.event_type === 'private' && !passed) {
        document.getElementById('rsvp-section').classList.remove('hidden');
        wireRsvp(my_rsvp);
    } else {
        document.getElementById('rsvp-section').classList.add('hidden');
    }

    if (is_creator) {
        document.getElementById('manage-section').classList.remove('hidden');
        renderInvited(invitations);
        wireManage();
    }
}

function renderCountdown(eventDate, eventTime) {
    const el = document.getElementById('countdown');
    const when = eventDateTime(eventDate, eventTime);
    if (!when) { el.textContent = ''; return; }

    const now = new Date();
    const days = Math.ceil((when - now) / (24 * 60 * 60 * 1000));
    if (when < now) {
        el.textContent = 'This event has passed';
        el.classList.add('past');
    } else if (days <= 0) {
        el.textContent = 'Happening today!';
    } else if (days === 1) {
        el.textContent = 'Tomorrow';
    } else {
        el.textContent = `In ${days} days`;
    }
}

function renderAttendees(attendees) {
    const list = document.getElementById('attendees-list');
    const summary = document.getElementById('attend-summary');
    list.innerHTML = '';

    const going = attendees.filter(a => a.status === 'going');
    const notGoing = attendees.filter(a => a.status === 'not_going');
    summary.textContent = `${going.length} going · ${notGoing.length} can't make it`;

    if (attendees.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No RSVPs yet — be the first!';
        list.appendChild(empty);
        return;
    }
    // Going first, then not-going.
    for (const person of [...going, ...notGoing]) {
        list.appendChild(personRow(
            displayName(person),
            `@${person.username}`,
            person.status === 'going' ? 'GOING' : 'NOT GOING',
            person.status === 'going' ? 'going' : 'not-going'
        ));
    }
}

function renderInvited(invitations) {
    if (!invitations || invitations.length === 0) return;
    document.getElementById('invited-section').classList.remove('hidden');
    const list = document.getElementById('invited-list');
    list.innerHTML = '';
    for (const inv of invitations) {
        const name = inv.invitee_user_id
            ? (displayName({
                  first_name: inv.invitee_first_name,
                  last_name: inv.invitee_last_name,
                  username: inv.invitee_username,
              }))
            : inv.invitee_email;
        const sub = inv.invitee_user_id ? `@${inv.invitee_username}` : 'by email';
        const statusClass = inv.status === 'accepted' ? 'going'
            : inv.status === 'declined' ? 'not-going' : 'pending';
        list.appendChild(personRow(name, sub, inv.status.toUpperCase(), statusClass));
    }
}

function personRow(name, sub, statusText, statusClass) {
    const row = document.createElement('div');
    row.className = 'ascii-frame person-row';
    row.innerHTML = `
        <span class="corner tl">+</span>
        <span class="corner tr">+</span>
        <span class="corner bl">+</span>
        <span class="corner br">+</span>
        <span class="person-info">
            <span class="person-name"></span>
            <span class="person-sub"></span>
        </span>
        <span class="person-status"></span>
    `;
    row.querySelector('.person-name').textContent = name;
    row.querySelector('.person-sub').textContent = ` ${sub}`;
    const statusEl = row.querySelector('.person-status');
    statusEl.textContent = `[${statusText}]`;
    statusEl.classList.add(statusClass);
    return row;
}

/* ---- RSVP ---- */

function wireRsvp(myRsvp) {
    const yesBtn = document.getElementById('rsvp-yes');
    const noBtn = document.getElementById('rsvp-no');
    const statusEl = document.getElementById('rsvp-status');

    if (myRsvp === 'going') yesBtn.classList.add('selected');
    if (myRsvp === 'not_going') noBtn.classList.add('selected');

    yesBtn.addEventListener('click', () => sendRsvp('going', yesBtn, noBtn, statusEl));
    noBtn.addEventListener('click', () => sendRsvp('not_going', noBtn, yesBtn, statusEl));
}

async function sendRsvp(status, clickedBtn, otherBtn, statusEl) {
    if (clickedBtn.classList.contains('selected')) return;
    clickedBtn.classList.add('selected');
    otherBtn.classList.remove('selected');
    statusEl.textContent = 'Sending...';

    try {
        const res = await fetch(RSVP_POST_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_id: eventId, status }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            statusEl.textContent = `Failed: ${err.message || res.status}`;
            clickedBtn.classList.remove('selected');
            return;
        }
        statusEl.textContent = '✓ Sent';
        loadEvent(); // refresh the who's-going list
    } catch (error) {
        console.error('RSVP failed:', error);
        statusEl.textContent = 'Could not save RSVP.';
        clickedBtn.classList.remove('selected');
    }
}

/* ---- Creator: edit + delete ---- */

let manageWired = false;

function wireManage() {
    if (manageWired) return; // render() runs again after edits; wire once
    manageWired = true;

    const editBtn = document.getElementById('edit-btn');
    const deleteBtn = document.getElementById('delete-btn');
    const form = document.getElementById('edit-form');
    const cancelBtn = document.getElementById('cancel-btn');
    const buttons = document.getElementById('manage-buttons');
    const message = document.getElementById('manage-message');

    editBtn.addEventListener('click', () => {
        fillEditForm();
        form.classList.remove('hidden');
        buttons.classList.add('hidden');
        message.textContent = '';
        message.className = 'message';
    });

    cancelBtn.addEventListener('click', () => {
        form.classList.add('hidden');
        buttons.classList.remove('hidden');
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveEdit(form, buttons, message);
    });

    // Two-step delete: first click arms the button, second click deletes.
    let armed = false;
    let disarmTimer = null;
    deleteBtn.addEventListener('click', async () => {
        if (!armed) {
            armed = true;
            deleteBtn.classList.add('armed');
            deleteBtn.lastChild.textContent = ' [ CLICK AGAIN TO CONFIRM ] ';
            disarmTimer = setTimeout(() => {
                armed = false;
                deleteBtn.classList.remove('armed');
                deleteBtn.lastChild.textContent = ' [ DELETE ] ';
            }, 4000);
            return;
        }
        clearTimeout(disarmTimer);
        await deleteEvent(message);
    });
}

function fillEditForm() {
    document.getElementById('edit-title').value = currentEvent.title || '';
    document.getElementById('edit-description').value = currentEvent.description || '';
    // event_date arrives as an ISO timestamp; date inputs want YYYY-MM-DD.
    document.getElementById('edit-date').value = (currentEvent.event_date || '').slice(0, 10);
    // event_time arrives as HH:MM:SS; time inputs want HH:MM.
    document.getElementById('edit-time').value = (currentEvent.event_time || '').slice(0, 5);
    document.getElementById('edit-location').value = currentEvent.location || '';
}

async function saveEdit(form, buttons, message) {
    message.textContent = 'Saving...';
    message.className = 'message';
    try {
        const res = await fetch(`${EVENT_ENDPOINT}/${eventId}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: document.getElementById('edit-title').value.trim(),
                description: document.getElementById('edit-description').value.trim(),
                date: document.getElementById('edit-date').value,
                time: document.getElementById('edit-time').value,
                location: document.getElementById('edit-location').value.trim(),
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            message.textContent = `Save failed: ${err.message || res.status}`;
            message.className = 'message error';
            return;
        }
        form.classList.add('hidden');
        buttons.classList.remove('hidden');
        message.textContent = '✓ Event updated';
        message.className = 'message success';
        loadEvent();
    } catch (error) {
        console.error('Save failed:', error);
        message.textContent = 'Save failed. Is the backend running?';
        message.className = 'message error';
    }
}

async function deleteEvent(message) {
    message.textContent = 'Deleting...';
    message.className = 'message';
    try {
        const res = await fetch(`${EVENT_ENDPOINT}/${eventId}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            message.textContent = `Delete failed: ${err.message || res.status}`;
            message.className = 'message error';
            return;
        }
        window.location.href = 'my-evites.html';
    } catch (error) {
        console.error('Delete failed:', error);
        message.textContent = 'Delete failed. Is the backend running?';
        message.className = 'message error';
    }
}

/* ---- Formatting helpers ---- */

function displayName(person) {
    return [person.first_name, person.last_name].filter(Boolean).join(' ') || person.username;
}

function eventDateTime(eventDate, eventTime) {
    if (!eventDate) return null;
    const datePart = String(eventDate).slice(0, 10);
    const timePart = (eventTime || '00:00:00').slice(0, 8);
    const dt = new Date(`${datePart}T${timePart}`);
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatWhen(eventDate, eventTime) {
    const dt = eventDateTime(eventDate, eventTime);
    if (!dt) return 'TBD';
    const dateStr = dt.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeStr = eventTime
        ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '';
    return timeStr ? `${dateStr} · ${timeStr}` : dateStr;
}
