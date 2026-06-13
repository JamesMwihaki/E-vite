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
    const hostedBy = document.getElementById('hosted-by');
    if (event.discovered) {
        // Agent-found events have no human host; show provenance instead.
        hostedBy.innerHTML = '';
        hostedBy.append('⚡ Found nearby by the E-vite scout');
        if (event.source_url) {
            hostedBy.append(' · ');
            const src = document.createElement('a');
            src.href = event.source_url;
            src.target = '_blank';
            src.rel = 'noopener';
            src.textContent = 'source';
            hostedBy.appendChild(src);
        }
    } else {
        hostedBy.textContent =
            is_creator ? 'Hosted by you' : `Hosted by ${hostName} (@${event.creator_username})`;
    }

    document.getElementById('event-when').textContent = formatWhen(event.event_date, event.event_time);
    document.getElementById('event-where').textContent = event.location || 'TBD';
    document.getElementById('event-desc').textContent = event.description || 'No description yet.';
    renderCountdown(event.event_date, event.event_time);

    renderFriendOffer(event, is_creator);

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
        document.getElementById('add-invite-section').classList.remove('hidden');
        renderInvited(invitations);
        // Friends already on the invite list shouldn't be offered again.
        invitedUserIds = new Set((invitations || [])
            .map(i => i.invitee_user_id).filter(Boolean));
        wireManage();
        wireAddInvites();
        renderInviteFriends();
    }

    initChat();
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
        const row = personRow(name, sub, inv.status.toUpperCase(), statusClass);

        // The creator can uninvite; two-click confirm like the delete button.
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'person-remove';
        removeBtn.textContent = '[ × ]';
        removeBtn.title = 'Remove from event';
        let armed = false;
        removeBtn.addEventListener('click', async () => {
            if (!armed) {
                armed = true;
                removeBtn.textContent = '[ REMOVE? ]';
                setTimeout(() => { armed = false; removeBtn.textContent = '[ × ]'; }, 4000);
                return;
            }
            removeBtn.disabled = true;
            try {
                const res = await fetch(`/api/invitations/${inv.id}`, {
                    method: 'DELETE',
                    credentials: 'include',
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    removeBtn.disabled = false;
                    removeBtn.textContent = '[ × ]';
                    alert(`Remove failed: ${err.message || res.status}`);
                    return;
                }
                loadEvent(); // refresh invited + attendee lists
            } catch (error) {
                console.error('Remove invitation failed:', error);
                removeBtn.disabled = false;
            }
        });
        row.appendChild(removeBtn);
        list.appendChild(row);
    }
}

/* ---- Creator: invite more people after the fact ---- */
// Two paths, same as the create page: comma-separated emails, and a picker
// of platform friends who aren't already on the invite list.

let addInvitesWired = false;
let invitedUserIds = new Set();
let inviteFriends = null; // null until loaded
const inviteSelected = new Set();

function wireAddInvites() {
    if (addInvitesWired) return;
    addInvitesWired = true;

    const input = document.getElementById('add-invite-emails');
    const btn = document.getElementById('add-invite-btn');
    const message = document.getElementById('add-invite-message');
    const search = document.getElementById('add-invite-friend-search');

    loadInviteFriends();
    search.addEventListener('input', renderInviteFriends);

    const send = async () => {
        const emails = (input.value || '').split(',').map(e => e.trim()).filter(Boolean);
        const friend_ids = [...inviteSelected];
        if (emails.length === 0 && friend_ids.length === 0) {
            message.textContent = 'Enter an email or pick a friend.';
            message.className = 'message error';
            return;
        }
        btn.disabled = true;
        message.textContent = 'Sending…';
        message.className = 'message';
        try {
            const res = await fetch('/api/invitations', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ event_id: eventId, emails, friend_ids }),
            });
            const data = await res.json().catch(() => ({}));
            btn.disabled = false;
            if (!res.ok) {
                message.textContent = data.message || `Failed (${res.status})`;
                message.className = 'message error';
                return;
            }
            const sent = data.created.length;
            let text = `✓ ${sent} e-vite${sent === 1 ? '' : 's'} sent`;
            if (data.skipped.length) {
                text += ` · skipped ${data.skipped.map(s => `${s.email || s.friend_id} (${s.reason})`).join(', ')}`;
            }
            message.textContent = text;
            message.className = 'message success';
            input.value = '';
            inviteSelected.clear();
            loadEvent(); // refreshes invited list + filters the friend picker
        } catch (error) {
            console.error('Add invites failed:', error);
            btn.disabled = false;
            message.textContent = 'Could not send invitations.';
            message.className = 'message error';
        }
    };

    btn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
}

