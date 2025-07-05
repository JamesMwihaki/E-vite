import React, { useState, useEffect } from 'react';
import WelcomeSection from './ui/WelcomeSection';
import EventCard from './ui/EventCard';
import usePageNavigation from './ui/usePageNavigation';



// Main Landing Page component
export default function LandingPage() {
    // --- State Management ---
    const [events, setEvents] = useState([]);
    const [participants, setParticipants] = useState([]);
    const [rsvps, setRsvps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('HOME');
    const [userName, setUserName] = useState();
    const navigate = usePageNavigation();
    const currentUserId = 5; // Static current user ID

    // --- API Endpoints ---
    const eventsEndpoint = "http://localhost:3001/api/create_event";
    const inviteesEndpoint = "http://localhost:3001/api/invitees";
    const networkEndpoint = "http://localhost:3001/api/load_network";
    const rsvpEndpoint = "http://localhost:3001/api/rsvp";
    
    //Data fetching effect
    useEffect(() => {
        const fetchAllData = async () => {
            try {
                setLoading(true);
                // Fetch all data in parallel
                const [eventsRes, inviteesRes, networkRes, rsvpsRes] = await Promise.all([
                    fetch(eventsEndpoint),
                    fetch(inviteesEndpoint),
                    fetch(networkEndpoint),
                    fetch(rsvpEndpoint),
                ]);

                if (!eventsRes.ok || !inviteesRes.ok || !networkRes.ok || !rsvpsRes.ok) {
                    throw new Error(`HTTP error! Failed to fetch data.`);
                }

    
                const eventsData = await eventsRes.json();
                const inviteesData = await inviteesRes.json();
                const networkData = await networkRes.json();
                const rsvpsData = await rsvpsRes.json();

                const user = networkData.find(u => u.id === currentUserId);
                setUserName(user.first_name + '  ' + user.last_name);
                

                
                // Process and set events
                const processedEvents = eventsData.map(event => ({
                    id: event.id,
                    name: event.title,
                    location: event.location,
                    event_date: event.event_date,
                    time: event.event_time,
                    description: event.description,
                    type: event.event_type
                }));
                setEvents(processedEvents);

                // Enrich participants with names and set state
                const enrichedParticipants = inviteesData.map(invitee => {
                    const user = networkData.find(u => u.id === invitee.invitee);
                    return {
                        ...invitee,
                        name: user ? `${user.first_name} ${user.last_name}` : 'Unknown User',
                    };
                });
                setParticipants(enrichedParticipants);
                
                // Set initial RSVPs
                setRsvps(rsvpsData);

            } catch (err) {
                console.error("Error fetching data:", err);
                setError("Error loading events");
            } finally {
                setLoading(false);
            }
        };

        fetchAllData();
    }, []);

    
    // --- Event Handlers ---
    const handleReturnHome = () => {
        console.log("Returning to home");
        setActiveTab('HOME');
    };

    const handleUserInfo = () => {
        console.log("Show user info");
    };

    const handleCreateEvent = () => {
        navigate('../create-event');
    };

    const handleSetActive = (navItem) => {
        setActiveTab(navItem);
        console.log(`Navigating to: ${navItem}`);
    };

    async function handleRSVP(eventId, response){
        console.log(`RSVP for event ${eventId}: ${response}`);
        // Send RSVP to the backend with, userId(Who RSVP'ed), eventId (Event they will or not go to)

        const rsvpStatus = response === 'yes' ? 'going' : 'not_going';
        const rsvpData = {
            userId: currentUserId, 
            eventId: eventId,
            status: rsvpStatus, 
        }
        //console.log("rsvp data: ", rsvpData);

        // --- Optimistic UI Update ---
        // Instantly update the UI without waiting for the server
        setRsvps(currentRsvps => {
            const existingRsvpIndex = currentRsvps.findIndex(r => r.user_id === currentUserId && r.event_id === eventId);
            const newRsvps = [...currentRsvps];
            if (existingRsvpIndex > -1) {
                newRsvps[existingRsvpIndex] = { ...newRsvps[existingRsvpIndex], status: rsvpStatus };
            } else {
                newRsvps.push({ event_id: eventId, user_id: currentUserId, status: rsvpStatus });
            }
            return newRsvps;
        });
        // --- Send to Backend ---
        try {
            const fetchResponse = await fetch(rsvpEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rsvpData),
            });

            if (!fetchResponse.ok) {
                console.error("Error with RSVP Status:", fetchResponse.status);
                // Note: Here you might want to revert the optimistic update
            }
            } catch (error) {
                console.error("Failed to send request:", error);
                // Note: Also revert optimistic update here
            }
    };

    // --- Render Logic ---
    const renderEventCards = (eventList, isPrivate) => {
        if (eventList.length === 0) {
            return (
                <>
                    <div>|  +--------------------------------------+  |</div>
                    <div>{isPrivate ? "|  |     No private events available       |  |" : "|  |     No public events available       |  |"}</div>
                    <div>|  +--------------------------------------+  |</div>
                    <div>|                                            |</div>
                </>
            );
        }


        return eventList.map(event => {
            // Find the current user's RSVP status for this event
            const userRsvp = rsvps.find(r => r.user_id === currentUserId && r.event_id === event.id);
            const rsvpStatus = userRsvp ? userRsvp.status : null;

            // Get all participants for this event and add their RSVP status
            const eventParticipants = participants
                .filter(p => p.event_id === event.id)
                .map(p => {
                    const participantRsvp = rsvps.find(r => r.user_id === p.invitee && r.event_id === event.id);
                    return { ...p, status: participantRsvp ? participantRsvp.status : 'Pending' };
                });
            return (
                <EventCard
                    key={`${event.type}-${event.id}`}
                    event={event}
                    isPrivate={isPrivate}
                    onRSVP={handleRSVP}
                    rsvpStatus={rsvpStatus}
                    participants={eventParticipants} // Pass down the processed participants
                />
            );
        });
    };

    const privateEvents = events.filter(event => event.type === 'private');
    const publicEvents = events.filter(event => event.type === 'public');
    

    // --- Component Rendering ---
    return (
        <div className="ascii-container" style={{ 
            fontFamily: 'monospace', 
            backgroundColor: '#f0f0f0', 
            whiteSpace: 'pre' 
        }}>            
            <WelcomeSection userName={userName} onCreateEvent={handleCreateEvent} />
            
            {loading ? (
                <div>|           Loading events...                |</div>
            ) : error ? (
                <div>|           {error}                          |</div>
            ) : (
                <>
                    <div>|           [ Exclusive E-vites ]            |</div>
                    <div>|                                            |</div>
                    {renderEventCards(privateEvents, true)}
                    
                    <div>|--------------------------------------------|</div>
                    
                    <div>|            <span className="clickable">[ Public E-vites ]</span>  |</div>
                    {renderEventCards(publicEvents, false)}
                </>
            )}
            <style>{`
                .clickable { 
                    cursor: pointer;
                    color: blue; 
                }
                .create-event-link {
                    color: green;
                    font-weight: bold;
                }
                .card-text {
                    color: #333;
                }
                .checkbox-option {
                    display: inline;
                    cursor: pointer;
                }
                .checkbox-option input[type="checkbox"] {
                    margin-right: 5px;
                    vertical-align: middle;
                }

            `}</style>
        </div>
    );
}