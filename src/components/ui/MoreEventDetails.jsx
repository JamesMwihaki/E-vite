import React from 'react';

const MoreEventDetails = ({ event, participants }) => {
    // --- Style Definitions ---
    const styles = {
        container: { fontFamily: 'sans-serif', backgroundColor: '#f9f9f9', border: '2px solid', width: '310px', borderRadius: '8px', padding: '16px 24px', margin: '16px 0' },
        header: { fontSize: '1.25rem', fontWeight: '600', color: '#333', borderBottom: '1px solid #e0e0e0', paddingBottom: '12px', marginBottom: '12px' },
        detailRow: { display: 'flex', alignItems: 'flex-start', marginBottom: '8px', fontSize: '0.9rem' },
        label: { fontWeight: 'bold', color: '#555', minWidth: '100px', flexShrink: 0 },
        value: { color: '#333' },
        descriptionContainer: { marginTop: '16px' },
        descriptionText: { fontSize: '0.9rem', lineHeight: '1.6', whiteSpace: 'pre-wrap', color: '#333' },
        participantsContainer: { marginTop: '16px' },
        participantItem: { padding: '4px 0', color: '#333' },
    };
    
    // The useEffect hook has been completely removed. This component no longer fetches data.

    // Helper to format the date
    const formattedDate = event.event_date
        ? new Date(event.event_date).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        })
        : 'Date not available';

    if (!event) {
        return <div>Loading event details...</div>;
    }

    return (
        <div style={styles.container}>
            <div style={styles.header}>{event.name || 'Event Details'}</div>
            <div style={styles.detailRow}>
                <span style={styles.label}>Date:</span>
                <span style={styles.value}>{formattedDate}</span>
            </div>
            <div style={styles.detailRow}>
                <span style={styles.label}>Time:</span>
                <span style={styles.value}>{event.time || 'Not specified'}</span>
            </div>
            <div style={styles.detailRow}>
                <span style={styles.label}>Location:</span>
                <span style={styles.value}>{event.location || 'Not specified'}</span>
            </div>
            <div style={styles.detailRow}>
                <span style={styles.label}>Event Type:</span>
                <span style={styles.value}>{event.type || 'General'}</span>
            </div>
            <div style={styles.descriptionContainer}>
                <div style={styles.label}>Description:</div>
                <p style={styles.descriptionText}>{event.description || 'No description provided.'}</p>
            </div>
            
            <div style={styles.participantsContainer}>
                <div className='rsvp_status'><div style={styles.label}>Participants:</div><div style={styles.label}>Status</div></div>
                {/* The 'participants' prop now comes from the parent, complete with names and statuses */}
                {participants && participants.length > 0 ? (
                    participants.map(p => (
                        <div key={p.id} style={styles.participantItem}>
                            {p.name} (Status: {p.status})
                        </div>
                    ))
                ) : (
                    <div style={{ ...styles.value, paddingTop: '4px' }}>No participants listed.</div>
                )}
            </div>
        </div>
    );
};

export default MoreEventDetails;