const API = "";
const FRIENDS_URL = `${API}/api/friends`;
const REQUESTS_URL = `${API}/api/friends/requests`;
const SEARCH_URL = `${API}/api/users/search`;
const REQUEST_URL = `${API}/api/friends/request`;
const ACCEPT_URL = `${API}/api/friends/accept`;

const GRAPH_URL = `${API}/api/friends/graph`;

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;

const VIEW_CX = 200;
const VIEW_CY = 250;
const RING_RADIUS = 150;
const SUB_DISTANCE = 78;
const CENTER_R = 30;
const SUB_R = 14;

const requestsListEl = document.getElementById('requests-list');
const searchResultsEl = document.getElementById('search-results');
const searchInputEl = document.getElementById('search-input');
const treeCanvas = document.getElementById('tree-canvas');
const viewportEl = document.getElementById('tree-viewport');
const leafInfoEl = document.getElementById('leaf-info');
const leafOverflowEl = document.getElementById('leaf-overflow');

let panX = 0, panY = 0, zoom = 1;
let graphData = null;
const slots = [];             // visual nodes: { key, userId, x, y, level, friend, angle? }

const TRANSITION_MS = 350;

(async function init() {
    const user = await checkAuth();
    if (!user) return;

    document.getElementById('logout-btn').addEventListener('click', logout);
    searchInputEl.addEventListener('keydown', onSearchKey);
    searchInputEl.addEventListener('input', onSearchInput);
    setupViewportInteraction();

    // Delegate node clicks so reused elements pick up the current slot data
    // (a node moves from level-1 friend to level-0 center across renders).
    treeCanvas.addEventListener('click', (e) => {
        // Remove (×) button takes priority over node-body click.
        const removeEl = e.target.closest('.node-remove');
        if (removeEl) {
            e.stopPropagation();
            const friendshipId = parseInt(removeEl.dataset.friendshipId, 10);
            const username = removeEl.dataset.username || 'this friend';
            handleRemoveFriend(friendshipId, username);
            return;
        }
        const nodeEl = e.target.closest('.graph-node');
        if (!nodeEl || nodeEl.classList.contains('exiting')) return;
        const userId = parseInt(nodeEl.dataset.userId, 10);
        const slot = slots.find(s => s.userId === userId);
        if (slot) handleNodeClick(slot);
    });

    applyTransform();
    await refreshAll();
})();

async function refreshAll() {
    await Promise.all([loadRequests(), loadTree()]);
    if (searchInputEl.value.trim()) await runSearch();
}

// --- The Graph -------------------------------------------------------------
// Center user + ring of direct friends. Edges show mutual connections among
// those friends. Click a friend → fan their friends out as a sub-cluster.
// Click again to collapse. Pan with drag, zoom with wheel.

async function loadTree() {
    setLeafInfoEmpty('Click a node to view their tree');
    leafOverflowEl.textContent = '';

    const targetId = new URL(window.location).searchParams.get('user');
    updateHomeBtnVisibility();
    const url = targetId
        ? `${GRAPH_URL}?user_id=${encodeURIComponent(targetId)}`
        : GRAPH_URL;

    try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        graphData = await response.json();
        renderGraph();
        if (graphData.nodes.length === 0 && graphData.is_me) {
            setLeafInfoEmpty('No friends yet — search above to grow your tree');
        }
    } catch (error) {
        console.error('Failed to load graph:', error);
        graphData = null;
        treeCanvas.textContent = '';
        setLeafInfoEmpty('Error loading graph');
    }
}

function updateHomeBtnVisibility() {
    const btn = document.getElementById('home-btn');
    if (!btn) return;
    const hasUserParam = new URL(window.location).searchParams.has('user');
    btn.style.display = hasUserParam ? '' : 'none';
}

