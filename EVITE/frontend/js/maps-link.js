// Event locations open in the platform's default maps app: Apple Maps on
// iPhone/iPad/Mac, Google Maps everywhere else (Android intercepts the
// https link into its Maps app; desktop gets the web map).
function mapsUrl(location) {
    const q = encodeURIComponent(location);
    return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
        ? `https://maps.apple.com/?q=${q}`
        : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// Builds the anchor used everywhere a location is shown.
function mapsLink(location) {
    const a = document.createElement('a');
    a.className = 'map-link';
    a.href = mapsUrl(location);
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Open in Maps';
    a.textContent = location;
    return a;
}
