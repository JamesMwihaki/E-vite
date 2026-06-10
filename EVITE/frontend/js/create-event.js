const createEventEndpoint = "/api/create_event";
const invitationsEndpoint = "/api/invitations";
const friendsEndpoint = "/api/friends";

const friendsListEl = document.getElementById('friends-list');
const selectedChipsEl = document.getElementById('selected-chips');
const friendSearchEl = document.getElementById('friend-search');
const pickerMetaEl = document.getElementById('picker-meta');

// Map<friend_id, friend_obj> — selected friends keyed by id.
const selectedFriends = new Map();
// All friends, in render order. Each entry: { friend, rowEl, searchHay }
const friendEntries = [];

// When arriving via "create exclusive e-vite from this" on a public event,
// ?from=<id> pre-fills the form. Only set once the source is fetched and
// confirmed, so a bogus param can't end up on the created event.
let sourceEventId = null;

(async function init() {
    const user = await checkAuth();
    if (!user) return;

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    loadFriends();
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

async function loadFriends() {
    friendsListEl.textContent = '';
    friendEntries.length = 0;
    selectedFriends.clear();

    try {
        const response = await fetch(friendsEndpoint, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const friends = await response.json();

        if (friends.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'friends-empty';
            empty.innerHTML = 'No friends yet — <a href="tree.html">add some on your Tree</a>.';
            friendsListEl.appendChild(empty);
            friendSearchEl.style.display = 'none';
            updatePickerMeta();
            return;
        }

        for (const friend of friends) {
            const fullName = [friend.first_name, friend.last_name].filter(Boolean).join(' ') || friend.username;
            const rowEl = buildFriendRow(friend, fullName);
            friendEntries.push({
                friend,
                rowEl,
                searchHay: `${fullName} ${friend.username} ${friend.email || ''}`.toLowerCase(),
            });
            friendsListEl.appendChild(rowEl);
        }

        friendSearchEl.addEventListener('input', applyFilter);
        updatePickerMeta();
    } catch (error) {
        console.error('Friends load failed:', error);
        const errBox = document.createElement('div');
        errBox.className = 'friends-empty';
        errBox.textContent = 'Could not load your friends list';
        friendsListEl.appendChild(errBox);
    }
}

function buildFriendRow(friend, fullName) {
    const row = document.createElement('div');
    row.className = 'friend-row';
    row.dataset.friendId = friend.id;

    const name = document.createElement('span');
    name.className = 'friend-name';
    name.textContent = fullName;

    const handle = document.createElement('span');
    handle.className = 'friend-handle';
    handle.textContent = `@${friend.username}`;

    row.appendChild(name);
    row.appendChild(handle);

    row.addEventListener('click', () => toggleFriend(friend, fullName));
    return row;
}

function toggleFriend(friend, fullName) {
    if (selectedFriends.has(friend.id)) {
        selectedFriends.delete(friend.id);
    } else {
        selectedFriends.set(friend.id, { ...friend, _fullName: fullName });
    }
    syncSelectionUI();
}

function syncSelectionUI() {
    // Sync row styling
    for (const entry of friendEntries) {
        entry.rowEl.classList.toggle('selected', selectedFriends.has(entry.friend.id));
    }
    // Render chips
    selectedChipsEl.textContent = '';
    for (const friend of selectedFriends.values()) {
        selectedChipsEl.appendChild(buildChip(friend));
    }
    updatePickerMeta();
}

function buildChip(friend) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = `@${friend.username}`;
    const close = document.createElement('span');
    close.className = 'chip-close';
    close.textContent = '×';
    close.title = 'Remove';
    close.addEventListener('click', () => {
        selectedFriends.delete(friend.id);
        syncSelectionUI();
    });
    chip.appendChild(label);
    chip.appendChild(close);
    return chip;
}

function applyFilter() {
    const needle = friendSearchEl.value.trim().toLowerCase();
    let visible = 0;
    for (const entry of friendEntries) {
        const match = !needle || entry.searchHay.includes(needle);
        entry.rowEl.classList.toggle('hidden', !match);
        if (match) visible++;
    }
    // Remove any prior "no matches" element and re-add if needed
    const prior = friendsListEl.querySelector('.friends-empty.search-empty');
    if (prior) prior.remove();
    if (visible === 0 && friendEntries.length > 0) {
        const empty = document.createElement('div');
        empty.className = 'friends-empty search-empty';
        empty.textContent = 'No matches';
        friendsListEl.appendChild(empty);
    }
}

function updatePickerMeta() {
    if (!pickerMetaEl) return;
    const total = friendEntries.length;
    const selected = selectedFriends.size;
    pickerMetaEl.textContent = total === 0 ? '' : `${selected} of ${total} selected`;
}

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

function readGuestEmails() {
    const text = document.getElementById('guest_emails').value || '';
    return text.split(',').map(e => e.trim()).filter(Boolean);
}

function readSelectedFriendIds() {
    return [...selectedFriends.keys()];
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
    const emails = readGuestEmails();
    const friend_ids = readSelectedFriendIds();

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
            alert(`Event "${eventData.title}" created!`);
            window.location.href = 'landing-page.html';
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
        let message = `Created event "${eventData.title}" and sent ${sentCount} evite${sentCount === 1 ? '' : 's'}.`;
        if (skippedCount > 0) {
            const lines = inviteResult.skipped.map(s => {
                const target = s.email || `friend #${s.friend_id}`;
                return `  - ${target} (${s.reason})`;
            }).join('\n');
            message += `\n\nSkipped ${skippedCount}:\n${lines}`;
        }
        alert(message);
        window.location.href = 'landing-page.html';
    } catch (error) {
        console.error('Create event failed:', error);
        showFormError(`Could not create event: ${error.message}`);
    }
}

function setActive(element, navItem) {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    console.log(`Navigating to: ${navItem}`);
}

function goBack() {
    window.location.href = 'landing-page.html';
}