async function loadInviteFriends() {
    try {
        const res = await fetch('/api/friends', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        inviteFriends = await res.json();
    } catch (error) {
        console.error('Friends load failed:', error);
        inviteFriends = [];
    }
    renderInviteFriends();
}

function renderInviteFriends() {
    const list = document.getElementById('add-invite-friends');
    const meta = document.getElementById('add-invite-meta');
    if (!list || inviteFriends === null) return;
    list.innerHTML = '';

    const needle = (document.getElementById('add-invite-friend-search').value || '')
        .trim().toLowerCase();
    // Drop friends who are already invited (selection follows along).
    for (const id of [...inviteSelected]) {
        if (invitedUserIds.has(id)) inviteSelected.delete(id);
    }
    const candidates = inviteFriends.filter((f) => {
        if (invitedUserIds.has(f.id)) return false;
        if (!needle) return true;
        const hay = `${f.first_name || ''} ${f.last_name || ''} ${f.username}`.toLowerCase();
        return hay.includes(needle);
    });

    if (candidates.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = inviteFriends.length === 0
            ? 'No friends yet — add some on your Tree.'
            : (needle ? 'No matches' : 'All your friends are already invited.');
        list.appendChild(empty);
        meta.textContent = '';
        return;
    }

    for (const friend of candidates) {
        const row = document.createElement('div');
        row.className = 'invite-friend-row' + (inviteSelected.has(friend.id) ? ' selected' : '');
        const name = document.createElement('span');
        name.className = 'person-name';
        name.textContent = displayName(friend);
        const sub = document.createElement('span');
        sub.className = 'person-sub';
        sub.textContent = `@${friend.username}`;
        row.appendChild(name);
        row.appendChild(sub);
        row.addEventListener('click', () => {
            if (inviteSelected.has(friend.id)) inviteSelected.delete(friend.id);
            else inviteSelected.add(friend.id);
            renderInviteFriends();
        });
        list.appendChild(row);
    }
    meta.textContent = inviteSelected.size ? `${inviteSelected.size} selected` : '';
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

    // Guide the picker away from past days. The original date stays valid
    // even if passed, so typo fixes on old events don't force a reschedule.
    const now = new Date();
    document.getElementById('edit-date').min =
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function saveEdit(form, buttons, message) {
    // A changed date/time must be in the future; keeping the original
    // (possibly past) date is fine for fixing titles or descriptions.
    const newDate = document.getElementById('edit-date').value;
    const newTime = document.getElementById('edit-time').value;
    const origDate = (currentEvent.event_date || '').slice(0, 10);
    const origTime = (currentEvent.event_time || '').slice(0, 5);
    if (newDate !== origDate || newTime !== origTime) {
        const when = new Date(`${newDate}T${newTime}`);
        if (Number.isNaN(when.getTime()) || when < new Date()) {
            message.textContent = 'Pick a date and time from this moment forward.';
            message.className = 'message error';
            return;
        }
    }

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

/* ---- Add the email-inviter as a friend (same rules as the home cards) ---- */

function renderFriendOffer(event, isCreator) {
    const offer = document.getElementById('friend-offer');
    offer.innerHTML = '';
    offer.classList.add('hidden');

    // Only for email-invited viewers, and only until they're friends.
    if (isCreator || !event.inviter_id || event.inviter_friend_status === 'accepted') return;
    offer.classList.remove('hidden');

    if (event.inviter_friend_status === 'pending') {
        const pending = document.createElement('span');
        pending.className = 'friend-pending';
        pending.textContent = '[ FRIEND REQUEST PENDING ]';
        offer.appendChild(pending);
        return;
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rsvp-btn';
    const inviterName = event.inviter_first_name || event.inviter_username || 'inviter';
    btn.textContent = `[ + ADD ${inviterName.toUpperCase()} AS FRIEND ]`;
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            const res = await fetch('/api/friends/request', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addressee_id: event.inviter_id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                btn.disabled = false;
                alert(`Friend request failed: ${data.message || res.status}`);
                return;
            }
            const nowFriends = data.friendship?.status === 'accepted'
                || /already friends|accepted/i.test(data.message || '');
            btn.textContent = nowFriends ? '[ ✓ FRIENDS ]' : '[ ✓ REQUEST SENT ]';
        } catch (error) {
            console.error('Friend request failed:', error);
            btn.disabled = false;
        }
    });
    offer.appendChild(btn);
}

/* ---- Group chat ---- */
// Members: host + invitees. Visibility is decided by the server — we probe
// once and show the section on 200. Polls every 5s while the tab is visible.

let chatInited = false;
let chatIsAdmin = false;
let chatMe = null;
let chatLastId = 0;
let chatTimer = null;

async function initChat() {
    if (chatInited) return; // render() reruns after edits/RSVPs; wire once
    chatInited = true;

    const ok = await fetchChat(true);
    if (!ok) return; // 403: not a member — section stays hidden

    document.getElementById('chat-section').classList.remove('hidden');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    sendBtn.addEventListener('click', sendChatMessage);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

    const schedule = () => {
        clearInterval(chatTimer);
        chatTimer = setInterval(() => fetchChat(false), 5000);
    };
    schedule();
    // Don't burn serverless invocations while the tab is hidden.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearInterval(chatTimer);
        else { fetchChat(false); schedule(); }
    });
}

