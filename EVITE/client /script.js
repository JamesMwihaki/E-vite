const backendEndpoint = "http://localhost:3001/api/events";
const createEventsbackendEndpoint = "http://localhost:3001/api/create_events";
const ai_post = "http://localhost:3001/api/ai_output"
const ai_input = "http://localhost:3001/api/ai_input"

// Get a reference to the button element
const create_event = document.getElementById('create_event');

// Add a click event listener to the button
create_event.addEventListener('click', function() {
  handleCreateEvent();
});

async function handleCreateEvent() {
    const eventName = document.getElementById('event_name').value;
    const eventDescription = document.getElementById('eventDescription').value;
    const eventDate = document.getElementById('event_date').value;
    const eventTime = document.getElementById('eventTime').value;
    const eventLocation = document.getElementById('event_location').value;
    const eventType = document.querySelector('input[name="eventType"]:checked').value;
    const willAttend = document.getElementById('will_attend').checked;


    const eventData = {
        title: eventName,
        description: eventDescription,
        date: eventDate,
        time: eventTime,
        location: eventLocation,
        type: eventType,
        willAttend: willAttend

    };

    try{
        const response = await fetch(createEventsbackendEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body:JSON.stringify(eventData),
        });

        const data = await response.json();

        if(!response.ok){
            console.log("Error with creating event");
        }else{
            console.log("Heard back from create_tables:", data);
        }
    }catch (error){
        console.log("Error: ", error)
    }
    
}

async function handleSaveDraft() {
    const eventName = document.getElementById('event_name').value;
    const eventDescription = document.getElementById('eventDescription').value;
    const eventDate = document.getElementById('event_date').value;
    const eventTime = document.getElementById('eventTime').value;
    const eventLocation = document.getElementById('event_location').value;
    const eventType = document.getElementById('private')
    const willAttend = document.getElementById('will_attend').checked;
    const willNotAttend = document.getElementById('will_not_attend').checked;s

    const draftData = {
        title: eventName,
        description: eventDescription,
        date: eventDate,
        time: eventTime,
        location: eventLocation,
        type: eventType,
        going: willAttend,
        not_going: willNotAttend
    };
}

function setActive(element, navItem) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    console.log(`Navigating to: ${navItem}`);
    // Implement your routing logic here (e.g., changing page content based on navItem)
}

async function loadEvents() {
    try {
        const response = await fetch(backendEndpoint);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const events = await response.json();
        
        // Get the span elements (not p tags)
        const event_name_db = document.getElementById("event_name_db");
        const event_location_db = document.getElementById("event_location_db");
        const event_date_db = document.getElementById("event_date_db");
        const event_participants_db = document.getElementById("event_participants_db");

        const event_name_pb = document.getElementById("event_name_pb");
        const event_location_pb = document.getElementById("event_location_pb");
        const event_date_pb = document.getElementById("event_date_pb");
        const event_participants_pb = document.getElementById("event_participants_pb");
        
        // Update with actual data
        if (events.length > 0) {            
            event_name_db.textContent = padText(events[0].event_name, 30);
            event_location_db.textContent = padText(`Location: ${events[0].event_location}`, 30);
            event_date_db.textContent = padText(formatEventDate(events[0].event_time), 30);
            event_participants_db.textContent = padText(`Participants: ${events[0].event_participants}`, 30);
            
            event_name_pb.textContent = padText(events[1].event_name, 30);
            event_location_pb.textContent = padText(`Location: ${events[1].event_location}`, 30);
            event_date_pb.textContent = padText(formatEventDate(events[1].event_time), 30);
            event_participants_pb.textContent = padText(`Participants: ${events[1].event_participants}`, 30);
        }
        
    } catch (error) {
        console.error("Error fetching events:", error);
        document.getElementById("event_name_db").textContent = "Error loading events";
    }
}

function setActive(element, navItem) {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    console.log(`Navigating to: ${navItem}`);
    // Implement your routing logic here (e.g., changing page content based on navItem)
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

// Call when page loads
//document.addEventListener('DOMContentLoaded', loadEvents);

async function CommuneWithAI() {
    try{
        let ask_ai = document.getElementById("user").value;
        const ai_message = await fetch(ai_input, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body:JSON.stringify({ ask_ai }),
        });

        
        const message_object = await ai_message.json();
        console.log("The is the AI response", message_object);
        const message = document.getElementById("ai_message");
        message.innerHTML = message_object.aiResponse;


        if(!ai_message.ok){
            throw new Error(`HTTP error! Status: ${ai_message.status}`);
        }
    }catch (error) {
        console.error('Error:', error);
    }


}





