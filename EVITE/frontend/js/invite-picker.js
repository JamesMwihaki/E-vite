// Unified "add people" field, shared by every place that invites people
// (create-event page, event page's Invite More People). One input does both
// paths: typing a name/@username suggests platform users to pick (live from
// /api/users/search, friends ranked first); typing an email address offers an
// email invite for guests off the platform. Selections become removable
// chips; pages read them with getFriendIds()/getEmails().
const INVITE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createInvitePicker({ inputEl, chipsEl, suggestEl, getExcludedUserIds, onChange }) {
    const users = new Map();   // id -> user object
    const emails = new Set();  // lowercased addresses
    let items = [];            // current suggestions
    let activeIndex = -1;
    let debounceTimer = null;
    let abortCtrl = null;
    let seq = 0;

    function changed() {
        if (onChange) onChange();
    }

    function excluded() {
        return getExcludedUserIds ? getExcludedUserIds() : new Set();
    }

    /* ---- chips ---- */

    function renderChips() {
        chipsEl.innerHTML = '';
        for (const user of users.values()) {
            chipsEl.appendChild(buildChip(`@${user.username}`, 'user', () => {
                users.delete(user.id);
                renderChips();
                changed();
            }));
        }
        for (const email of emails) {
            chipsEl.appendChild(buildChip(email, 'email', () => {
                emails.delete(email);
                renderChips();
                changed();
            }));
        }
    }

    function buildChip(label, kind, onRemove) {
        const chip = document.createElement('span');
        chip.className = `invite-chip ${kind}`;
        const text = document.createElement('span');
        text.textContent = label;
        const x = document.createElement('span');
        x.className = 'chip-x';
        x.textContent = '×';
        x.title = 'Remove';
        x.addEventListener('click', onRemove);
        chip.appendChild(text);
        chip.appendChild(x);
        return chip;
    }

    /* ---- suggestions ---- */

    function hideSuggest() {
        suggestEl.hidden = true;
        suggestEl.innerHTML = '';
        items = [];
        activeIndex = -1;
    }

    async function refreshSuggest() {
        const q = inputEl.value.trim();
        if (q.length < 2) { hideSuggest(); return; }

        const mySeq = ++seq;
        let results = [];
        // Emails aren't platform searches; commas mean a pasted email list.
        if (!q.includes(',')) {
            if (abortCtrl) abortCtrl.abort();
            abortCtrl = new AbortController();
            try {
                const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, {
                    credentials: 'include',
                    signal: abortCtrl.signal,
                });
                if (res.ok) results = await res.json();
            } catch (error) {
                if (error.name !== 'AbortError') console.error('User search failed:', error);
            }
            if (mySeq !== seq || inputEl.value.trim() !== q) return; // stale
        }

        const ex = excluded();
        const candidates = results
            .filter(u => !users.has(u.id) && !ex.has(u.id))
            .sort((a, b) => (b.friendship_status === 'accepted') - (a.friendship_status === 'accepted'))
            .slice(0, 6);

        items = candidates.map(u => ({ type: 'user', user: u }));
        if (INVITE_EMAIL_REGEX.test(q) && !emails.has(q.toLowerCase())) {
            items.unshift({ type: 'email', email: q });
        }
        if (items.length === 0) { hideSuggest(); return; }

        suggestEl.innerHTML = '';
        items.forEach((item, i) => {
            const row = document.createElement('div');
            row.className = 'suggest-item' + (item.type === 'email' ? ' email-item' : '');
            if (item.type === 'email') {
                row.textContent = `Invite ${item.email} by email`;
            } else {
                const name = document.createElement('span');
                name.textContent = [item.user.first_name, item.user.last_name].filter(Boolean).join(' ')
                    || item.user.username;
                const sub = document.createElement('span');
                sub.className = 'sub';
                sub.textContent = `@${item.user.username}`
                    + (item.user.friendship_status === 'accepted' ? ' · friend' : '');
                row.appendChild(name);
                row.appendChild(sub);
            }
            // mousedown so selection beats the input's blur.
            row.addEventListener('mousedown', (e) => { e.preventDefault(); choose(item); });
            row.addEventListener('mouseenter', () => { activeIndex = i; highlight(); });
            suggestEl.appendChild(row);
        });
        activeIndex = 0;
        highlight();
        suggestEl.hidden = false;
    }

    function highlight() {
        [...suggestEl.children].forEach((el, i) =>
            el.classList.toggle('active', i === activeIndex));
    }

    function choose(item) {
        if (item.type === 'user') {
            users.set(item.user.id, item.user);
        } else {
            emails.add(item.email.toLowerCase());
        }
        inputEl.value = '';
        hideSuggest();
        renderChips();
        changed();
        inputEl.focus();
    }

    // "a@b.com, c@d.com" pasted or comma-typed — absorb every valid address.
    function takeEmails() {
        const parts = inputEl.value.split(',').map(p => p.trim()).filter(Boolean);
        const valid = parts.filter(p => INVITE_EMAIL_REGEX.test(p));
        if (valid.length === 0) return false;
        for (const email of valid) emails.add(email.toLowerCase());
        inputEl.value = parts.filter(p => !INVITE_EMAIL_REGEX.test(p)).join(', ');
        hideSuggest();
        renderChips();
        changed();
        return true;
    }

    /* ---- wiring ---- */

    inputEl.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const q = inputEl.value.trim();
        if (q.length < 2) { hideSuggest(); return; }
        debounceTimer = setTimeout(refreshSuggest, 250);
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (suggestEl.hidden || items.length === 0) return;
            e.preventDefault();
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            activeIndex = (activeIndex + dir + items.length) % items.length;
            highlight();
        } else if (e.key === 'Enter') {
            if (!suggestEl.hidden && activeIndex >= 0 && items[activeIndex]) {
                e.preventDefault();
                choose(items[activeIndex]);
            } else if (takeEmails()) {
                e.preventDefault();
            }
        } else if (e.key === ',') {
            // let the comma land for invalid fragments; absorb valid emails
            if (takeEmails()) e.preventDefault();
        } else if (e.key === 'Escape') {
            hideSuggest();
        }
    });

    inputEl.addEventListener('blur', () => {
        setTimeout(() => { takeEmails(); hideSuggest(); }, 150);
    });

    return {
        getFriendIds: () => [...users.keys()],
        getEmails: () => [...emails],
        counts: () => ({ users: users.size, emails: emails.size }),
        clear: () => {
            users.clear();
            emails.clear();
            inputEl.value = '';
            renderChips();
            hideSuggest();
            changed();
        },
        // Drop selections that became excluded (e.g. just got invited).
        prune: () => {
            const ex = excluded();
            let dropped = false;
            for (const id of [...users.keys()]) {
                if (ex.has(id)) { users.delete(id); dropped = true; }
            }
            if (dropped) { renderChips(); changed(); }
        },
    };
}