async function fetchChat(initial) {
    try {
        const res = await fetch(`/api/events/${eventId}/messages?after=${chatLastId}`, {
            credentials: 'include',
        });
        if (!res.ok) return false;
        const data = await res.json();
        chatIsAdmin = data.is_admin;
        chatMe = data.me;
        if (initial && data.messages.length === 0) {
            renderChatEmpty();
        }
        for (const msg of data.messages) {
            appendChatMessage(msg);
            chatLastId = Math.max(chatLastId, msg.id);
        }
        return true;
    } catch (error) {
        if (initial) console.error('Chat load failed:', error);
        return false;
    }
}

function renderChatEmpty() {
    const list = document.getElementById('chat-messages');
    if (!list.querySelector('.chat-empty') && list.children.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'chat-empty';
        empty.textContent = 'No messages yet — say hi!';
        list.appendChild(empty);
    }
}

function appendChatMessage(msg) {
    const list = document.getElementById('chat-messages');
    list.querySelector('.chat-empty')?.remove();

    const el = document.createElement('div');
    el.className = 'chat-msg' + (msg.user_id === chatMe ? ' mine' : '');
    el.dataset.messageId = msg.id;

    const header = document.createElement('div');
    const author = document.createElement('span');
    author.className = 'chat-author';
    author.textContent = displayName(msg);
    const time = document.createElement('span');
    time.className = 'chat-time';
    time.textContent = formatChatTime(msg.created_at);
    header.appendChild(author);
    header.appendChild(time);

    // Authors can delete their own; the host (admin) can delete anything.
    if (chatIsAdmin || msg.user_id === chatMe) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'chat-delete';
        del.textContent = '[×]';
        del.title = 'Delete message';
        del.addEventListener('click', async () => {
            try {
                const res = await fetch(`/api/events/${eventId}/messages/${msg.id}`, {
                    method: 'DELETE',
                    credentials: 'include',
                });
                if (res.ok) {
                    el.remove();
                    renderChatEmpty();
                }
            } catch (error) {
                console.error('Delete message failed:', error);
            }
        });
        header.appendChild(del);
    }

    const body = document.createElement('div');
    body.className = 'chat-body';
    body.textContent = msg.body;

    el.appendChild(header);
    el.appendChild(body);
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const message = document.getElementById('chat-message');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    message.textContent = '';
    try {
        const res = await fetch(`/api/events/${eventId}/messages`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            message.textContent = err.message || 'Could not send.';
            message.className = 'message error';
            input.value = body; // give the text back
            return;
        }
        await fetchChat(false); // pick up our own message (and any others)
    } catch (error) {
        console.error('Send failed:', error);
        message.textContent = 'Could not send.';
        message.className = 'message error';
        input.value = body;
    }
}

function formatChatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date().toDateString() === d.toDateString();
    return today
        ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