function renderGraph() {
    if (!graphData) {
        treeCanvas.textContent = '';
        slots.length = 0;
        return;
    }

    // 1. Build new slot list.
    slots.length = 0;
    slots.push({
        key: `c-${graphData.center.id}`,
        userId: graphData.center.id,
        x: VIEW_CX, y: VIEW_CY,
        level: 0,
        friend: graphData.center,
    });
    const friends = graphData.nodes;
    const n = friends.length;
    for (let i = 0; i < n; i++) {
        const angle = n === 1 ? -Math.PI / 2 : (i / n) * Math.PI * 2 - Math.PI / 2;
        slots.push({
            key: `f-${friends[i].id}`,
            userId: friends[i].id,
            x: VIEW_CX + Math.cos(angle) * RING_RADIUS,
            y: VIEW_CY + Math.sin(angle) * RING_RADIUS,
            level: 1,
            angle,
            friend: friends[i],
        });
    }

    // 2. Diff against existing DOM nodes — reuse where userId matches.
    const newUserIds = new Set(slots.map(s => s.userId));
    const existingByUserId = new Map();
    for (const el of treeCanvas.querySelectorAll('.graph-node')) {
        if (el.classList.contains('exiting')) continue;
        const uid = parseInt(el.dataset.userId, 10);
        if (newUserIds.has(uid)) {
            existingByUserId.set(uid, el);
        } else {
            // Disappeared — fade out, then remove.
            el.classList.add('exiting');
            setTimeout(() => el.remove(), TRANSITION_MS);
        }
    }

    // 3. Update or create node elements.
    for (const slot of slots) {
        const existing = existingByUserId.get(slot.userId);
        if (existing) {
            updateNodeElement(existing, slot);
        } else {
            const el = buildNodeEl(slot);
            el.classList.add('entering');   // starts at opacity 0
            treeCanvas.appendChild(el);
            // Remove the entering class on next frame so the opacity transition runs.
            requestAnimationFrame(() => el.classList.remove('entering'));
        }
    }

    // 4. Edges — cross-fade old group out, new group in.
    swapEdgesGroup();
}

function swapEdgesGroup() {
    const oldGroup = treeCanvas.querySelector('.edges-group:not(.exiting)');
    if (oldGroup) {
        oldGroup.classList.add('exiting');
        oldGroup.style.opacity = '0';
        setTimeout(() => oldGroup.remove(), TRANSITION_MS);
    }

    const g = svgEl('g', { class: 'edges-group' });
    g.style.opacity = '0';

    const centerSlot = slots.find(s => s.level === 0);
    for (const s of slots) {
        if (s.level !== 1) continue;
        g.appendChild(svgEl('line', {
            class: 'graph-edge primary',
            x1: centerSlot.x, y1: centerSlot.y, x2: s.x, y2: s.y,
        }));
    }
    const friendByUser = new Map(slots.filter(s => s.level === 1).map(s => [s.userId, s]));
    for (const [aId, bId] of graphData.edges || []) {
        const a = friendByUser.get(aId), b = friendByUser.get(bId);
        if (a && b) {
            g.appendChild(svgEl('line', {
                class: 'graph-edge mutual',
                x1: a.x, y1: a.y, x2: b.x, y2: b.y,
            }));
        }
    }

    // Insert under existing nodes so edges render behind.
    treeCanvas.insertBefore(g, treeCanvas.firstChild);
    requestAnimationFrame(() => { g.style.opacity = '1'; });
}

function buildNodeEl(slot) {
    const g = svgEl('g', {
        class: 'graph-node' + (slot.level === 0 ? ' center' : ''),
        'data-user-id': slot.userId,
    });
    g.style.transform = `translate(${slot.x}px, ${slot.y}px)`;
    populateNodeContent(g, slot);
    return g;
}

function updateNodeElement(el, slot) {
    el.style.transform = `translate(${slot.x}px, ${slot.y}px)`;
    el.classList.toggle('center', slot.level === 0);
    // Rebuild inner content so initial / label / radius reflect the new slot.
    el.textContent = '';
    populateNodeContent(el, slot);
}

