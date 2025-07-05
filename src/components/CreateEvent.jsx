import React, { useState, useEffect } from 'react';
import FormField from './ui/FormField';
import ActionButtons from './ui/ActionButtons';
import usePageNavigation from './ui/usePageNavigation';
import SelectedUsers from './ui/SelectedUsers';
import NetworkCard from './ui/NetworkCard';


export default function CreateEvent() {
    // --- State Management ---
    const [eventName, setEventName] = useState('Disc Golf Sunday');
    const [description, setDescription] = useState('Come as you are!');
    const [date, setDate] = useState('2025-10-18');
    const [time, setTime] = useState('11:00');
    const [location, setLocation] = useState('3310 W 184th St, Olathe, KS');
    const [isPrivate, setIsPrivate] = useState(true);
    const navigate = usePageNavigation();
    const [users, setUsers] = useState([]);
    const [selectedUsers, setSelectedUsers] = useState([]);
    const [isSelectingGuests, setIsSelectingGuests] = useState(false);
    const current_user = 1;
    //api endpoints
    const createEventsBackendEndpoint = "http://localhost:3001/api/create_event";
    const networkEndpoint = "http://localhost:3001/api/load_network";
    const inviteesEndpoint = "http://localhost:3001/api/invitees";
    

    

    // --- Placeholder Functions ---
    const userInfo = () => console.log("Show user info");
    //const sendEvites = () => console.log("Sending evites...");
    const handleSaveDraft = () => console.log("Saving draft...");
    const setActive = (elem, navItem) => {
        console.log(`Setting active nav to: ${navItem}`);
    };

    const loadNetwork = async () => {
        try {
            const response = await fetch(networkEndpoint);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const network = await response.json();
            const processedUsers = network.map(user => ({
                id: user.id,
                name: user.first_name + " " + user.last_name,
                username: user.username
            }));
            setUsers(processedUsers);
        } catch (error) {
            console.log("error loading network", error);
        }
    };

    const handleSelectUser = (userToToggle) => {
        const isAlreadySelected = selectedUsers.some(user => user.id === userToToggle.id);
        if (isAlreadySelected) {
            setSelectedUsers(prevUsers => prevUsers.filter(user => user.id !== userToToggle.id));
        } else {
            setSelectedUsers(prevUsers => [...prevUsers, userToToggle]);
        }
    };

    useEffect(() => {
        loadNetwork();
    } , []); 

    // --- Event Handler ---
    async function handleCreateEvent() {
        const eventData = {
            title: eventName,
            description: description,
            date: date,
            time: time,
            location: location,
            type: isPrivate ? 'private' : 'public',
        };

        console.log("Sending event data:", JSON.stringify(eventData, null, 2));
        try {
            const response = await fetch(createEventsBackendEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(eventData),
            });
            if (!response.ok) {
                console.error("Error with creating event. Status:", response.status);
            } else {
                const data = await response.json();
                console.log("Heard back from create_tables:", data.eventID);
                handleSelectGuests(data.eventID);
            }
        } catch (error) {
            console.error("Failed to send request to createEventsBackendEndpoint :", error);
        }
    }

    async function handleSelectGuests(eventId){
        console.log("Here is the selected guest function")        
        const inviteeData = {
           event_id: eventId,
           inviter_id: current_user, 
           selectedGuests: selectedUsers
        };

        console.log("invited guests",inviteeData);

        try{
            const response = await fetch(inviteesEndpoint, {
                method: 'POST',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify(inviteeData)
            });

            console.log(response);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error("Error with inviting guests", response.status, errorData);
                
                // Handle different error status codes
                if (response.status === 400) {
                    console.error("Bad request - check your data format");
                } else if (response.status === 500) {
                    console.error("Server error - please try again later");
                }
                
                return { success: false, error: errorData };
            } else {
                const data = await response.json();
                console.log("Heard back from invitations:", data);
                return { success: true, data: data };
            }
        }catch (error) {
            console.error("Failed to send request to the backend invitees endpoint: ", error);
            return { success: false, error: error.message };
        }

    }

    return (
        <div style={{ fontFamily: 'monospace', backgroundColor: '#f0f0f0', borderRadius: '8px', whiteSpace: 'pre' }}>
        {isSelectingGuests ? (
            <>
                <div>|             [ Your Network ]               |</div>
                <div>|                                            |</div>
                <SelectedUsers selectedUsers={selectedUsers} />
                {users.length > 0 ? (
                    users.map(user => (
                        <NetworkCard
                            key={user.id}
                            userInfo={user}
                            isSelected={selectedUsers.some(selected => selected.id === user.id)}
                            onCardClick={handleSelectUser}
                        />
                    ))
                ) : (
                    <div>|  Your Network is Empty or Loading...       |</div>
                )}
                <button className="button clickable" onClick={() => setIsSelectingGuests(false)}>           [ DONE ]</button>
            </>
         ) : (
            // --- EVENT FORM VIEW (Your original CreateEvent JSX) ---
        <>
            <FormField label="Event Title">
                <input type="text" className="form-input" placeholder="Enter event title here..." value={eventName} onChange={e => setEventName(e.target.value)} maxLength="35" style={{width: '36ch'}} />
            </FormField>

            <FormField label="Description">
                <input className="form-textarea" placeholder="Tell guests about your event..." value={description} onChange={e => setDescription(e.target.value)} maxLength="35" style={{width: '36ch'}} />
            </FormField>

            <FormField label="Date & Time">
                <span>
                    <input type="date" className="date-input" value={date} onChange={e => setDate(e.target.value)} />
                    {'  | |   '}
                    <input type="time" className="time-input" value={time} onChange={e => setTime(e.target.value)} />
                </span>
            </FormField>

            <FormField label="Location">
                 <input type="text" className="form-input" placeholder="Enter address or venue name..." value={location} onChange={e => setLocation(e.target.value)} maxLength="35" style={{width: '36ch'}} />
            </FormField>

            <FormField label="Event Type">
                <label>
                    <input type="checkbox" id="private" name="eventType" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />
                    {' Private - Invitation only'}
                </label>
            </FormField>

            <FormField label="Guest List" className="guest_list_container" >
                    <SelectedUsers selectedUsers={selectedUsers} />
                |<button className="select_guests clickable" onClick={() => setIsSelectingGuests(true)}> [ SELECT GUESTS ] </button>                                            |
            </FormField>
            
            <ActionButtons onCreate={handleCreateEvent} onSaveDraft={handleSaveDraft} />

        </>
        )}
            
            <style>{`
                .clickable { cursor: pointer;  color: blue;, font-weight: bold;   }
                a.clickable { color: blue; }
                .form-input, .form-textarea, .date-input, .time-input, input[type="checkbox"], label {
                    background-color: transparent;
                    border: none;
                    outline: none;
                    font-family: monospace;
                    color: #333;
                    vertical-align: middle;
                }
                button {
                    font-family: monospace;
                    cursor: pointer;
                    padding: 0px 4px;
                    text-decoration: none;
                    border: none;
                    color:blue;
                    
                }
                .nav-item { cursor: pointer; }
                .nav-item.active { font-weight: bold; }
            `}</style>
        </div>
    )};