// Public invitation page — reached from the email link, no login required.
const token = new URLSearchParams(window.location.search).get('token');

(async function init() {
    if (!token) {
        showError('This invitation link is missing its token.');
        return;
    }
    try {
        const res = await fetch(`/api/invite/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            showError(data.message || 'Could not load this invitation.');
            return;
        }
        render(data);
    } catch (error) {
        console.error('Invite load failed:', error);
        showError('Could not load this invitation. Please try again.');
    }
})();

function showError(message) {
    document.getElementById('loading-state').classList.add('hidden');
    const el = document.getElementById('error-state');
    el.classList.remove('hidden');
    el.textContent = message;
}

function render({ status, event, inviter, invitee_email }) {
    document.getElementById('loading-state').classList.add('hidden');

    // Make signup seamless: carry the invited email into the signup form.
    if (invitee_email) {
        const signupLink = document.querySelector('.signup-nudge a');
        if (signupLink) signupLink.href = `signup.html?email=${encodeURIComponent(invitee_email)}`;
    }
    for (const id of ['invite-section', 'event-section', 'rsvp-section']) {
        document.getElementById(id).classList.remove('hidden');
    }

    document.title = `${event.title} · E-vite`;
    document.getElementById('invited-by').textContent = `${inviter} invited you to:`;
    document.getElementById('event-title').textContent = event.title || '(untitled)';
    document.getElementById('event-when').textContent = formatWhen(event.event_date, event.event_time);
    document.getElementById('event-where').textContent = event.location || 'TBD';
    if (event.description) {
        document.getElementById('event-desc').textContent = event.description;
    } else {
        document.getElementById('event-desc-row').classList.add('hidden');
    }

    const acceptBtn = document.getElementById('accept-btn');
    const declineBtn = document.getElementById('decline-btn');
    const message = document.getElementById('rsvp-message');

    if (status === 'accepted') markResponded(acceptBtn, declineBtn, message, 'You are going!');
    if (status === 'declined') markResponded(declineBtn, acceptBtn, message, "You can't make it.");

    acceptBtn.addEventListener('click', () => respond('accepted', acceptBtn, declineBtn, message));
    declineBtn.addEventListener('click', () => respond('declined', declineBtn, acceptBtn, message));
}

function markResponded(selectedBtn, otherBtn, message, text) {
    selectedBtn.classList.add('selected');
    otherBtn.classList.remove('selected');
    message.textContent = `${text} (You can change your answer.)`;
    message.className = 'message success';
}

async function respond(status, clickedBtn, otherBtn, message) {
    message.textContent = 'Sending…';
    message.className = 'message';
    try {
        const res = await fetch(`/api/invite/${encodeURIComponent(token)}/rsvp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            message.textContent = data.message || 'Could not save your RSVP.';
            message.className = 'message error';
            return;
        }
        markResponded(clickedBtn, otherBtn, message,
            status === 'accepted' ? 'You are going!' : "You can't make it.");
    } catch (error) {
        console.error('RSVP failed:', error);
        message.textContent = 'Could not save your RSVP. Please try again.';
        message.className = 'message error';
    }
}

function formatWhen(eventDate, eventTime) {
    if (!eventDate) return 'TBD';
    const datePart = String(eventDate).slice(0, 10);
    const timePart = (eventTime || '00:00:00').slice(0, 8);
    const dt = new Date(`${datePart}T${timePart}`);
    if (Number.isNaN(dt.getTime())) return 'TBD';
    const dateStr = dt.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const timeStr = eventTime
        ? dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '';
    return timeStr ? `${dateStr} · ${timeStr}` : dateStr;
}