function populateNodeContent(g, slot) {
    const isCenter = slot.level === 0;
    const r = isCenter ? CENTER_R : nodeRadius(slot.friend.friend_count);

    g.appendChild(svgEl('circle', { class: 'graph-node-bg', cx: 0, cy: 0, r }));

    const initial = ((slot.friend.first_name && slot.friend.first_name[0])
                  || (slot.friend.username && slot.friend.username[0])
                  || '?').toUpperCase();
    const initialEl = svgEl('text', {
        class: 'graph-node-initial',
        x: 0, y: 0,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
    });
    initialEl.textContent = initial;
    g.appendChild(initialEl);

    const label = svgEl('text', {
        class: 'graph-node-label',
        x: 0, y: r + 13,
        'text-anchor': 'middle',
    });
    label.textContent = `@${slot.friend.username}`;
    g.appendChild(label);

    // × remove button — only for direct friends on your own tree.
    if (slot.level === 1 && slot.friend.friendship_id && graphData && graphData.is_me) {
        const removeG = svgEl('g', {
            class: 'node-remove',
            transform: `translate(${(r * 0.72).toFixed(1)},${(-r * 0.72).toFixed(1)})`,
        });
        removeG.dataset.friendshipId = slot.friend.friendship_id;
        removeG.dataset.username = slot.friend.username;
        removeG.appendChild(svgEl('circle', { cx: 0, cy: 0, r: 7 }));
        const xMark = svgEl('text', {
            x: 0, y: 0,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
        });
        xMark.textContent = '×';
        removeG.appendChild(xMark);
        g.appendChild(removeG);
    }
}

