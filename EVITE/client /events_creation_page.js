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







