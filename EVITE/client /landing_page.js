const backendEndpoint = "http://localhost:3001/api/events";
const createEventsbackendEndpoint = "http://localhost:3001/api/create_events";
const ai_post = "http://localhost:3001/api/ai_output"
const ai_input = "http://localhost:3001/api/ai_input"

loadEvents();

function setActive(element, navItem) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    console.log(`Navigating to: ${navItem}`);
    // Implement your routing logic here (e.g., changing page content based on navItem)
}

async function loadEvents() {
    try {
        const response = await fetch(createEventsbackendEndpoint);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const events = await response.json();
        
        // Get the span elements (not p tags)
        const event_name_db = document.getElementById("event_name_db");
        const event_location_db = document.getElementById("event_location_db");
        const event_date_db = document.getElementById("event_date_db");
        const event_description_db = document.getElementById("event_description_db");

        const event_name_pb = document.getElementById("event_name_pb");
        const event_location_pb = document.getElementById("event_location_pb");
        const event_date_pb = document.getElementById("event_date_pb");
        const event_description_pb = document.getElementById("event_description_pb");
        
        // Update with actual data
        if (events.length > 0) {            
            event_name_db.textContent = padText(events[0].title, 30);
            event_location_db.textContent = padText(`Location: ${events[0].location}`, 30);
            event_date_db.textContent = padText(formatEventDate(events[0].event_date), 30);
            event_description_db.textContent = padText(`Description: ${events[0].description}`, 30);
            
            event_name_pb.textContent = padText(events[1].title, 30);
            event_location_pb.textContent = padText(`Location: ${events[1].location}`, 30);
            event_date_pb.textContent = padText(formatEventDate(events[1].event_date), 30);
            event_description_pb.textContent = padText(`Description: ${events[1].description}`, 30);
        }
        
    } catch (error) {
        console.error("Error fetching events:", error);
        document.getElementById("event_name_db").textContent = "Error loading events";
    }
}

function padText(text, length = 30) {
    if (text.length > length) {
        return text.substring(0, length - 3) + '...';
    }
    return text.padEnd(length, ' '); // Pad with spaces to reach exactly 30 chars
}


function formatEventDate(eventTime) {
    const date = new Date(eventTime);
    return date.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'short', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}