async function handleRemoveFriend(friendshipId, username) {
    if (!Number.isInteger(friendshipId)) return;
    if (!confirm(`Remove @${username} from your tree?`)) return;
    try {
        const response = await fetch(`${FRIENDS_URL}/${friendshipId}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            alert(data.message || `Remove failed (${response.status})`);
            return;
        }
        await loadTree();
    } catch (error) {
        console.error('Remove friend failed:', error);
        alert('Could not reach the server.');
    }
}

function nodeRadius(friendCount) {
    const c = friendCount || 0;
    return Math.max(18, Math.min(28, 18 + Math.sqrt(c) * 2.2));
}

function handleNodeClick(slot) {
    if (slot.level === 0) {
        // Already viewing this person's tree — just show their info.
        showNodeInfo(slot);
        return;
    }
    navigateToUser(slot.userId);
}

function navigateToUser(userId) {
    const url = new URL(window.location);
    url.searchParams.set('user', userId);
    history.pushState({}, '', url);
    panX = 0; panY = 0; zoom = 1;
    loadTree();
}

function showNodeInfo(slot) {
    leafInfoEl.textContent = '';
    const pill = document.createElement('span');
    pill.className = 'leaf-info-pill';

    const fullName = [slot.friend.first_name, slot.friend.last_name]
        .filter(Boolean).join(' ') || slot.friend.username;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = fullName;
    pill.appendChild(name);

    const handle = document.createElement('span');
    handle.className = 'handle';
    handle.textContent = `@${slot.friend.username}`;
    pill.appendChild(handle);

    leafInfoEl.appendChild(pill);
}

function setLeafInfoEmpty(text) {
    leafInfoEl.textContent = '';
    const span = document.createElement('span');
    span.className = 'leaf-info-empty';
    span.textContent = text;
    leafInfoEl.appendChild(span);
}

// --- Pan + zoom interaction ------------------------------------------------

function setupViewportInteraction() {
    let dragging = false;
    let startX = 0, startY = 0;
    let startPanX = 0, startPanY = 0;

    viewportEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.graph-node')) return;
        if (e.target.closest('.tree-controls')) return;
        dragging = true;
        viewportEl.classList.add('dragging');
        startX = e.clientX;
        startY = e.clientY;
        startPanX = panX;
        startPanY = panY;
        viewportEl.setPointerCapture(e.pointerId);
    });

    viewportEl.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rect = viewportEl.getBoundingClientRect();
        const ratioX = 400 / rect.width;
        const ratioY = 500 / rect.height;
        panX = startPanX + (e.clientX - startX) * ratioX;
        panY = startPanY + (e.clientY - startY) * ratioY;
        applyTransform();
    });

    const endDrag = (e) => {
        dragging = false;
        viewportEl.classList.remove('dragging');
        if (e.pointerId !== undefined) {
            try { viewportEl.releasePointerCapture(e.pointerId); } catch (_) {}
        }
    };
    viewportEl.addEventListener('pointerup', endDrag);
    viewportEl.addEventListener('pointercancel', endDrag);

    viewportEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = 1 - e.deltaY * 0.001;
        const newZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
        if (newZoom === zoom) return;
        zoomAt(newZoom, e.clientX, e.clientY);
    }, { passive: false });

    viewportEl.querySelector('.tree-controls').addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const rect = viewportEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        switch (btn.dataset.act) {
            case 'home':
                goHome();
                return;
            case 'zoom-in':  zoomAt(clamp(zoom * 1.2, MIN_ZOOM, MAX_ZOOM), cx, cy); break;
            case 'zoom-out': zoomAt(clamp(zoom / 1.2, MIN_ZOOM, MAX_ZOOM), cx, cy); break;
            case 'reset':
                zoom = 1; panX = 0; panY = 0;
                applyTransform();
                break;
        }
    });

    window.addEventListener('popstate', () => loadTree());
}

// Zoom to a new level, keeping whatever canvas point is currently under the
// pointer (clientX/clientY in CSS pixels) anchored at that same screen spot.
function zoomAt(newZoom, clientX, clientY) {
    const rect = viewportEl.getBoundingClientRect();
    const mouseX = (clientX - rect.left) * (400 / rect.width);
    const mouseY = (clientY - rect.top) * (500 / rect.height);
    const ratio = newZoom / zoom;
    panX = mouseX - (mouseX - panX) * ratio;
    panY = mouseY - (mouseY - panY) * ratio;
    zoom = newZoom;
    applyTransform();
}

function goHome() {
    const url = new URL(window.location);
    url.searchParams.delete('user');
    history.pushState({}, '', url);
    panX = 0; panY = 0; zoom = 1;
    loadTree();
}

function applyTransform() {
    treeCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// --- SVG helper ------------------------------------------------------------

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, String(v));
    }
    return el;
}

// --- Requests + search (unchanged from before) -----------------------------

async function loadRequests() {
    requestsListEl.textContent = '';
    try {
        const response = await fetch(REQUESTS_URL, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const requests = await response.json();
        if (requests.length === 0) {
            requestsListEl.appendChild(emptyState('No pending requests'));
            return;
        }
        for (const req of requests) {
            requestsListEl.appendChild(personRow(req, ['accept', 'decline']));
        }
    } catch (error) {
        console.error('Failed to load requests:', error);
        requestsListEl.appendChild(emptyState('Error loading requests'));
    }
}

// Results populate live while typing (debounced, ≥2 chars), same feel as the
// invite pickers; Enter still searches immediately.
let searchDebounce = null;

function onSearchInput() {
    clearTimeout(searchDebounce);
    const q = searchInputEl.value.trim();
    if (!q) {
        searchResultsEl.textContent = '';
        return;
    }
    if (q.length < 2) return;
    searchDebounce = setTimeout(runSearch, 300);
}

function onSearchKey(e) {
    if (e.key === 'Enter') {
        clearTimeout(searchDebounce);
        runSearch();
    }
}

let searchSeq = 0;

async function runSearch() {
    const q = searchInputEl.value.trim();
    searchResultsEl.textContent = '';
    if (!q) return;

    const mySeq = ++searchSeq;
    try {
        const response = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(q)}`, { credentials: 'include' });
        if (mySeq !== searchSeq) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const results = await response.json();
        if (results.length === 0) {
            searchResultsEl.appendChild(emptyState('No matches'));
            return;
        }
        for (const person of results) {
            searchResultsEl.appendChild(searchResultRow(person));
        }
    } catch (error) {
        console.error('Search failed:', error);
        searchResultsEl.appendChild(emptyState('Search failed'));
    }
}

function searchResultRow(person) {
    const status = person.friendship_status;
    if (!status) return personRow(person, ['add']);
    if (status === 'accepted') return personRow(person, ['friends-label']);
    if (person.i_am_requester) return personRow(person, ['sent-label']);
    return personRow(person, ['accept', 'decline']);
}

function personRow(person, actions) {
    const row = document.createElement('div');
    row.className = 'ascii-frame person-row';
    row.dataset.userId = person.id;
    if (person.friendship_id) row.dataset.friendshipId = person.friendship_id;

    row.innerHTML = `
        <span class="corner tl">+</span>
        <span class="corner tr">+</span>
        <span class="corner bl">+</span>
        <span class="corner br">+</span>
        <div class="person-info">
            <div class="person-name"></div>
            <div class="person-handle"></div>
        </div>
        <div class="person-actions"></div>
    `;

    const fullName = [person.first_name, person.last_name].filter(Boolean).join(' ');
    row.querySelector('.person-name').textContent = fullName || person.username;
    row.querySelector('.person-handle').textContent = `@${person.username}`;

    const actionsEl = row.querySelector('.person-actions');
    for (const action of actions) {
        actionsEl.appendChild(buildActionButton(action, person));
    }
    return row;
}

function buildActionButton(kind, person) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ascii-frame ascii-button';
    btn.innerHTML = `
        <span class="corner tl">+</span>
        <span class="corner tr">+</span>
        <span class="corner bl">+</span>
        <span class="corner br">+</span>
    `;

    const label = document.createElement('span');
    btn.appendChild(label);

    switch (kind) {
        case 'add':
            label.textContent = 'Add';
            btn.addEventListener('click', () => sendRequest(person.id, btn));
            break;
        case 'accept':
            label.textContent = 'Accept';
            btn.addEventListener('click', () => acceptRequest(person.friendship_id, btn));
            break;
        case 'decline':
            label.textContent = 'Decline';
            btn.classList.add('danger');
            btn.addEventListener('click', () => removeFriendship(person.friendship_id, btn));
            break;
        case 'sent-label':
            label.textContent = 'Request sent';
            btn.disabled = true;
            break;
        case 'friends-label':
            label.textContent = 'Friends';
            btn.disabled = true;
            break;
    }
    return btn;
}

async function sendRequest(userId, btn) {
    btn.disabled = true;
    try {
        const response = await fetch(REQUEST_URL, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addressee_id: userId }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            alert(data.message || `Request failed (${response.status})`);
            btn.disabled = false;
            return;
        }
    } catch (error) {
        console.error('Send request failed:', error);
        alert('Could not reach the server.');
        btn.disabled = false;
        return;
    }
    await refreshAll();
}

async function acceptRequest(friendshipId, btn) {
    btn.disabled = true;
    try {
        const response = await fetch(ACCEPT_URL, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ friendship_id: friendshipId }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            alert(data.message || `Accept failed (${response.status})`);
            btn.disabled = false;
            return;
        }
    } catch (error) {
        console.error('Accept failed:', error);
        alert('Could not reach the server.');
        btn.disabled = false;
        return;
    }
    await refreshAll();
}

async function removeFriendship(friendshipId, btn) {
    btn.disabled = true;
    try {
        const response = await fetch(`${FRIENDS_URL}/${friendshipId}`, {
            method: 'DELETE',
            credentials: 'include',
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            alert(data.message || `Remove failed (${response.status})`);
            btn.disabled = false;
            return;
        }
    } catch (error) {
        console.error('Remove failed:', error);
        alert('Could not reach the server.');
        btn.disabled = false;
        return;
    }
    await refreshAll();
}

function emptyState(text) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.textContent = text;
    return div;
}
